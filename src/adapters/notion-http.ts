/**
 * Adaptador HTTP de Notion: requests con timeout y reintentos, el cliente
 * concreto y la lectura de páginas existentes.
 */
import { mensajeDeError } from '../core/errores';
import { type Idioma, TEXTOS_POR_IDIOMA } from '../core/i18n';
import { recortarParaNotion } from '../core/row';
import type { PaginaExistente, PropiedadesNotionBrutas, TareaDocumento } from '../core/types';
import type { ClienteNotion, Dormir, FetchInyectado } from '../ports/notion';

// ---------------------------------------------------------------------------
// Cliente de Notion (fetch inyectable)
//
// Formas de request/response verificadas con el MCP context7 contra
// developers.notion.com (Notion-Version 2025-09-03):
// - GET /v1/databases/{id} → { data_sources: [{ id, name }] } (retrieve-database).
// - GET /v1/data_sources/{id} → { properties: {...} } (retrieve-a-data-source).
// - POST /v1/data_sources/{id}/query, paginado con start_cursor/has_more/next_cursor
//   (query-a-data-source).
// - POST /v1/pages con parent {type:"data_source_id", data_source_id} (post-page,
//   move-page: "debés usar data_source_id, no database_id").
// - PATCH /v1/pages/{id} con properties (page-property-values).
// - GET/PATCH /v1/blocks/{id}/children, paginado igual (get-block-children,
//   patch-block-children), y DELETE /v1/blocks/{id} (delete-a-block).
// - Bloque to_do: {type:"to_do", to_do:{rich_text, checked, color}} (reference/block).
// - select: si el nombre no existe en el esquema, Notion lo crea solo al
//   escribirlo (con permiso de escritura sobre el data source) — confirmado.
// - 429: header "retry-after" en segundos (rate limits).
// ---------------------------------------------------------------------------

const NOTION_VERSION = '2025-09-03';
const NOTION_BASE = 'https://api.notion.com/v1';
const MAX_REINTENTOS = 3;
/** Backoff exponencial para 5xx, timeouts y errores de red: 1 s, 2 s, 4 s
 *  (índice = número de intento fallido, empezando en 0). Un 429 ignora esto
 *  y usa el "Retry-After" del propio Notion. */
const BACKOFF_MS = [1000, 2000, 4000];
const TIMEOUT_POR_DEFECTO_MS = 30_000;
const TAMANO_LOTE_BLOQUES = 100; // límite de la API por request (append-block-children)

export function dormirPorDefecto(ms: number): Promise<void> {
    return new Promise((resolver) => setTimeout(resolver, ms));
}

/** Espera de backoff exponencial para el intento fallido dado (1-based): 1s,
 *  2s, 4s, y el último valor de ahí en más. Único punto de esta cuenta (una
 *  revisión anterior encontró la expresión duplicada en las dos ramas de
 *  reintento; un arreglo posterior sumó una tercera). */
function esperaDeBackoff(intentoFallido: number): number {
    return BACKOFF_MS[intentoFallido - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
}

/** Arma el mensaje para una escritura NO idempotente que falla por timeout o
 *  por un error de red genuino — distinguidos por "esTimeout" (una revisión
 *  anterior detectó que el mismo catch recibía el `AbortError` del timeout y
 *  siempre decía "fallo de red", aunque no hubiera pasado nada por la red).
 *  No se reintenta: Notion pudo haber aplicado el cambio igual, y la corrida
 *  siguiente lo repara (ver "Huella al final" en `sincronizar`). */
function mensajeFalloNoIdempotente(
    metodo: string,
    ruta: string,
    esTimeout: boolean,
    timeoutMs: number,
    detalle: string,
): string {
    const causa = esTimeout ? `timeout de ${timeoutMs / 1000} s` : 'fallo de red';
    return (
        `Notion: ${causa} en una escritura NO idempotente (${metodo} ${ruta}) — no se reintenta ` +
        `porque Notion pudo haber aplicado el cambio igual; la corrida siguiente lo repara: ${detalle}`
    );
}

/** Igual que `mensajeFalloNoIdempotente`, para una escritura idempotente que
 *  agotó sus reintentos. */
function mensajeFalloTrasReintentos(metodo: string, ruta: string, esTimeout: boolean, detalle: string): string {
    const causa = esTimeout
        ? `timeout tras ${MAX_REINTENTOS} reintentos`
        : `fallo de red tras ${MAX_REINTENTOS} reintentos`;
    return `Notion: ${causa} en ${metodo} ${ruta}: ${detalle}`;
}

/**
 * Lee el cuerpo de una respuesta de error SIN lanzar NUNCA (una revisión
 * anterior detectó tres hallazgos separados sobre este mismo problema). Se
 * usa en las ramas TERMINALES de `solicitarNotion` (429
 * agotado, 5xx, y el 4xx llano) donde el status HTTP ya decidió el resultado:
 * si la lectura del cuerpo falla o se aborta ahí, eso NUNCA debe pasar por
 * `manejarFalloDeIntento` — antes lo hacía, y el resultado era doble: el
 * mensaje perdía el status ("timeout"/"fallo de red" en vez de "Notion
 * respondió 503 …") y, para una escritura idempotente, el intento se contaba
 * una segunda vez. Sigue corriendo bajo el mismo timeout por intento: si la
 * lectura se cuelga, el mismo `AbortController` del llamador la aborta igual
 * que abortaría el `fetch`, y acá se convierte en la nota de abajo en vez de
 * relanzarse.
 */
async function leerCuerpoDeError(respuesta: { text(): Promise<string> }): Promise<string> {
    try {
        return await respuesta.text();
    } catch (error) {
        return `(no se pudo leer el cuerpo: ${mensajeDeError(error)})`;
    }
}

/** Forma laxa de una respuesta cruda de la API de Notion: lo suficiente para
 *  navegar los campos que este cliente usa, sin tipar el esquema completo de
 *  la API (que Notion no publica como paquete de tipos). */
interface RespuestaNotionCruda {
    data_sources?: Array<{ id: string; name?: string }>;
    properties?: Record<string, { type: string }>;
    results?: Array<{
        id: string;
        properties?: PropiedadesNotionBrutas;
        created_time?: string;
        [clave: string]: unknown;
    }>;
    has_more?: boolean;
    next_cursor?: string | null;
    id?: string;
}

/**
 * Request a Notion con timeout por intento (`AbortController`) y reintento
 * con tope de `MAX_REINTENTOS`, backoff exponencial, para: 429 (respeta
 * "Retry-After"), cualquier 5xx, timeout, y cualquier rechazo de `fetch`
 * (error de red). Un 4xx que no sea 429 NUNCA se reintenta: es un problema
 * del propio request, no algo transitorio.
 *
 * El timeout cubre el intento COMPLETO, headers Y cuerpo (un arreglo
 * posterior lo corrigió): antes, `clearTimeout` corría apenas `fetch`
 * resolvía los headers, así que una conexión que se trababa DESPUÉS de eso
 * (leyendo `respuesta.text()`) podía colgar la corrida sin límite.
 *
 * Una lectura del cuerpo que falla o se aborta se trata de dos formas
 * distintas según en qué rama ocurre (una revisión anterior distinguió estos
 * dos caminos, con tres hallazgos separados sobre el mismo problema), porque
 * "quién decide el resultado" es distinto en cada una:
 * - Camino de ÉXITO (2xx/3xx, más abajo del todo): el status todavía no dijo
 *   nada, así que una lectura fallida se clasifica EXACTAMENTE igual que un
 *   fallo del propio `fetch`, vía `manejarFalloDeIntento` — reintentada con
 *   backoff si `idempotente`, lanzada de inmediato si no lo es.
 * - Ramas TERMINALES de error (429 agotado, 5xx, 4xx llano): el status HTTP
 *   YA decidió el resultado. Ahí se usa `leerCuerpoDeError`, que nunca lanza:
 *   el mensaje sigue siendo el específico de ese status (con la nota de
 *   "no se pudo leer el cuerpo" en vez del texto real cuando la lectura
 *   falla), y NO pasa por `manejarFalloDeIntento` — de lo contrario se perdía
 *   el status del mensaje y, para una escritura idempotente, se contaba un
 *   intento de más.
 */
async function solicitarNotion(
    fetchInyectado: FetchInyectado,
    dormir: Dormir,
    token: string,
    metodo: string,
    ruta: string,
    /**
     * `false` para el POST de alta de página (`/pages`) y el PATCH de
     * agregar hijos (`/blocks/{id}/children`): si Notion ya aplicó la
     * escritura y la respuesta se perdió (timeout, error de red, 5xx),
     * reintentar la duplicaría — la página o los bloques quedarían dos
     * veces. Es seguro fallar sin reintentar porque la Huella se escribe al
     * final (ver "Huella al final" más abajo): un alta que falla queda sin
     * Huella o no llega a existir, y un append que falla deja la Huella
     * vieja — en ambos casos la corrida SIGUIENTE detecta el desajuste y
     * repara la página entera (la crea, o reescribe el cuerpo completo), nunca
     * duplicándola. El único reintento que sigue siendo seguro para una
     * escritura no idempotente es el 429: ahí Notion confirma que no
     * procesó nada. Se decide explícitamente por request (no se infiere del
     * método HTTP), porque el propio POST de `/pages` es la excepción: otro
     * POST, el de `/query`, es una lectura y sí es idempotente.
     */
    idempotente: boolean,
    cuerpo?: unknown,
    timeoutMs: number = TIMEOUT_POR_DEFECTO_MS,
): Promise<RespuestaNotionCruda> {
    let intento = 0;

    /**
     * Punto único para una falla del propio `fetch`, o de la lectura del
     * cuerpo del camino de ÉXITO (2xx/3xx) — nunca de una rama TERMINAL de
     * error (429 agotado, 5xx, 4xx llano: ver `leerCuerpoDeError` y el
     * comentario de `solicitarNotion`), porque ahí el status ya decidió el
     * resultado y esta función lo reemplazaría por un mensaje genérico de
     * timeout/red, además de contar un intento de más si es idempotente. Las
     * dos fallas que sí entran acá corren bajo el MISMO timeout (ver el
     * `AbortController` de más abajo) y se clasifican EXACTAMENTE igual. Si
     * hay que reintentar, ya durmió el backoff y vuelve (el llamador solo
     * necesita `continue`); si no hay que reintentar, lanza — nunca vuelve en
     * ese caso.
     */
    async function manejarFalloDeIntento(error: unknown, aborto: boolean): Promise<void> {
        const detalle = mensajeDeError(error);
        if (!idempotente) {
            throw new Error(mensajeFalloNoIdempotente(metodo, ruta, aborto, timeoutMs, detalle));
        }
        intento++;
        if (intento > MAX_REINTENTOS) {
            throw new Error(mensajeFalloTrasReintentos(metodo, ruta, aborto, detalle));
        }
        await dormir(esperaDeBackoff(intento));
    }

    for (;;) {
        const controlador = new AbortController();
        const idTimeout = setTimeout(() => controlador.abort(), timeoutMs);
        try {
            let respuesta: Awaited<ReturnType<FetchInyectado>>;
            try {
                respuesta = await fetchInyectado(`${NOTION_BASE}${ruta}`, {
                    method: metodo,
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Notion-Version': NOTION_VERSION,
                        'Content-Type': 'application/json',
                    },
                    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
                    signal: controlador.signal,
                });
            } catch (error) {
                await manejarFalloDeIntento(error, controlador.signal.aborted);
                continue;
            }

            if (respuesta.status === 429) {
                intento++;
                if (intento > MAX_REINTENTOS) {
                    const texto = await leerCuerpoDeError(respuesta);
                    throw new Error(
                        `Notion respondió 429 tras ${MAX_REINTENTOS} reintentos en ${metodo} ${ruta}: ${texto}`,
                    );
                }
                const segundos = Number(respuesta.headers.get('Retry-After') ?? '1');
                await dormir((Number.isFinite(segundos) ? segundos : 1) * 1000);
                continue;
            }

            if (respuesta.status >= 500) {
                if (!idempotente) {
                    const texto = await leerCuerpoDeError(respuesta);
                    throw new Error(
                        `Notion respondió ${respuesta.status} en una escritura NO idempotente (${metodo} ${ruta}) — ` +
                            `no se reintenta porque Notion pudo haber aplicado el cambio igual; la corrida siguiente lo repara: ${texto}`,
                    );
                }
                intento++;
                if (intento > MAX_REINTENTOS) {
                    const texto = await leerCuerpoDeError(respuesta);
                    throw new Error(
                        `Notion respondió ${respuesta.status} tras ${MAX_REINTENTOS} reintentos en ${metodo} ${ruta}: ${texto}`,
                    );
                }
                await dormir(esperaDeBackoff(intento));
                continue;
            }

            if (respuesta.status >= 400) {
                // 4xx llano (ni 429 ni 5xx, ya tratados arriba): el status ya
                // decide el resultado, así que una lectura fallida NUNCA pasa
                // por `manejarFalloDeIntento` (ver `leerCuerpoDeError`).
                const texto = await leerCuerpoDeError(respuesta);
                throw new Error(`Notion respondió ${respuesta.status} en ${metodo} ${ruta}: ${texto}`);
            }

            // Camino de ÉXITO (2xx/3xx): acá SÍ una lectura fallida se trata
            // igual que un fallo de `fetch` (ver `manejarFalloDeIntento`).
            let texto: string;
            try {
                texto = await respuesta.text();
            } catch (error) {
                await manejarFalloDeIntento(error, controlador.signal.aborted);
                continue;
            }
            return texto === '' ? {} : JSON.parse(texto);
        } finally {
            clearTimeout(idTimeout);
        }
    }
}

/** Convierte una tarea del documento en un bloque `to_do` para el cuerpo de
 *  la página de Notion. El texto se recorta con `recortarParaNotion`: el
 *  mismo límite de 2000 caracteres por objeto de texto que rige las
 *  propiedades aplica también al contenido de un bloque. */
function bloqueParaTarea(tarea: TareaDocumento): unknown {
    const contenido = recortarParaNotion(`${tarea.id} — ${tarea.nombre}: ${tarea.descripcion}`);
    return {
        type: 'to_do',
        to_do: {
            rich_text: [{ type: 'text', text: { content: contenido } }],
            checked: tarea.hecha,
        },
    };
}

export function crearClienteNotion(
    fetchInyectado: FetchInyectado,
    token: string,
    dormir: Dormir = dormirPorDefecto,
    timeoutMs: number = TIMEOUT_POR_DEFECTO_MS,
): ClienteNotion {
    // "idempotente" se decide acá, explícitamente por request — nunca
    // infiriéndola del método HTTP (el POST de `/query` es una lectura, el
    // de `/pages` no; ver el comentario en "solicitarNotion").
    const pedir = (metodo: string, ruta: string, idempotente: boolean, cuerpo?: unknown) =>
        solicitarNotion(fetchInyectado, dormir, token, metodo, ruta, idempotente, cuerpo, timeoutMs);

    return {
        async obtenerDataSourceId(databaseId) {
            const db = await pedir('GET', `/databases/${databaseId}`, true);
            const fuentes = db.data_sources ?? [];
            if (fuentes.length === 0) {
                throw new Error(`La base ${databaseId} no expone data_sources — no se puede sincronizar.`);
            }
            return fuentes[0].id;
        },

        async obtenerEsquema(dataSourceId) {
            const ds = await pedir('GET', `/data_sources/${dataSourceId}`, true);
            return ds.properties ?? {};
        },

        async listarTodasLasPaginas(dataSourceId) {
            const paginas: Array<{ id: string; properties: PropiedadesNotionBrutas; createdTime: string }> = [];
            let cursor: string | undefined;
            for (;;) {
                const cuerpo: Record<string, unknown> = { page_size: 100 };
                if (cursor) cuerpo.start_cursor = cursor;
                // Es una consulta (lectura): idempotente aunque el verbo sea POST.
                const respuesta = await pedir('POST', `/data_sources/${dataSourceId}/query`, true, cuerpo);
                for (const pagina of respuesta.results ?? []) {
                    paginas.push({
                        id: pagina.id,
                        properties: pagina.properties ?? {},
                        createdTime: pagina.created_time ?? '',
                    });
                }
                if (!respuesta.has_more) break;
                cursor = respuesta.next_cursor ?? undefined;
            }
            return paginas;
        },

        async crearPagina(dataSourceId, propiedades, tareas) {
            // Alta en lotes (arreglo de una revisión anterior): el primer lote viaja en el
            // POST de creación; el resto se agrega con el mismo tamaño de lote
            // que "reescribirCuerpo" (límite real de la API: 100 por request).
            // Ambas llamadas son NO idempotentes (ver "solicitarNotion").
            const primerLote = tareas.slice(0, TAMANO_LOTE_BLOQUES);
            const resto = tareas.slice(TAMANO_LOTE_BLOQUES);

            const respuesta = await pedir('POST', '/pages', false, {
                parent: { type: 'data_source_id', data_source_id: dataSourceId },
                properties: propiedades,
                children: primerLote.map(bloqueParaTarea),
            });
            if (!respuesta.id) {
                throw new Error('Notion: la respuesta de creación de página no incluyó "id".');
            }
            const pageId = respuesta.id;

            for (let i = 0; i < resto.length; i += TAMANO_LOTE_BLOQUES) {
                const lote = resto.slice(i, i + TAMANO_LOTE_BLOQUES).map(bloqueParaTarea);
                await pedir('PATCH', `/blocks/${pageId}/children`, false, { children: lote });
            }

            return pageId;
        },

        async actualizarPropiedades(pageId, propiedades) {
            // Escribe siempre los mismos valores calculados: idempotente.
            await pedir('PATCH', `/pages/${pageId}`, true, { properties: propiedades });
        },

        async reescribirCuerpo(pageId, tareas) {
            // Un arreglo posterior fijó este orden: se listan los hijos
            // VIEJOS primero, se agregan los bloques NUEVOS, y RECIÉN AHÍ se
            // borran los viejos — nunca al revés. Con el orden anterior
            // (borrar y después agregar), una
            // falla al agregar dejaba la página vacía o a medio llenar. Con
            // este orden, una falla en cualquiera de las dos fases deja la
            // página con el contenido VIEJO completo, más como mucho una
            // copia parcial del nuevo: la Huella sigue siendo la vieja (se
            // escribe al final, ver "Huella al final" en `sincronizar`), así
            // que la corrida SIGUIENTE detecta el desajuste, vuelve a listar
            // TODOS los hijos (viejos + lo nuevo que haya quedado), agrega
            // una copia fresca y borra todo lo que listó: se autorepara sin
            // duplicar nada de forma permanente.
            const idsHijosViejos: string[] = [];
            let cursor: string | undefined;
            for (;;) {
                const query = cursor ? `?start_cursor=${encodeURIComponent(cursor)}` : '';
                const respuesta = await pedir('GET', `/blocks/${pageId}/children${query}`, true);
                for (const hijo of respuesta.results ?? []) idsHijosViejos.push(hijo.id);
                if (!respuesta.has_more) break;
                cursor = respuesta.next_cursor ?? undefined;
            }

            for (let i = 0; i < tareas.length; i += TAMANO_LOTE_BLOQUES) {
                const lote = tareas.slice(i, i + TAMANO_LOTE_BLOQUES).map(bloqueParaTarea);
                // Agregar hijos NO es idempotente (ver "solicitarNotion").
                await pedir('PATCH', `/blocks/${pageId}/children`, false, { children: lote });
            }
            // Sin tareas: no hay nada que agregar; se borran igual los viejos.

            for (const idHijo of idsHijosViejos) {
                // Borrar un bloque ya borrado no cambia nada más: idempotente.
                // Solo se borran los ids listados ANTES del agregado: los
                // bloques recién creados nunca entran en esta lista.
                await pedir('DELETE', `/blocks/${idHijo}`, true);
            }
        },
    };
}

function extraerRichTextPlano(propiedad: unknown): string {
    if (propiedad === null || typeof propiedad !== 'object') return '';
    const richText = (propiedad as { rich_text?: unknown }).rich_text;
    if (!Array.isArray(richText)) return '';
    return richText
        .map((item: unknown) => {
            if (item === null || typeof item !== 'object') return '';
            const conocido = item as { plain_text?: string; text?: { content?: string } };
            return conocido.plain_text ?? conocido.text?.content ?? '';
        })
        .join('');
}

export function extraerPaginaExistente(
    pagina: {
        id: string;
        properties: PropiedadesNotionBrutas;
        createdTime: string;
    },
    idioma: Idioma,
): PaginaExistente {
    const nombres = TEXTOS_POR_IDIOMA[idioma].propiedades;
    return {
        pageId: pagina.id,
        slug: extraerRichTextPlano(pagina.properties?.[nombres.slug]),
        huella: extraerRichTextPlano(pagina.properties?.[nombres.huella]),
        createdTime: pagina.createdTime,
    };
}
