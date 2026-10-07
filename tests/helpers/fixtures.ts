/**
 * Fixtures y fakes compartidos por los tests (documentos, filas, `ejecutar`
 * falso, fetch falso y un Notion falso completo en memoria).
 */
import { type FilaTablero, type TareaDocumento } from '../../src/core/types';
import { type FetchInyectado } from '../../src/ports/notion';
import { type EjecutarComando } from '../../src/ports/sincronizar';

// ---------------------------------------------------------------------------
// Fixtures y helpers compartidos
// ---------------------------------------------------------------------------

/** Documento ODD mínimo válido, con una sola tarea hecha. Los tests que
 *  necesitan otra forma pasan overrides puntuales. */
export function docBase(
    partes: Partial<{ frontmatter: string; titulo: string; seccionTareas: string }> = {},
): string {
    const frontmatter = partes.frontmatter ?? '---\nramas: ["feat/x"]\n---';
    const titulo = partes.titulo ?? '# Feature X';
    const seccionTareas =
        partes.seccionTareas ?? ['## Tareas', '', '- [x] **T1 — Uno**: hace algo.'].join('\n');
    return [frontmatter, '', titulo, '', seccionTareas, ''].join('\n');
}

export function filaBase(overrides: Partial<FilaTablero> = {}): FilaTablero {
    return {
        feature: 'Feature X',
        slug: 'feature-x',
        estado: 'En curso',
        progreso: '1/2 tareas',
        pendiente: 'T2 — Dos',
        prsAbiertos: '#1',
        ramas: 'feat/x',
        diasSinActividad: 5,
        actualizado: '2026-09-01T00:00:00.000Z',
        documento: 'https://github.com/owner/repo/blob/master/odd/tasks/feature-x.md',
        huella: 'abc123',
        ...overrides,
    };
}

export function tarea(overrides: Partial<TareaDocumento> = {}): TareaDocumento {
    return {
        id: 'T1',
        nombre: 'Uno',
        descripcion: 'hace algo',
        hecha: false,
        esQA: false,
        ...overrides,
    };
}

/** Fabrica un `ejecutar` inyectable que responde según el comando/args, sin
 *  tocar git/gh reales. Lanza si recibe un comando no configurado a propósito
 *  (así un test que dependa de una llamada no prevista falla ruidosamente). */
export function crearEjecutarFalso(respuestas: {
    ramas?: string;
    prs?: string;
    fechasPorSlug?: Record<string, string>;
    ownerRepo?: string;
    /** sha (tal cual aparece en "commits") → fecha ISO de "git show". Un sha
     *  ausente de este mapa simula un commit que no existe en el repo: el
     *  "ejecutar" falso lanza, igual que el "git show" real. */
    commits?: Record<string, string>;
    /** Respuesta de "git rev-parse --is-shallow-repository". Por defecto
     *  "false" (repo completo) — solo importa cuando algún documento declara
     *  "commits", que es lo único que dispara esa consulta. */
    superficial?: boolean;
    /** Si es true, CUALQUIER comando "git" lanza (simula que git no puede
     *  correr, ej. ENOENT). */
    gitNoDisponible?: boolean;
}): EjecutarComando {
    return (comando: string, args: string[]) => {
        if (comando === 'git' && respuestas.gitNoDisponible) {
            throw new Error('ejecutar falso: spawn git ENOENT');
        }
        if (comando === 'git' && args[0] === 'rev-parse' && args[1] === '--is-shallow-repository') {
            return respuestas.superficial ? 'true' : 'false';
        }
        if (comando === 'git' && args[0] === 'for-each-ref') return respuestas.ramas ?? '';
        if (comando === 'gh' && args[0] === 'pr' && args[1] === 'list') return respuestas.prs ?? '[]';
        if (comando === 'git' && args[0] === 'log') {
            const rutaArg = args[args.length - 1];
            const slug = rutaArg.replace(/^odd\/tasks\//, '').replace(/\.md$/, '');
            return respuestas.fechasPorSlug?.[slug] ?? '';
        }
        if (comando === 'git' && args[0] === 'show') {
            const sha = args[args.length - 1];
            const fecha = respuestas.commits?.[sha];
            if (fecha === undefined) {
                throw new Error(`ejecutar falso: "git show" para un commit inexistente: ${sha}`);
            }
            return fecha;
        }
        if (comando === 'gh' && args[0] === 'repo' && args[1] === 'view') {
            return JSON.stringify({ nameWithOwner: respuestas.ownerRepo ?? 'owner/repo' });
        }
        throw new Error(`ejecutar falso: comando no simulado en este test: ${comando} ${args.join(' ')}`);
    };
}

/** Respuesta fetch falsa, con headers case-insensitive como el fetch real. */
export function respuestaFalsa(status: number, cuerpo: unknown, headers: Record<string, string> = {}) {
    const normalizados: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) normalizados[k.toLowerCase()] = v;
    return Promise.resolve({
        status,
        headers: { get: (nombre: string) => normalizados[nombre.toLowerCase()] ?? null },
        text: () => Promise.resolve(JSON.stringify(cuerpo)),
    });
}

export const ESQUEMA_CORRECTO_NOTION: Record<string, { type: string }> = {
    Feature: { type: 'title' },
    Slug: { type: 'rich_text' },
    Estado: { type: 'select' },
    Progreso: { type: 'rich_text' },
    Pendiente: { type: 'rich_text' },
    'PRs abiertos': { type: 'rich_text' },
    Ramas: { type: 'rich_text' },
    'Días sin actividad': { type: 'number' },
    Actualizado: { type: 'date' },
    Documento: { type: 'url' },
    Huella: { type: 'rich_text' },
};

export function propiedadesMinimas(slug: string, huella: string) {
    return {
        Slug: { rich_text: [{ type: 'text', text: { content: slug } }] },
        Huella: { rich_text: [{ type: 'text', text: { content: huella } }] },
    };
}

/** Servidor Notion falso, en memoria, que entiende lo suficiente de la API
 *  real (verificada con context7) para ejercer el flujo completo de
 *  `sincronizar`: esquema, query paginada, crear página, actualizar
 *  propiedades, listar/borrar/agregar bloques hijos. */
export interface PaginaFalsa {
    id: string;
    properties: Record<string, unknown>;
    hijos: Array<{ blockId: string; bloque: Record<string, unknown> }>;
    createdTime?: string;
}

export function crearNotionFalsoCompleto(esquema: Record<string, { type: string }>) {
    // Un ID de 32 hex "de verdad" (no "db-fake"): con la validación de T7,
    // "databaseId" pasa por "normalizarIdBaseNotion" antes de cualquier
    // llamada de red, así que tiene que parecer un ID real de Notion.
    const databaseId = '0123456789abcdef0123456789abcdef';
    const dataSourceId = 'ds-fake';
    let contadorPagina = 1;
    let contadorBloque = 1;
    const paginas = new Map<string, PaginaFalsa>();
    const llamadas = { crearPagina: 0, actualizarPropiedades: 0, borrarBloque: 0, agregarHijos: 0 };

    // Permite simular que una operación puntual falla (para probar que la
    // Huella se escribe al final, ver fix "Huella al final" del review de
    // T3): la N-ésima llamada a esa operación devuelve un 400 en vez de
    // procesarse con normalidad.
    let fallarEnOperacion: keyof typeof llamadas | null = null;
    let fallarEnNumero = 0;
    function debeFallarAhora(operacion: keyof typeof llamadas): boolean {
        return fallarEnOperacion === operacion && llamadas[operacion] === fallarEnNumero;
    }

    function envolverHijos(
        bloques: Record<string, unknown>[],
    ): Array<{ blockId: string; bloque: Record<string, unknown> }> {
        return bloques.map((b) => ({ blockId: `block-${contadorBloque++}`, bloque: b }));
    }

    const fetchFalso: FetchInyectado = async (url, init) => {
        const ruta = url.replace('https://api.notion.com/v1', '');
        const metodo = init.method;
        const cuerpo = init.body ? JSON.parse(init.body) : undefined;

        if (metodo === 'GET' && ruta === `/databases/${databaseId}`) {
            return respuestaFalsa(200, { data_sources: [{ id: dataSourceId, name: 'Tablero' }] });
        }
        if (metodo === 'GET' && ruta === `/data_sources/${dataSourceId}`) {
            return respuestaFalsa(200, { properties: esquema });
        }
        if (metodo === 'POST' && ruta === `/data_sources/${dataSourceId}/query`) {
            const resultados = [...paginas.values()].map((p) => ({
                id: p.id,
                properties: p.properties,
                created_time: p.createdTime,
            }));
            return respuestaFalsa(200, { results: resultados, has_more: false, next_cursor: null });
        }
        if (metodo === 'POST' && ruta === '/pages') {
            llamadas.crearPagina++;
            if (debeFallarAhora('crearPagina')) return respuestaFalsa(400, { code: 'forced_failure_for_test' });
            const id = `page-${contadorPagina++}`;
            paginas.set(id, {
                id,
                properties: cuerpo.properties,
                hijos: envolverHijos(cuerpo.children ?? []),
                createdTime: new Date().toISOString(),
            });
            return respuestaFalsa(200, { id });
        }
        const matchPatchPage = /^\/pages\/([^/]+)$/.exec(ruta);
        if (metodo === 'PATCH' && matchPatchPage) {
            llamadas.actualizarPropiedades++;
            if (debeFallarAhora('actualizarPropiedades')) {
                return respuestaFalsa(400, { code: 'forced_failure_for_test' });
            }
            const pagina = paginas.get(matchPatchPage[1]);
            if (pagina) pagina.properties = { ...pagina.properties, ...cuerpo.properties };
            return respuestaFalsa(200, { id: matchPatchPage[1] });
        }
        const matchChildren = /^\/blocks\/([^/]+)\/children$/.exec(ruta);
        if (metodo === 'GET' && matchChildren) {
            const pagina = paginas.get(matchChildren[1]);
            const resultados = (pagina?.hijos ?? []).map((h) => ({ id: h.blockId, ...h.bloque }));
            return respuestaFalsa(200, { results: resultados, has_more: false, next_cursor: null });
        }
        if (metodo === 'PATCH' && matchChildren) {
            llamadas.agregarHijos++;
            if (debeFallarAhora('agregarHijos')) return respuestaFalsa(400, { code: 'forced_failure_for_test' });
            const pagina = paginas.get(matchChildren[1]);
            if (pagina) pagina.hijos.push(...envolverHijos(cuerpo.children ?? []));
            return respuestaFalsa(200, {});
        }
        const matchDelete = /^\/blocks\/([^/]+)$/.exec(ruta);
        if (metodo === 'DELETE' && matchDelete) {
            llamadas.borrarBloque++;
            if (debeFallarAhora('borrarBloque')) return respuestaFalsa(400, { code: 'forced_failure_for_test' });
            for (const pagina of paginas.values()) {
                const idx = pagina.hijos.findIndex((h) => h.blockId === matchDelete[1]);
                if (idx !== -1) {
                    pagina.hijos.splice(idx, 1);
                    break;
                }
            }
            return respuestaFalsa(200, {});
        }

        throw new Error(`Notion falso: ruta no simulada: ${metodo} ${ruta}`);
    };

    return {
        fetchFalso,
        paginas,
        llamadas,
        databaseId,
        /** La llamada NÚMERO "numero" (1-based, contando desde que arrancó
         *  esta instancia del fake) a "operacion" falla con un 400. */
        forzarFalloEn(operacion: keyof typeof llamadas, numero: number) {
            fallarEnOperacion = operacion;
            fallarEnNumero = numero; // "llamadas[operacion]" ya se incrementó cuando se compara
        },
    };
}

/**
 * Envuelve un `FetchInyectado` para que la PRIMERA llamada que matchee
 * "coincide" nunca le llegue una respuesta al cliente (simula que Notion
 * cortó la conexión justo antes/después de aplicar el cambio): si `modo` es
 * "aplicada", el request real SÍ se ejecuta contra el fake (mutando su
 * estado) antes de "perderse"; si es "no-aplicada", ni siquiera se ejecuta.
 * En ambos casos, lo que le llega al cliente es un rechazo tipo timeout.
 */
export function conRespuestaPerdidaUnaVez(
    original: FetchInyectado,
    coincide: (url: string, init: Parameters<FetchInyectado>[1]) => boolean,
    modo: 'aplicada' | 'no-aplicada',
): FetchInyectado {
    let yaOcurrio = false;
    return async (url, init) => {
        if (!yaOcurrio && coincide(url, init)) {
            yaOcurrio = true;
            if (modo === 'aplicada') await original(url, init);
            throw new DOMException('The operation was aborted.', 'AbortError');
        }
        return original(url, init);
    };
}

export function seccionConNTareas(n: number): string {
    const lineas = ['## Tareas', ''];
    for (let i = 1; i <= n; i++) {
        lineas.push(`- [ ] **T${i} — Tarea ${i}**: desc ${i}.`);
    }
    return lineas.join('\n');
}

export const ESQUEMA_CORRECTO_NOTION_EN: Record<string, { type: string }> = {
    Feature: { type: 'title' },
    Slug: { type: 'rich_text' },
    Status: { type: 'select' },
    Progress: { type: 'rich_text' },
    Pending: { type: 'rich_text' },
    'Open PRs': { type: 'rich_text' },
    Branches: { type: 'rich_text' },
    'Days inactive': { type: 'number' },
    Updated: { type: 'date' },
    Document: { type: 'url' },
    Fingerprint: { type: 'rich_text' },
};

/** Corre `fn` con BOARD_LANGUAGE fijado (o borrado si `valor` es undefined)
 *  y restaura el valor previo al terminar, pase lo que pase. */
export async function conBoardLanguage<T>(valor: string | undefined, fn: () => Promise<T>): Promise<T> {
    const previo = process.env.BOARD_LANGUAGE;
    if (valor === undefined) delete process.env.BOARD_LANGUAGE;
    else process.env.BOARD_LANGUAGE = valor;
    try {
        return await fn();
    } finally {
        if (previo === undefined) delete process.env.BOARD_LANGUAGE;
        else process.env.BOARD_LANGUAGE = previo;
    }
}

/** Base de Tareas: las mismas columnas que el tablero de Features, con
 *  "Tarea" ("Task" en inglés) como título. */
export const ESQUEMA_CORRECTO_NOTION_TAREAS: Record<string, { type: string }> = Object.fromEntries(
    Object.entries(ESQUEMA_CORRECTO_NOTION).map(([nombre, tipo]) => [nombre === 'Feature' ? 'Tarea' : nombre, tipo]),
);

export const ESQUEMA_CORRECTO_NOTION_TAREAS_EN: Record<string, { type: string }> = Object.fromEntries(
    Object.entries(ESQUEMA_CORRECTO_NOTION_EN).map(([nombre, tipo]) => [nombre === 'Feature' ? 'Task' : nombre, tipo]),
);
