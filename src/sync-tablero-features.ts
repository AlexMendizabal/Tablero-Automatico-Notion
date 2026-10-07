/**
 * Sync del estado de cada feature hacia un tablero de Notion, a partir de los
 * documentos ODD en `odd/tasks/*.md` (ver el README de este repositorio para
 * el contrato completo del documento y el esquema de la base de Notion).
 *
 * Arquitectura: núcleo puro exportado + capa de E/S fina, autoejecución solo
 * cuando `process.argv[1]` termina en el nombre de este script (no
 * `import.meta`: Jest transpila a CommonJS).
 *
 * Uso:
 *   npx tsx src/sync-tablero-features.ts [--dry-run]
 */
import { execFileSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import dotenv from 'dotenv';

import { CARPETA_TAREAS, RAMA_BASE_DOCUMENTO } from './core/ajustes';
import { mensajeDeError } from './core/errores';
import { type Idioma, type ResultadoIdioma, TEXTOS_POR_IDIOMA, resolverIdiomaTablero } from './core/i18n';
import { normalizarIdBaseNotion } from './core/id-notion';
import { parsearDocumento } from './core/parse';
import { construirValoresPropiedades, traducirPropiedades, validarEsquema } from './core/schema';
import { calcularActualizado, coincideRama, derivarEstado, diasSinActividad } from './core/status';
import type {
    DocumentoODD,
    DuplicadoSlug,
    Estado,
    FilaTablero,
    PaginaExistente,
    ParametrosActualizado,
    ParametrosConstruirFila,
    PlanSync,
    PropiedadesNotionBrutas,
    PullRequestInfo,
    RamaConFecha,
    ResultadoParseoDocumento,
    TareaDocumento,
} from './core/types';
import type { ClienteNotion, Credenciales, Dormir, FetchInyectado } from './ports/notion';
import type { DependenciasSincronizar, EjecutarComando } from './ports/sincronizar';

// Re-exports transitorios: el núcleo se está mudando a `src/core` (y los
// puertos a `src/ports`), y este archivo mantiene su API pública mientras
// dura la migración.
export * from './core/ajustes';
export * from './core/errores';
export * from './core/i18n';
export * from './core/id-notion';
export * from './core/parse';
export * from './core/schema';
export * from './core/status';
export * from './core/types';
export * from './ports/notion';
export * from './ports/sincronizar';

// ---------------------------------------------------------------------------
// Tipos del núcleo puro
// ---------------------------------------------------------------------------

export interface OpcionesCLI {
    dryRun: boolean;
}

export interface ResumenSincronizacion {
    codigo: number;
    creadas: number;
    actualizadas: number;
    cuerposReescritos: number;
    huerfanas: string[];
    erroresDeFormato: Array<{ slug: string; errores: string[] }>;
    consultoNotion: boolean;
    /** Solo presente en "--dry-run" CON credenciales: el plan que se
     *  ejecutaría, sin haber escrito nada todavía. */
    plan?: {
        crearia: number;
        actualizaria: number;
        cuerposAReescribir: number;
    };
    /** Slugs duplicados entre las páginas existentes de Notion (ver
     *  `resolverDuplicadosPorSlug`). Presente (posiblemente vacío) toda vez
     *  que se consultó Notion. */
    duplicadas?: DuplicadoSlug[];
    /** Motivo por el que el plan de escritura NO se calculó, cuando la razón
     *  es DISTINTA de "no se consultó Notion" (esquema inválido, o
     *  `NOTION_TABLERO_DB_ID` mal formado): `imprimirResumenFinal` lo usa
     *  para la línea "Plan de escritura: no calculado (...)". Ausente en el
     *  resto de los casos, incluido el de sin credenciales, que conserva su
     *  texto fijo (una revisión anterior detectó que antes esos dos casos
     *  imprimían contadores de escritura en cero, indistinguibles de un plan
     *  real sin altas, y se agregó este campo para distinguirlos). */
    razonNoCalculado?: string;
}

// ---------------------------------------------------------------------------
// calcularHuella
// ---------------------------------------------------------------------------

/** sha256 de la lista normalizada de tareas `id|hecha|nombre|descripción`.
 *  Alternar un solo checkbox cambia la huella; el mismo listado la conserva. */
export function calcularHuella(tareas: TareaDocumento[]): string {
    const normalizado = tareas.map((t) => `${t.id}|${t.hecha}|${t.nombre}|${t.descripcion}`).join('\n');
    return crypto.createHash('sha256').update(normalizado, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// recortarParaNotion
// ---------------------------------------------------------------------------

/** Notion limita cada objeto de texto a 2000 caracteres; se deja margen y se
 *  recorta a 1900 con "…" para señalar visualmente el corte. */
const LIMITE_TEXTO_NOTION = 1900;

export function recortarParaNotion(texto: string): string {
    if (texto.length <= LIMITE_TEXTO_NOTION) return texto;
    return texto.slice(0, LIMITE_TEXTO_NOTION - 1) + '…';
}

// ---------------------------------------------------------------------------
// construirFila
// ---------------------------------------------------------------------------

export function construirFila(parametros: ParametrosConstruirFila): FilaTablero {
    const { documento, todasLasRamas, todosLosPRs, fechasCommits, fechaDocumento, hoy, ownerRepo } = parametros;
    const idioma = parametros.idioma ?? 'es';

    const ramasQueMatchean = todasLasRamas.filter((r) =>
        documento.ramas.some((patron) => coincideRama(patron, r.nombre)),
    );
    const prsQueMatchean = todosLosPRs.filter((pr) =>
        documento.ramas.some((patron) => coincideRama(patron, pr.headRefName)),
    );
    const prsAbiertos = prsQueMatchean.filter((pr) => pr.state === 'OPEN');

    const actualizado = calcularActualizado({
        ramasVivas: ramasQueMatchean,
        prs: prsQueMatchean,
        fechasCommits,
        fechaDocumento,
        hoy,
    });

    const total = documento.tareas.length;
    const hechas = documento.tareas.filter((t) => t.hecha).length;
    const primeraPendiente = documento.tareas.find((t) => !t.hecha);
    const estado = derivarEstado(documento.tareas, prsAbiertos.length);

    return {
        feature: recortarParaNotion(documento.titulo),
        slug: documento.slug,
        estado,
        progreso: TEXTOS_POR_IDIOMA[idioma].progreso(hechas, total),
        pendiente: primeraPendiente
            ? recortarParaNotion(`${primeraPendiente.id} — ${primeraPendiente.nombre}`)
            : '',
        prsAbiertos: recortarParaNotion(
            prsAbiertos
                .map((pr) => pr.number)
                .sort((a, b) => a - b)
                .map((n) => `#${n}`)
                .join(', '),
        ),
        ramas: recortarParaNotion([...ramasQueMatchean.map((r) => r.nombre)].sort().join(', ')),
        diasSinActividad: diasSinActividad(actualizado, hoy),
        actualizado,
        documento: `https://github.com/${ownerRepo}/blob/${RAMA_BASE_DOCUMENTO}/${CARPETA_TAREAS}/${documento.slug}.md`,
        huella: calcularHuella(documento.tareas),
    };
}

// ---------------------------------------------------------------------------
// planificarSync
// ---------------------------------------------------------------------------

/** Upsert por Slug: nunca borra. Una página existente sin fila correspondiente
 *  se reporta en `huerfanas`, no se elimina (decisión del usuario). */
export function planificarSync(filas: FilaTablero[], paginasExistentes: PaginaExistente[]): PlanSync {
    const porSlug = new Map(paginasExistentes.map((p) => [p.slug, p]));
    const slugsDeFilas = new Set(filas.map((f) => f.slug));

    const crear: FilaTablero[] = [];
    const actualizar: PlanSync['actualizar'] = [];

    for (const fila of filas) {
        const existente = porSlug.get(fila.slug);
        if (!existente) {
            crear.push(fila);
        } else {
            actualizar.push({
                pageId: existente.pageId,
                fila,
                reescribirCuerpo: existente.huella !== fila.huella,
            });
        }
    }

    const huerfanas = paginasExistentes.filter((p) => !slugsDeFilas.has(p.slug));

    return { crear, actualizar, huerfanas };
}

/**
 * Cuando el mismo Slug aparece en más de una página de Notion (el bug ya
 * visto con `module-auth` en la base de fichas: un `Map` clave-única se
 * queda con la última y la otra envejece en silencio), se elige UNA página
 * de forma determinística para actualizar — la de `createdTime` más
 * antiguo; si falta o hay empate, la primera en el orden de la consulta
 * (`Array.prototype.sort` es estable) — y el resto queda listado como
 * "duplicadas". Ninguna se borra nunca: eso es decisión del usuario.
 */
export function resolverDuplicadosPorSlug(paginasExistentes: PaginaExistente[]): {
    unicas: PaginaExistente[];
    duplicadas: DuplicadoSlug[];
} {
    const porSlug = new Map<string, PaginaExistente[]>();
    for (const pagina of paginasExistentes) {
        const lista = porSlug.get(pagina.slug);
        if (lista) lista.push(pagina);
        else porSlug.set(pagina.slug, [pagina]);
    }

    const unicas: PaginaExistente[] = [];
    const duplicadas: DuplicadoSlug[] = [];

    for (const [slug, paginas] of porSlug) {
        if (paginas.length === 1) {
            unicas.push(paginas[0]);
            continue;
        }
        const ordenadas = [...paginas].sort((a, b) => {
            const fechaA = a.createdTime ? new Date(a.createdTime).getTime() : Number.POSITIVE_INFINITY;
            const fechaB = b.createdTime ? new Date(b.createdTime).getTime() : Number.POSITIVE_INFINITY;
            return fechaA - fechaB;
        });
        unicas.push(ordenadas[0]);
        duplicadas.push({ slug, pageIds: ordenadas.slice(1).map((p) => p.pageId) });
    }

    return { unicas, duplicadas };
}

// ---------------------------------------------------------------------------
// Capa de E/S — documentos ODD
// ---------------------------------------------------------------------------

// "CARPETA_TAREAS" vive en el bloque "=== Ajustes por proyecto ===", cerca
// del principio del archivo.

/**
 * Lee `odd/tasks/*.md` (o la carpeta configurada en `CARPETA_TAREAS`). Lanza
 * (nunca devuelve `[]` en silencio) cuando la
 * carpeta no existe o no se puede leer, o cuando existe pero no tiene ningún
 * `.md`: un repo que usa este sync siempre tiene al menos un documento, así
 * que "cero filas" ahí es señal de que se corrió desde el lugar equivocado,
 * no de que no hay nada que sincronizar.
 */
export function listarDocumentosODD(raizRepo: string): Array<{ slug: string; contenido: string }> {
    const carpeta = path.join(raizRepo, CARPETA_TAREAS);
    let entradas: string[];
    try {
        entradas = fs.readdirSync(carpeta);
    } catch {
        throw new Error(
            `No se encontró "${CARPETA_TAREAS}" en "${raizRepo}". ¿Se corrió el comando desde la raíz del repositorio (o del worktree)?`,
        );
    }
    const archivos = entradas.filter((f) => f.toLowerCase().endsWith('.md'));
    if (archivos.length === 0) {
        throw new Error(`La carpeta "${CARPETA_TAREAS}" en "${raizRepo}" no tiene ningún documento ".md".`);
    }
    return archivos.sort().map((archivo) => ({
        slug: archivo.replace(/\.md$/i, ''),
        contenido: fs.readFileSync(path.join(carpeta, archivo), 'utf8'),
    }));
}

// ---------------------------------------------------------------------------
// Capa de E/S — git / gh (comando inyectable)
// ---------------------------------------------------------------------------

export function obtenerRamasConFecha(ejecutar: EjecutarComando): RamaConFecha[] {
    const salida = ejecutar('git', [
        'for-each-ref',
        '--format=%(refname:short)%09%(committerdate:iso-strict)',
        'refs/heads',
        'refs/remotes/origin',
    ]);
    const porNombre = new Map<string, string>();
    for (const linea of salida.split(/\r?\n/)) {
        if (linea.trim() === '') continue;
        const [refCrudo, fecha] = linea.split('\t');
        if (!refCrudo || !fecha) continue;
        const nombre = refCrudo.startsWith('origin/') ? refCrudo.slice('origin/'.length) : refCrudo;
        if (nombre === 'HEAD' || nombre === 'origin') continue;
        const existente = porNombre.get(nombre);
        if (!existente || new Date(fecha).getTime() > new Date(existente).getTime()) {
            porNombre.set(nombre, fecha);
        }
    }
    return [...porNombre.entries()].map(([nombre, fecha]) => ({ nombre, fecha }));
}

export function obtenerPRs(ejecutar: EjecutarComando): PullRequestInfo[] {
    // Deliberadamente NO se pide "updatedAt" (ver PullRequestInfo.updatedAt).
    const salida = ejecutar('gh', [
        'pr',
        'list',
        '--state',
        'all',
        '--limit',
        '1000',
        '--json',
        'number,headRefName,state,createdAt,mergedAt,closedAt',
    ]);
    const datos = JSON.parse(salida || '[]') as Array<{
        number: number;
        headRefName: string;
        state: string;
        createdAt: string;
        mergedAt: string | null;
        closedAt: string | null;
    }>;
    return datos.map((d) => ({
        number: d.number,
        headRefName: d.headRefName,
        state: d.state as PullRequestInfo['state'],
        createdAt: d.createdAt,
        mergedAt: d.mergedAt,
        closedAt: d.closedAt,
    }));
}

export function obtenerFechaDocumento(ejecutar: EjecutarComando, slug: string): string | null {
    let salida: string;
    try {
        salida = ejecutar('git', ['log', '-1', '--format=%cI', '--', `${CARPETA_TAREAS}/${slug}.md`]);
    } catch {
        return null;
    }
    const fecha = salida.trim();
    return fecha === '' ? null : fecha;
}

/** Resuelve la fecha (ISO, `committerdate`) de un commit por hash. `null` si
 *  el commit no existe en el repositorio (ej. `git show` sale con error) —
 *  eso lo trata el llamador como error de formato del documento, nunca en
 *  silencio (ver el frontmatter opcional `commits`). */
export function obtenerFechaCommit(ejecutar: EjecutarComando, sha: string): string | null {
    let salida: string;
    try {
        salida = ejecutar('git', ['show', '-s', '--format=%cI', sha]);
    } catch {
        return null;
    }
    const fecha = salida.trim();
    return fecha === '' ? null : fecha;
}

/**
 * `true` si el repositorio es un clon superficial (`--depth`). A propósito
 * NO atrapa el error de `ejecutar`: si git no puede correr (ENOENT o
 * similar), eso tiene que distinguirse de "el commit no existe" — es un
 * problema de ENTORNO, no de formato de un documento — y el llamador
 * (`sincronizar`) lo trata así dejando que la excepción se propague.
 */
export function obtenerEsRepoSuperficial(ejecutar: EjecutarComando): boolean {
    const salida = ejecutar('git', ['rev-parse', '--is-shallow-repository']);
    return salida.trim() === 'true';
}

export function obtenerOwnerRepo(ejecutar: EjecutarComando): string {
    const desdeEnv = process.env.GITHUB_REPOSITORY;
    if (desdeEnv && desdeEnv.trim() !== '') return desdeEnv.trim();
    const salida = ejecutar('gh', ['repo', 'view', '--json', 'nameWithOwner']);
    const datos = JSON.parse(salida) as { nameWithOwner: string };
    return datos.nameWithOwner;
}

// ---------------------------------------------------------------------------
// Capa de E/S — credenciales
// ---------------------------------------------------------------------------

export function cargarCredenciales(raizRepo: string): Credenciales | null {
    dotenv.config({ path: path.resolve(raizRepo, '.env') });
    const token = process.env.NOTION_TOKEN;
    const databaseId = process.env.NOTION_TABLERO_DB_ID;
    if (!token || !databaseId) return null;
    return { token, databaseId };
}

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

function dormirPorDefecto(ms: number): Promise<void> {
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

// ---------------------------------------------------------------------------
// Orquestación
// ---------------------------------------------------------------------------

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

function extraerPaginaExistente(
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

function formatearFilaLegible(fila: FilaTablero): string {
    return [
        fila.slug.padEnd(28),
        fila.estado.padEnd(14),
        fila.progreso.padEnd(12),
        (fila.prsAbiertos || '—').padEnd(16),
        `${fila.diasSinActividad}d`.padEnd(6),
        fila.actualizado,
    ].join(' | ');
}

/**
 * Imprime el resumen final, en CUATRO formas mutuamente excluyentes:
 *
 * 1. `resumen.plan` presente ("--dry-run" CON credenciales, esquema válido):
 *    se consultó Notion en modo lectura, así que el plan SÍ se conoce, pero
 *    nada se escribió — se muestra "Crearía/Actualizaría/Cuerpos a
 *    reescribir/Huérfanas", cada número una sola vez, y nunca "Creadas:"
 *    (que implicaría una escritura que no ocurrió).
 * 2. `resumen.razonNoCalculado` presente (agregado en una corrección
 *    posterior): el plan NO se calculó por
 *    un motivo puntual — esquema inválido, o `NOTION_TABLERO_DB_ID` mal
 *    formado — así que se imprime esa razón en vez de contadores en cero,
 *    que antes eran indistinguibles de un plan real sin altas.
 * 3. `consultoNotion` true, sin `plan` ni `razonNoCalculado` (escritura
 *    real): se muestran los contadores reales de lo que se hizo.
 * 4. Ninguna de las anteriores (sin credenciales, con o sin "--dry-run"):
 *    esos datos no se calcularon — un "0" ahí sería indistinguible de un
 *    plan real con cero altas, el defecto documentado del `--dry-run` del
 *    sync viejo de fichas — así que se imprime un aviso explícito fijo.
 *
 * El conteo de errores de formato (y de slugs duplicados, si los hay) se
 * imprime siempre: no depende de haber consultado Notion.
 */
function imprimirResumenFinal(log: (linea: string) => void, resumen: ResumenSincronizacion): void {
    if (resumen.plan) {
        log(`Crearía: ${resumen.plan.crearia}`);
        log(`Actualizaría: ${resumen.plan.actualizaria}`);
        log(`Cuerpos a reescribir: ${resumen.plan.cuerposAReescribir}`);
        log(
            `Huérfanas: ${resumen.huerfanas.length}` +
                (resumen.huerfanas.length > 0 ? ` (${resumen.huerfanas.join(', ')})` : ''),
        );
    } else if (resumen.razonNoCalculado) {
        log(`Plan de escritura: no calculado (${resumen.razonNoCalculado}).`);
    } else if (resumen.consultoNotion) {
        log(`Creadas: ${resumen.creadas}`);
        log(`Actualizadas: ${resumen.actualizadas}`);
        log(`Cuerpos reescritos: ${resumen.cuerposReescritos}`);
        log(
            `Huérfanas: ${resumen.huerfanas.length}` +
                (resumen.huerfanas.length > 0 ? ` (${resumen.huerfanas.join(', ')})` : ''),
        );
    } else {
        log('Plan de escritura: no calculado (no se consultó Notion).');
    }
    if (resumen.duplicadas && resumen.duplicadas.length > 0) {
        log(`Slugs duplicados en Notion (no se borra ninguno): ${resumen.duplicadas.length}`);
        for (const duplicado of resumen.duplicadas) {
            log(`  ${duplicado.slug}: ${duplicado.pageIds.join(', ')}`);
        }
    }
    log(`Errores de formato: ${resumen.erroresDeFormato.length}`);
    for (const error of resumen.erroresDeFormato) {
        log(`  ${error.slug}:`);
        for (const mensaje of error.errores) log(`    - ${mensaje}`);
    }
}

/** Razones cortas para `ResumenSincronizacion.razonNoCalculado` (agregado en
 *  una corrección posterior): las
 *  usa `imprimirResumenFinal` en la línea "Plan de escritura: no calculado
 *  (...)". El mensaje detallado (con más contexto) ya se logueó aparte en el
 *  punto donde se detectó cada problema. */
const RAZON_ID_INVALIDO = 'el ID de la base de Notion no es válido';
const RAZON_ESQUEMA_INVALIDO = 'el esquema de la base de Notion no coincide';
const RAZON_IDIOMA_INVALIDO = 'el idioma del tablero (BOARD_LANGUAGE) no es válido';

/** Construye y loguea el resumen de un fallo de entorno (carpeta faltante,
 *  git no disponible, clon superficial con anclas declaradas): código 1,
 *  nunca se llegó a consultar Notion. Distinto de un error de formato — no
 *  es culpa de ningún documento en particular. */
function resumenDeErrorEntorno(log: (linea: string) => void, mensaje: string): ResumenSincronizacion {
    log(`Error de entorno: ${mensaje}`);
    return {
        codigo: 1,
        creadas: 0,
        actualizadas: 0,
        cuerposReescritos: 0,
        huerfanas: [],
        erroresDeFormato: [],
        consultoNotion: false,
    };
}

export async function sincronizar(
    opciones: OpcionesCLI,
    dependencias: DependenciasSincronizar,
): Promise<ResumenSincronizacion> {
    const log = dependencias.log ?? (() => {});
    const hoy = dependencias.hoy ?? new Date();

    // Una revisión anterior detectó que una carpeta "odd/tasks" faltante o
    // ilegible ya no se traga en silencio (antes devolvía [] y todo terminaba en "0 filas,
    // código 0, todo huérfano"). "listarDocumentos" ahora lanza en ese caso.
    let documentosLeidos: Array<{ slug: string; contenido: string }>;
    try {
        documentosLeidos = dependencias.listarDocumentos();
    } catch (error) {
        return resumenDeErrorEntorno(log, mensajeDeError(error));
    }

    const documentosParseados: DocumentoODD[] = [];
    const erroresDeFormato: Array<{ slug: string; errores: string[] }> = [];

    for (const { slug, contenido } of documentosLeidos) {
        const resultado = parsearDocumento(slug, contenido);
        if (resultado.ok) documentosParseados.push(resultado.documento);
        else erroresDeFormato.push({ slug, errores: resultado.errores });
    }

    let credenciales =
        dependencias.credenciales !== undefined
            ? dependencias.credenciales
            : cargarCredenciales(dependencias.raizRepo);

    // El idioma se resuelve DESPUÉS de cargar el ".env" (lo hace
    // "cargarCredenciales"), para que BOARD_LANGUAGE pueda vivir ahí también.
    // Un valor inválido es un error de configuración, igual que un ID de base
    // mal formado: se informa antes de cualquier llamada a git/gh o Notion.
    const resultadoIdioma: ResultadoIdioma =
        dependencias.idioma !== undefined
            ? { ok: true, idioma: dependencias.idioma }
            : resolverIdiomaTablero(process.env.BOARD_LANGUAGE);
    if (!resultadoIdioma.ok) {
        log(resultadoIdioma.error);
        const resumen: ResumenSincronizacion = {
            codigo: 1,
            creadas: 0,
            actualizadas: 0,
            cuerposReescritos: 0,
            huerfanas: [],
            erroresDeFormato,
            consultoNotion: false,
            razonNoCalculado: RAZON_IDIOMA_INVALIDO,
        };
        imprimirResumenFinal(log, resumen);
        return resumen;
    }
    const idioma = resultadoIdioma.idioma;

    // Una corrección posterior valida el ID de la base ANTES de cualquier
    // llamada de red — ni siquiera a git/gh — para no gastar tiempo si va a fallar igual. Se
    // aplica tanto si las credenciales vinieron inyectadas como si salieron
    // de "cargarCredenciales", y tanto en "--dry-run" como en corrida real.
    if (credenciales) {
        const resultadoId = normalizarIdBaseNotion(credenciales.databaseId);
        if (!resultadoId.ok) {
            log(resultadoId.error);
            const resumen: ResumenSincronizacion = {
                codigo: 1,
                creadas: 0,
                actualizadas: 0,
                cuerposReescritos: 0,
                huerfanas: [],
                erroresDeFormato,
                consultoNotion: false,
                razonNoCalculado: RAZON_ID_INVALIDO,
            };
            imprimirResumenFinal(log, resumen);
            return resumen;
        }
        credenciales = { ...credenciales, databaseId: resultadoId.id };
    }

    if (!credenciales && !opciones.dryRun) {
        log(
            'Faltan NOTION_TOKEN y/o NOTION_TABLERO_DB_ID. No se realizó ninguna llamada de red ni de Notion.',
        );
        const resumen: ResumenSincronizacion = {
            codigo: 1,
            creadas: 0,
            actualizadas: 0,
            cuerposReescritos: 0,
            huerfanas: [],
            erroresDeFormato,
            consultoNotion: false,
        };
        imprimirResumenFinal(log, resumen);
        return resumen;
    }

    // A partir de acá está autorizado tocar git/gh (dry-run con o sin
    // credenciales, o escritura real).
    //
    // Una revisión anterior detectó lo siguiente: antes de resolver anclas
    // de "commits", si algún documento las declara, hay que descartar dos problemas de ENTORNO que
    // NO son "el commit no existe" (error de formato de un documento
    // puntual): que el repo sea un clon superficial (las anclas requieren
    // fetch-depth: 0) o que git directamente no pueda correr (ENOENT). En
    // ambos casos la excepción de "obtenerEsRepoSuperficial" se deja
    // propagar a propósito (no tiene su propio try/catch) para distinguirlos
    // de "obtenerFechaCommit", que sí atrapa el fallo puntual de un hash.
    const algunDocumentoDeclaraCommits = documentosParseados.some((d) => d.commits.length > 0);
    if (algunDocumentoDeclaraCommits) {
        let esSuperficial: boolean;
        try {
            esSuperficial = obtenerEsRepoSuperficial(dependencias.ejecutar);
        } catch (error) {
            return resumenDeErrorEntorno(
                log,
                `No se pudo determinar si el repositorio es superficial (¿git no está disponible?): ${mensajeDeError(error)}`,
            );
        }
        if (esSuperficial) {
            return resumenDeErrorEntorno(
                log,
                'Repositorio superficial: las anclas de "commits" requieren un clon completo (fetch-depth: 0).',
            );
        }
    }

    // Ahora sí: un hash que no existe en un repo completo, con git
    // funcionando, es un error de formato del documento — se saltea como
    // cualquier otro, nunca en silencio.
    const documentosValidos: DocumentoODD[] = [];
    const fechasCommitsPorSlug = new Map<string, string[]>();
    for (const documento of documentosParseados) {
        const fechasCommits: string[] = [];
        let commitInexistente: string | null = null;
        for (const sha of documento.commits) {
            const fecha = obtenerFechaCommit(dependencias.ejecutar, sha);
            if (fecha === null) {
                commitInexistente = sha;
                break;
            }
            fechasCommits.push(fecha);
        }
        if (commitInexistente !== null) {
            erroresDeFormato.push({
                slug: documento.slug,
                errores: [
                    `El commit "${commitInexistente}" listado en "commits" no existe en el repositorio.`,
                ],
            });
            continue;
        }
        documentosValidos.push(documento);
        fechasCommitsPorSlug.set(documento.slug, fechasCommits);
    }

    const todasLasRamas = obtenerRamasConFecha(dependencias.ejecutar);
    const todosLosPRs = obtenerPRs(dependencias.ejecutar);
    const ownerRepo = obtenerOwnerRepo(dependencias.ejecutar);

    const filas = documentosValidos.map((documento) =>
        construirFila({
            documento,
            todasLasRamas,
            todosLosPRs,
            fechasCommits: fechasCommitsPorSlug.get(documento.slug) ?? [],
            fechaDocumento: obtenerFechaDocumento(dependencias.ejecutar, documento.slug),
            hoy,
            ownerRepo,
            idioma,
        }),
    );

    if (!credenciales) {
        log('--dry-run sin credenciales: NO se consultó Notion. Filas calculadas desde el repositorio:');
        log('slug | estado | progreso | PRs abiertos | días | actualizado');
        for (const fila of filas) log(formatearFilaLegible(fila));
        const resumen: ResumenSincronizacion = {
            codigo: erroresDeFormato.length > 0 ? 1 : 0,
            creadas: 0,
            actualizadas: 0,
            cuerposReescritos: 0,
            huerfanas: [],
            erroresDeFormato,
            consultoNotion: false,
        };
        imprimirResumenFinal(log, resumen);
        return resumen;
    }

    const dormir = dependencias.dormir ?? dormirPorDefecto;
    const cliente = crearClienteNotion(dependencias.fetchInyectado, credenciales.token, dormir);

    const dataSourceId = await cliente.obtenerDataSourceId(credenciales.databaseId);
    const esquemaActual = await cliente.obtenerEsquema(dataSourceId);
    const problemasEsquema = validarEsquema(esquemaActual, idioma);

    if (problemasEsquema.length > 0) {
        for (const problema of problemasEsquema) {
            log(
                problema.motivo === 'faltante'
                    ? `Falta la propiedad "${problema.nombre}" (tipo ${problema.tipoEsperado}) en la base de Notion.`
                    : `La propiedad "${problema.nombre}" es de tipo "${problema.tipoActual}", debería ser "${problema.tipoEsperado}".`,
            );
        }
        // Una corrección posterior sumó esto: además de decir qué falta,
        // decir qué SÍ hay — el usuario se encontró con 11 avisos de "Falta la propiedad ..." sin ninguna
        // pista de qué tenía la base en realidad (había creado FILAS en vez
        // de PROPIEDADES). El orden es el que devolvió Notion.
        const columnasEncontradas = Object.entries(esquemaActual);
        log(
            `Columnas encontradas en la base: ${
                columnasEncontradas.length > 0
                    ? columnasEncontradas.map(([nombre, propiedad]) => `${nombre} (${propiedad.type})`).join(', ')
                    : '(ninguna)'
            }`,
        );
        const resumen: ResumenSincronizacion = {
            codigo: 1,
            creadas: 0,
            actualizadas: 0,
            cuerposReescritos: 0,
            huerfanas: [],
            erroresDeFormato,
            consultoNotion: true,
            razonNoCalculado: RAZON_ESQUEMA_INVALIDO,
        };
        imprimirResumenFinal(log, resumen);
        return resumen;
    }

    const paginasNotion = await cliente.listarTodasLasPaginas(dataSourceId);
    const paginasExistentesCrudas = paginasNotion.map((pagina) => extraerPaginaExistente(pagina, idioma));
    // Una revisión anterior detectó esto: los slugs duplicados en Notion se
    // informan (nunca se borran, nunca se sobrescriben en silencio como hacía el Map anterior).
    const { unicas: paginasExistentes, duplicadas } = resolverDuplicadosPorSlug(paginasExistentesCrudas);
    const plan = planificarSync(filas, paginasExistentes);
    const hayProblemasNoFormato = duplicadas.length > 0;

    if (opciones.dryRun) {
        log('--dry-run con credenciales: se consultó Notion en modo lectura; no se escribió nada.');
        const cuerposNuevos = plan.actualizar.filter((a) => a.reescribirCuerpo).length;
        const resumen: ResumenSincronizacion = {
            codigo: erroresDeFormato.length > 0 || hayProblemasNoFormato ? 1 : 0,
            creadas: 0,
            actualizadas: 0,
            cuerposReescritos: 0,
            huerfanas: plan.huerfanas.map((h) => h.slug),
            erroresDeFormato,
            consultoNotion: true,
            plan: {
                crearia: plan.crear.length,
                actualizaria: plan.actualizar.length,
                cuerposAReescribir: cuerposNuevos,
            },
            duplicadas,
        };
        imprimirResumenFinal(log, resumen);
        return resumen;
    }

    // ("Huella al final"): la Huella se escribe SIEMPRE
    // en último lugar, en su propio PATCH, recién cuando el cuerpo quedó
    // completo. Si algo falla antes de esa última escritura, la Huella en
    // Notion sigue siendo la vieja — la corrida siguiente ve que no coincide
    // con la calculada y "planificarSync" vuelve a marcar el cuerpo para
    // reescribir, así que se autorepara solo.
    for (const fila of plan.crear) {
        const documento = documentosValidos.find((d) => d.slug === fila.slug);
        if (!documento) continue;
        const { huella, ...valoresSinHuella } = construirValoresPropiedades(fila, idioma);
        const pageId = await cliente.crearPagina(
            dataSourceId,
            traducirPropiedades(valoresSinHuella, idioma),
            documento.tareas,
        );
        await cliente.actualizarPropiedades(pageId, traducirPropiedades({ huella }, idioma));
    }

    let cuerposReescritos = 0;
    for (const item of plan.actualizar) {
        const valores = construirValoresPropiedades(item.fila, idioma);
        if (!item.reescribirCuerpo) {
            // Sin reescritura de cuerpo no hay ventana de inconsistencia:
            // todas las propiedades (Huella incluida, que no cambió) se
            // mandan juntas, como antes.
            await cliente.actualizarPropiedades(item.pageId, traducirPropiedades(valores, idioma));
            continue;
        }
        const documento = documentosValidos.find((d) => d.slug === item.fila.slug);
        if (!documento) continue;
        const { huella, ...valoresSinHuella } = valores;
        await cliente.actualizarPropiedades(item.pageId, traducirPropiedades(valoresSinHuella, idioma));
        await cliente.reescribirCuerpo(item.pageId, documento.tareas);
        await cliente.actualizarPropiedades(item.pageId, traducirPropiedades({ huella }, idioma));
        cuerposReescritos++;
    }

    const resumen: ResumenSincronizacion = {
        codigo: erroresDeFormato.length > 0 || hayProblemasNoFormato ? 1 : 0,
        creadas: plan.crear.length,
        actualizadas: plan.actualizar.length,
        cuerposReescritos,
        huerfanas: plan.huerfanas.map((h) => h.slug),
        erroresDeFormato,
        consultoNotion: true,
        duplicadas,
    };
    imprimirResumenFinal(log, resumen);
    return resumen;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const AYUDA = `
Sync del estado de las features (odd/tasks/*.md) hacia un tablero de Notion.

Uso:
  npx tsx src/sync-tablero-features.ts [--dry-run] [--ayuda]

  --dry-run   No escribe en Notion. Sin credenciales, imprime las filas
              calculadas desde el repositorio. Con credenciales, consulta
              Notion en modo lectura e imprime el plan (altas/actualizaciones/
              huérfanas) sin escribir nada.
  --ayuda     Muestra esta ayuda.

Variables de entorno requeridas (salvo con --dry-run):
  NOTION_TOKEN
  NOTION_TABLERO_DB_ID

Variables de entorno opcionales:
  BOARD_LANGUAGE   Idioma del tablero de Notion: "es" (por defecto) o "en".
`;

function principal(argumentos: string[]): void {
    if (argumentos.includes('--ayuda') || argumentos.includes('-h')) {
        console.log(AYUDA);
        process.exit(0);
    }

    const dryRun = argumentos.includes('--dry-run');
    const desconocidos = argumentos.filter((a) => !['--dry-run', '--ayuda', '-h'].includes(a));
    if (desconocidos.length > 0) {
        console.error(`Opción desconocida: ${desconocidos.join(', ')}`);
        console.error('Usá --ayuda para ver las opciones disponibles.');
        process.exit(1);
    }

    const raizRepo = process.cwd();
    const ejecutar: EjecutarComando = (comando, args) =>
        execFileSync(comando, args, { encoding: 'utf8', cwd: raizRepo, maxBuffer: 1024 * 1024 * 32 });
    const fetchInyectado: FetchInyectado = (url, init) => fetch(url, init as RequestInit);

    sincronizar(
        { dryRun },
        {
            raizRepo,
            ejecutar,
            fetchInyectado,
            listarDocumentos: () => listarDocumentosODD(raizRepo),
            log: (linea) => console.log(linea),
        },
    )
        .then((resumen) => {
            // El resumen final (contadores o el aviso de "no calculado", más
            // los errores de formato) ya se imprimió dentro de "sincronizar"
            // vía el "log" inyectado — acá solo queda salir con su código.
            process.exit(resumen.codigo);
        })
        .catch((error: unknown) => {
            console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
            process.exit(1);
        });
}

/**
 * Se ejecuta solo cuando el script se invoca directamente (tsx/node), nunca
 * cuando lo importa un test. Se compara contra `process.argv[1]` en vez de
 * `import.meta.url` porque Jest transpila este archivo a CommonJS.
 */
const invocadoDirectamente = /sync-tablero-features\.(ts|js|mjs|cjs)$/.test(
    (process.argv[1] ?? '').replace(/\\/g, '/'),
);
if (invocadoDirectamente) {
    principal(process.argv.slice(2));
}
