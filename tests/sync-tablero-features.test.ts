/**
 * @jest-environment node
 *
 * Tests del sync de estado de features hacia Notion (T3).
 *
 * Los casos NO leen `odd/tasks/` real: los documentos son strings fixture
 * dentro del propio test (convención de la casa, ver
 * `validar-rutas-docs.test.ts`), así que mover o editar un archivo del repo
 * no puede volver estos tests rojos por accidente.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    type ClienteNotion,
    type DocumentoODD,
    type Dormir,
    type EjecutarComando,
    type FetchInyectado,
    type FilaTablero,
    type PaginaExistente,
    type PropiedadesNotion,
    type PullRequestInfo,
    type TareaDocumento,
    calcularActualizado,
    calcularHuella,
    coincideRama,
    construirFila,
    construirPropiedadesNotion,
    crearClienteNotion,
    derivarEstado,
    diasSinActividad,
    listarDocumentosODD,
    normalizarIdBaseNotion,
    parsearDocumento,
    planificarSync,
    resolverDuplicadosPorSlug,
    sincronizar,
    validarEsquema,
} from '../src/sync-tablero-features';

// ---------------------------------------------------------------------------
// Fixtures y helpers compartidos
// ---------------------------------------------------------------------------

/** Documento ODD mínimo válido, con una sola tarea hecha. Los tests que
 *  necesitan otra forma pasan overrides puntuales. */
function docBase(
    partes: Partial<{ frontmatter: string; titulo: string; seccionTareas: string }> = {},
): string {
    const frontmatter = partes.frontmatter ?? '---\nramas: ["feat/x"]\n---';
    const titulo = partes.titulo ?? '# Feature X';
    const seccionTareas =
        partes.seccionTareas ?? ['## Tareas', '', '- [x] **T1 — Uno**: hace algo.'].join('\n');
    return [frontmatter, '', titulo, '', seccionTareas, ''].join('\n');
}

function filaBase(overrides: Partial<FilaTablero> = {}): FilaTablero {
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

function tarea(overrides: Partial<TareaDocumento> = {}): TareaDocumento {
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
function crearEjecutarFalso(respuestas: {
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
function respuestaFalsa(status: number, cuerpo: unknown, headers: Record<string, string> = {}) {
    const normalizados: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) normalizados[k.toLowerCase()] = v;
    return Promise.resolve({
        status,
        headers: { get: (nombre: string) => normalizados[nombre.toLowerCase()] ?? null },
        text: () => Promise.resolve(JSON.stringify(cuerpo)),
    });
}

const ESQUEMA_CORRECTO_NOTION: Record<string, { type: string }> = {
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

function propiedadesMinimas(slug: string, huella: string) {
    return {
        Slug: { rich_text: [{ type: 'text', text: { content: slug } }] },
        Huella: { rich_text: [{ type: 'text', text: { content: huella } }] },
    };
}

/** Servidor Notion falso, en memoria, que entiende lo suficiente de la API
 *  real (verificada con context7) para ejercer el flujo completo de
 *  `sincronizar`: esquema, query paginada, crear página, actualizar
 *  propiedades, listar/borrar/agregar bloques hijos. */
interface PaginaFalsa {
    id: string;
    properties: Record<string, unknown>;
    hijos: Array<{ blockId: string; bloque: Record<string, unknown> }>;
    createdTime?: string;
}

function crearNotionFalsoCompleto(esquema: Record<string, { type: string }>) {
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

// ---------------------------------------------------------------------------
// parsearDocumento
// ---------------------------------------------------------------------------

describe('parsearDocumento', () => {
    test('salta un bloque de código que contiene una "## Tareas" de ejemplo con checkboxes falsos', () => {
        const contenido = [
            '---',
            'ramas: ["feat/ejemplo-*"]',
            '---',
            '',
            '# Feature de ejemplo',
            '',
            '## Formato',
            '',
            '```markdown',
            '---',
            'ramas: ["feat/checkout-*"]',
            '---',
            '',
            '# Título legible de la feature',
            '',
            '## Tareas',
            '',
            '- [x] **T1 — Nombre corto**: descripción.',
            '- [ ] **T2 — Nombre corto**: descripción.',
            '- [ ] **QA1 — Smoke test en Android**: descripción.',
            '```',
            '',
            '## Tareas',
            '',
            '- [x] **T1 — Primera**: uno.',
            '- [x] **T2 — Segunda**: dos.',
            '- [ ] **T3 — Tercera**: tres.',
            '- [ ] **QA1 — Cuarta**: cuatro.',
        ].join('\n');

        const resultado = parsearDocumento('ejemplo', contenido);

        expect(resultado.ok).toBe(true);
        if (resultado.ok) {
            expect(resultado.documento.tareas.map((t) => t.id)).toEqual(['T1', 'T2', 'T3', 'QA1']);
        }
    });

    test('una tarea sin ": descripción" (solo "**ID — Nombre**." a secas) es válida (caso real del repo)', () => {
        // Regla normativa del contrato: "un ID en negrita al principio" es lo
        // único obligatorio; ": descripción" es el estilo del ejemplo, no un
        // requisito. odd/tasks/qa-venta-fraccionada.md mezcla ambos estilos en
        // el mismo archivo.
        const contenido = docBase({
            seccionTareas: [
                '## Tareas',
                '',
                '- [x] **T1 — Publicar el plan de QA como artifact**: hecho, 2026-08-25.',
                '- [ ] **QA1 — Ejecutar los pasos de Configuración (a1-a14)**.',
            ].join('\n'),
        });

        const resultado = parsearDocumento('qa-venta-fraccionada', contenido);

        expect(resultado.ok).toBe(true);
        if (resultado.ok) {
            expect(resultado.documento.tareas).toEqual([
                {
                    id: 'T1',
                    nombre: 'Publicar el plan de QA como artifact',
                    descripcion: 'hecho, 2026-08-25.',
                    hecha: true,
                    esQA: false,
                },
                {
                    id: 'QA1',
                    nombre: 'Ejecutar los pasos de Configuración (a1-a14)',
                    descripcion: '',
                    hecha: false,
                    esQA: true,
                },
            ]);
        }
    });

    test('un bloque de 4 backticks con una línea de 3 backticks adentro no se cierra ahí', () => {
        const contenido = [
            '---',
            'ramas: []',
            '---',
            '',
            '# Título',
            '',
            '````',
            '## Tareas',
            '```',
            '- [ ] **FAKE1 — no debería contar**: nada.',
            '````',
            '',
            '## Tareas',
            '',
            '- [ ] **T1 — Real**: desc.',
        ].join('\n');

        const resultado = parsearDocumento('fence', contenido);

        expect(resultado.ok).toBe(true);
        if (resultado.ok) {
            expect(resultado.documento.tareas.map((t) => t.id)).toEqual(['T1']);
        }
    });

    test('parsea un documento válido con ramas, título y tareas QA/no-QA', () => {
        const contenido = docBase({
            seccionTareas: [
                '## Tareas',
                '',
                '- [x] **T1 — Uno**: hace algo.',
                '- [ ] **QA1 — Smoke test**: probar a mano.',
            ].join('\n'),
        });

        const resultado = parsearDocumento('mi-feature', contenido);

        expect(resultado.ok).toBe(true);
        if (resultado.ok) {
            expect(resultado.documento.slug).toBe('mi-feature');
            expect(resultado.documento.ramas).toEqual(['feat/x']);
            expect(resultado.documento.titulo).toBe('Feature X');
            expect(resultado.documento.tareas).toEqual([
                { id: 'T1', nombre: 'Uno', descripcion: 'hace algo.', hecha: true, esQA: false },
                { id: 'QA1', nombre: 'Smoke test', descripcion: 'probar a mano.', hecha: false, esQA: true },
            ]);
        }
    });

    test('"[X]" mayúscula cuenta como hecha, y CRLF + BOM no rompen el parseo', () => {
        const contenidoLF = docBase({
            seccionTareas: ['## Tareas', '', '- [X] **T1 — Uno**: listo.'].join('\n'),
        });
        const contenidoConBomYCrlf = '﻿' + contenidoLF.replace(/\n/g, '\r\n');

        const resultado = parsearDocumento('feature-x', contenidoConBomYCrlf);

        expect(resultado.ok).toBe(true);
        if (resultado.ok) {
            expect(resultado.documento.tareas[0].hecha).toBe(true);
        }
    });

    test('frontmatter faltante (la línea 1 no es "---") se reporta como error', () => {
        const contenido = ['# Sin frontmatter', '', '## Tareas', '', '- [ ] **T1 — Uno**: x.'].join('\n');
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) {
            expect(resultado.errores.some((e) => /frontmatter/i.test(e))).toBe(true);
        }
    });

    test('frontmatter sin línea de cierre "---" se reporta como error', () => {
        const contenido = ['---', 'ramas: ["feat/x"]', '', '# Título', '', '## Tareas', '', '- [ ] **T1 — Uno**: x.'].join(
            '\n',
        );
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.some((e) => /frontmatter/i.test(e))).toBe(true);
    });

    test('"ramas" con comillas simples (JSON inválido) se reporta como error', () => {
        const contenido = docBase({ frontmatter: "---\nramas: ['feat/x']\n---" });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) {
            expect(resultado.errores.some((e) => /ramas/i.test(e) && /json|comillas/i.test(e))).toBe(true);
        }
    });

    test('"ramas" que no es un array se reporta como error', () => {
        const contenido = docBase({ frontmatter: '---\nramas: "feat/x"\n---' });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.some((e) => /ramas/i.test(e) && /array/i.test(e))).toBe(true);
    });

    test('"ramas" con un elemento que no es string se reporta como error', () => {
        const contenido = docBase({ frontmatter: '---\nramas: ["feat/x", 1]\n---' });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.some((e) => /ramas/i.test(e))).toBe(true);
    });

    test('frontmatter sin la clave "ramas" se reporta como error', () => {
        const contenido = docBase({ frontmatter: '---\notracosa: 1\n---' });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.some((e) => /ramas/i.test(e))).toBe(true);
    });

    test('una clave desconocida en el frontmatter (ni "ramas" ni "commits") se reporta como error', () => {
        const contenido = docBase({ frontmatter: '---\nramas: ["feat/x"]\notracosa: 1\n---' });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) {
            expect(resultado.errores.some((e) => /frontmatter/i.test(e) && /clave desconocida/i.test(e))).toBe(
                true,
            );
        }
    });

    test('el frontmatter acepta "ramas" y "commits" juntos, en cualquier orden', () => {
        const contenidoConmitsPrimero = docBase({
            frontmatter:
                '---\ncommits: ["85f7e8e0dbf967bdce4c0948c46a9468ea9bb65a", "6113641f4805af66004bab57a8ab0a464fd2cffc"]\nramas: []\n---',
        });
        const resultado = parsearDocumento('scanner-carrito-continuo', contenidoConmitsPrimero);

        expect(resultado.ok).toBe(true);
        if (resultado.ok) {
            expect(resultado.documento.ramas).toEqual([]);
            expect(resultado.documento.commits).toEqual([
                '85f7e8e0dbf967bdce4c0948c46a9468ea9bb65a',
                '6113641f4805af66004bab57a8ab0a464fd2cffc',
            ]);
        }
    });

    test('sin la clave "commits", el documento queda con "commits: []"', () => {
        const resultado = parsearDocumento('x', docBase());
        expect(resultado.ok).toBe(true);
        if (resultado.ok) expect(resultado.documento.commits).toEqual([]);
    });

    test('"commits" con un hash no hexadecimal se reporta como error', () => {
        const contenido = docBase({ frontmatter: '---\nramas: []\ncommits: ["zzzzzzz"]\n---' });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.some((e) => /commits/i.test(e))).toBe(true);
    });

    test('"commits" con un hash demasiado corto (menos de 7 caracteres) se reporta como error', () => {
        const contenido = docBase({ frontmatter: '---\nramas: []\ncommits: ["ab12"]\n---' });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.some((e) => /commits/i.test(e))).toBe(true);
    });

    test('"commits" con un hash abreviado de 7 caracteres (antes válido) ahora se rechaza (fix 6 del review de T3)', () => {
        // El contrato exige el hash COMPLETO (40 caracteres): uno abreviado
        // puede volverse ambiguo cuando el repo crece.
        const contenido = docBase({ frontmatter: '---\nramas: []\ncommits: ["6113641"]\n---' });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) {
            expect(resultado.errores.some((e) => /commits/i.test(e) && /completo/i.test(e))).toBe(true);
        }
    });

    test('"commits" con un hash demasiado largo (más de 40 caracteres) se reporta como error', () => {
        const contenido = docBase({
            frontmatter: `---\nramas: []\ncommits: ["${'a'.repeat(41)}"]\n---`,
        });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.some((e) => /commits/i.test(e))).toBe(true);
    });

    test('"commits" en mayúsculas (no minúsculas) se reporta como error', () => {
        const contenido = docBase({
            frontmatter: '---\nramas: []\ncommits: ["85F7E8E0DBF967BDCE4C0948C46A9468EA9BB65A"]\n---',
        });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.some((e) => /commits/i.test(e))).toBe(true);
    });

    test('"commits" que no es un array se reporta como error', () => {
        const contenido = docBase({ frontmatter: '---\nramas: []\ncommits: "85f7e8e"\n---' });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.some((e) => /commits/i.test(e))).toBe(true);
    });

    test('sin título (ningún "# " fuera de bloques de código) se reporta como error', () => {
        const contenido = docBase({ titulo: 'Esto no es un título' });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.some((e) => /título/i.test(e))).toBe(true);
    });

    test('sin ninguna sección "## Tareas" se reporta como error', () => {
        const contenido = docBase({ seccionTareas: '## Otra Sección\n\nNada.' });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.some((e) => /tareas/i.test(e))).toBe(true);
    });

    test('con dos secciones "## Tareas" se reporta como error', () => {
        const contenido = docBase({
            seccionTareas: [
                '## Tareas',
                '',
                '- [x] **T1 — Uno**: x.',
                '',
                '## Tareas',
                '',
                '- [ ] **T2 — Dos**: y.',
            ].join('\n'),
        });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.some((e) => /tareas/i.test(e))).toBe(true);
    });

    test('una sección "## Tareas" sin ninguna tarea se reporta como error', () => {
        const contenido = docBase({ seccionTareas: '## Tareas\n\nNada por acá.' });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.some((e) => /tareas/i.test(e))).toBe(true);
    });

    test('un checkbox bajo "## Tareas" sin ID válido se reporta como error', () => {
        const contenido = docBase({
            seccionTareas: ['## Tareas', '', '- [ ] **sin id valido**: x.'].join('\n'),
        });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.some((e) => /ID/.test(e))).toBe(true);
    });

    test('un checkbox con guion común en vez de raya (—) se reporta con mensaje explícito', () => {
        const contenido = docBase({
            seccionTareas: ['## Tareas', '', '- [ ] **T1 - Nombre corto**: x.'].join('\n'),
        });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) {
            expect(resultado.errores.some((e) => e.includes('—') && /raya/i.test(e))).toBe(true);
        }
    });

    test('checkboxes fuera de "## Tareas" se ignoran, no cuentan como error ni como tarea', () => {
        const contenido = [
            '---',
            'ramas: []',
            '---',
            '',
            '# Título',
            '',
            '## Problema',
            '',
            '- [ ] esto no es una tarea real',
            '',
            '## Tareas',
            '',
            '- [x] **T1 — Uno**: x.',
        ].join('\n');

        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(true);
        if (resultado.ok) expect(resultado.documento.tareas).toHaveLength(1);
    });

    test('reporta TODOS los errores de formato juntos, no solo el primero', () => {
        const contenido = [
            '# Sin frontmatter',
            '',
            '## Tareas',
            '',
            '- [ ] **T1 - Guion común**: x.',
            '- [ ] checkbox sin negrita',
        ].join('\n');

        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.length).toBeGreaterThanOrEqual(2);
    });
});

// ---------------------------------------------------------------------------
// coincideRama
// ---------------------------------------------------------------------------

describe('coincideRama', () => {
    test('el comodín "*" matchea cualquier secuencia, incluida la barra', () => {
        expect(coincideRama('feat/checkout-*', 'feat/checkout-cupones')).toBe(true);
        expect(coincideRama('feat/checkout-*', 'feat/checkout-cupones/sub')).toBe(true);
    });

    test('el patrón está anclado por completo: no matchea un prefijo ni un sufijo suelto', () => {
        expect(coincideRama('feat/x', 'feat/x-extra')).toBe(false);
        expect(coincideRama('feat/x', 'otra/feat/x')).toBe(false);
        expect(coincideRama('feat/x*', 'feat/x')).toBe(true); // "*" también matchea vacío
    });

    test('los caracteres especiales de regex se tratan como literales', () => {
        expect(coincideRama('feat/x.y+z(1)', 'feat/x.y+z(1)')).toBe(true);
        expect(coincideRama('feat/x.y+z(1)', 'feat/xAy+z(1)')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// derivarEstado
// ---------------------------------------------------------------------------

describe('derivarEstado', () => {
    test('"Terminada": todas hechas y cero PRs abiertos', () => {
        expect(derivarEstado([tarea({ hecha: true }), tarea({ id: 'T2', hecha: true })], 0)).toBe(
            'Terminada',
        );
    });

    test('"QA pendiente": quedan sin hacer y todas las sin hacer son QA', () => {
        const tareas = [tarea({ hecha: true }), tarea({ id: 'QA1', esQA: true, hecha: false })];
        expect(derivarEstado(tareas, 0)).toBe('QA pendiente');
    });

    test('"Sin empezar": cero tareas hechas', () => {
        const tareas = [tarea({ hecha: false }), tarea({ id: 'T2', hecha: false })];
        expect(derivarEstado(tareas, 0)).toBe('Sin empezar');
    });

    test('"En curso": el resto (mezcla de hechas y no-QA sin hacer)', () => {
        const tareas = [tarea({ hecha: true }), tarea({ id: 'T2', hecha: false })];
        expect(derivarEstado(tareas, 0)).toBe('En curso');
    });

    test('todas hechas pero con un PR abierto → "En curso", no "Terminada"', () => {
        const tareas = [tarea({ hecha: true }), tarea({ id: 'T2', hecha: true })];
        expect(derivarEstado(tareas, 1)).toBe('En curso');
    });

    test('solo quedan tareas QA sin hacer → "QA pendiente" con cualquier cantidad de PRs abiertos', () => {
        const tareas = [tarea({ hecha: true }), tarea({ id: 'QA1', esQA: true, hecha: false })];
        expect(derivarEstado(tareas, 2)).toBe('QA pendiente');
    });
});

// ---------------------------------------------------------------------------
// calcularActualizado
// ---------------------------------------------------------------------------

describe('calcularActualizado', () => {
    const HOY = new Date('2026-09-21T00:00:00Z');

    function pr(overrides: Partial<PullRequestInfo> & { updatedAt?: string } = {}): PullRequestInfo {
        return {
            number: 1,
            headRefName: 'feat/x',
            state: 'OPEN',
            createdAt: '2026-01-01T00:00:00Z',
            mergedAt: null,
            closedAt: null,
            ...overrides,
        } as PullRequestInfo;
    }

    test('ignora "updatedAt" y usa "mergedAt" de un PR mergeado con la rama ya borrada', () => {
        // Caso real observado en producción: una limpieza de ramas movió el
        // "updatedAt" de un PR a la fecha del borrado, aunque se había
        // mergeado semanas antes.
        const actualizado = calcularActualizado({
            ramasVivas: [],
            prs: [
                pr({
                    number: 168,
                    state: 'MERGED',
                    createdAt: '2026-08-25T00:00:00Z',
                    mergedAt: '2026-09-02T00:00:00Z',
                    updatedAt: '2026-09-13T13:30:00Z',
                }),
            ],
            fechaDocumento: null,
            hoy: HOY,
        });
        expect(actualizado).toBe(new Date('2026-09-02T00:00:00Z').toISOString());
    });

    test('un PR CLOSED (sin merge) toma "closedAt"', () => {
        const actualizado = calcularActualizado({
            ramasVivas: [],
            prs: [pr({ state: 'CLOSED', createdAt: '2026-01-01T00:00:00Z', closedAt: '2026-01-05T00:00:00Z' })],
            fechaDocumento: null,
            hoy: HOY,
        });
        expect(actualizado).toBe(new Date('2026-01-05T00:00:00Z').toISOString());
    });

    test('un PR OPEN toma "createdAt" cuando no hay rama viva más nueva', () => {
        const actualizado = calcularActualizado({
            ramasVivas: [],
            prs: [pr({ number: 109, headRefName: 'feat/checkout-a', state: 'OPEN', createdAt: '2026-08-19T00:00:00Z' })],
            fechaDocumento: null,
            hoy: HOY,
        });
        expect(actualizado).toBe(new Date('2026-08-19T00:00:00Z').toISOString());
    });

    test('una rama viva más nueva le gana a un PR abierto más viejo', () => {
        const actualizado = calcularActualizado({
            ramasVivas: [{ nombre: 'feat/checkout-a', fecha: '2026-09-01T00:00:00Z' }],
            prs: [pr({ number: 109, headRefName: 'feat/checkout-a', state: 'OPEN', createdAt: '2026-08-19T00:00:00Z' })],
            fechaDocumento: null,
            hoy: HOY,
        });
        expect(actualizado).toBe(new Date('2026-09-01T00:00:00Z').toISOString());
    });

    test('sin ramas ni PRs, cae a la fecha del documento', () => {
        const actualizado = calcularActualizado({
            ramasVivas: [],
            prs: [],
            fechaDocumento: '2026-09-20T00:00:00Z',
            hoy: HOY,
        });
        expect(actualizado).toBe(new Date('2026-09-20T00:00:00Z').toISOString());
    });

    test('sin ramas, PRs ni fecha de documento, cae a "hoy"', () => {
        const actualizado = calcularActualizado({ ramasVivas: [], prs: [], fechaDocumento: null, hoy: HOY });
        expect(actualizado).toBe(HOY.toISOString());
    });

    test('toma la fecha de un commit histórico ("commits") cuando no hay ramas ni PRs', () => {
        // Caso real: scanner-carrito-continuo y boton-atras-modales se hicieron
        // con commits directos a master (sin rama ni PR); sin este dato caían
        // al fallback de la fecha de siembra y escondían 52/40 días quietos.
        const actualizado = calcularActualizado({
            ramasVivas: [],
            prs: [],
            fechasCommits: ['2026-07-31T00:00:00Z'],
            fechaDocumento: '2026-09-21T00:00:00Z',
            hoy: HOY,
        });
        expect(actualizado).toBe(new Date('2026-07-31T00:00:00Z').toISOString());
    });

    test('una rama viva más nueva le gana a la fecha de un commit histórico', () => {
        const actualizado = calcularActualizado({
            ramasVivas: [{ nombre: 'feat/x', fecha: '2026-09-01T00:00:00Z' }],
            prs: [],
            fechasCommits: ['2026-07-31T00:00:00Z'],
            fechaDocumento: null,
            hoy: HOY,
        });
        expect(actualizado).toBe(new Date('2026-09-01T00:00:00Z').toISOString());
    });
});

// ---------------------------------------------------------------------------
// diasSinActividad
// ---------------------------------------------------------------------------

describe('diasSinActividad', () => {
    test('cuenta días enteros hacia abajo (floor)', () => {
        const hoy = new Date('2026-09-05T06:00:00Z'); // 3 días y 18h después de la actividad
        expect(diasSinActividad('2026-09-01T12:00:00Z', hoy)).toBe(3);
    });

    test('cero días si la actividad es hoy mismo', () => {
        const hoy = new Date('2026-09-21T10:00:00Z');
        expect(diasSinActividad(hoy.toISOString(), hoy)).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// calcularHuella
// ---------------------------------------------------------------------------

describe('calcularHuella', () => {
    const tareas: TareaDocumento[] = [
        tarea({ id: 'T1', nombre: 'Uno', descripcion: 'desc uno', hecha: true }),
        tarea({ id: 'T2', nombre: 'Dos', descripcion: 'desc dos', hecha: false }),
    ];

    test('es estable para la misma lista de tareas', () => {
        expect(calcularHuella(tareas)).toBe(calcularHuella([...tareas]));
    });

    test('cambia si se alterna un checkbox', () => {
        const modificadas = tareas.map((t, i) => (i === 1 ? { ...t, hecha: true } : t));
        expect(calcularHuella(modificadas)).not.toBe(calcularHuella(tareas));
    });
});

// ---------------------------------------------------------------------------
// construirFila
// ---------------------------------------------------------------------------

describe('construirFila', () => {
    const HOY = new Date('2026-09-21T00:00:00Z');

    test('arma todos los campos derivados de la fila', () => {
        const documento: DocumentoODD = {
            slug: 'checkout-cupones',
            ramas: ['feat/checkout-*'],
            commits: [],
            titulo: 'Reservas de tienda online',
            tareas: [tarea({ id: 'T1', nombre: 'Uno', hecha: true }), tarea({ id: 'T2', nombre: 'Dos', hecha: false })],
        };
        const fila = construirFila({
            documento,
            todasLasRamas: [{ nombre: 'feat/checkout-a', fecha: '2026-08-19T00:00:00Z' }],
            todosLosPRs: [
                {
                    number: 111,
                    headRefName: 'feat/checkout-a',
                    state: 'OPEN',
                    createdAt: '2026-08-19T00:00:00Z',
                    mergedAt: null,
                    closedAt: null,
                },
                {
                    number: 109,
                    headRefName: 'feat/checkout-b',
                    state: 'OPEN',
                    createdAt: '2026-08-15T00:00:00Z',
                    mergedAt: null,
                    closedAt: null,
                },
            ],
            fechaDocumento: null,
            hoy: HOY,
            ownerRepo: 'mi-org/mi-repo',
        });

        expect(fila.feature).toBe('Reservas de tienda online');
        expect(fila.slug).toBe('checkout-cupones');
        expect(fila.estado).toBe('En curso');
        expect(fila.progreso).toBe('1/2 tareas');
        expect(fila.pendiente).toBe('T2 — Dos');
        expect(fila.prsAbiertos).toBe('#109, #111');
        expect(fila.ramas).toBe('feat/checkout-a');
        expect(fila.documento).toBe(
            // Rama base por defecto de la plantilla: "main" (configurable vía
            // TABLERO_RAMA_BASE; el proyecto de origen usaba "master").
            'https://github.com/mi-org/mi-repo/blob/main/odd/tasks/checkout-cupones.md',
        );
        expect(fila.huella).toHaveLength(64); // sha256 en hex
    });

    test('recorta textos largos a 1900 caracteres con "…" (límite de Notion)', () => {
        const ramasLargas = Array.from({ length: 400 }, (_, i) => `feat/rama-larga-numero-${i}`);
        const documento: DocumentoODD = {
            slug: 'feature-con-muchas-ramas',
            ramas: ['feat/rama-larga-*'],
            commits: [],
            titulo: 'Feature con muchas ramas',
            tareas: [tarea({ hecha: false })],
        };
        const fila = construirFila({
            documento,
            todasLasRamas: ramasLargas.map((nombre) => ({ nombre, fecha: '2026-09-01T00:00:00Z' })),
            todosLosPRs: [],
            fechaDocumento: null,
            hoy: HOY,
            ownerRepo: 'owner/repo',
        });

        expect(fila.ramas).toHaveLength(1900);
        expect(fila.ramas.endsWith('…')).toBe(true);
    });

    test('sin tareas pendientes, "pendiente" queda vacío', () => {
        const documento: DocumentoODD = {
            slug: 'feature-completa',
            ramas: [],
            commits: [],
            titulo: 'Feature completa',
            tareas: [tarea({ hecha: true })],
        };
        const fila = construirFila({
            documento,
            todasLasRamas: [],
            todosLosPRs: [],
            fechaDocumento: '2026-09-01T00:00:00Z',
            hoy: HOY,
            ownerRepo: 'owner/repo',
        });
        expect(fila.pendiente).toBe('');
    });

    test('sin ramas ni PRs pero con "commits" (fechas ya resueltas), "actualizado" toma la fecha del commit', () => {
        // Caso real: scanner-carrito-continuo (commit directo a master, sin
        // rama ni PR) — sin este dato el fallback sería la fecha de siembra.
        const documento: DocumentoODD = {
            slug: 'scanner-carrito-continuo',
            ramas: [],
            commits: ['85f7e8e0dbf967bdce4c0948c46a9468ea9bb65a'],
            titulo: 'Scanner carrito continuo',
            tareas: [tarea({ hecha: true })],
        };
        const fila = construirFila({
            documento,
            todasLasRamas: [],
            todosLosPRs: [],
            fechasCommits: ['2026-07-31T00:00:00Z'],
            fechaDocumento: '2026-09-21T00:00:00Z', // fecha de siembra: NO debe ganar
            hoy: HOY,
            ownerRepo: 'owner/repo',
        });
        expect(fila.actualizado).toBe(new Date('2026-07-31T00:00:00Z').toISOString());
    });
});

// ---------------------------------------------------------------------------
// construirPropiedadesNotion
// ---------------------------------------------------------------------------

describe('construirPropiedadesNotion', () => {
    test('genera los 11 nombres y tipos exactos que exige el esquema de Notion', () => {
        const fila = filaBase();
        const propiedades: PropiedadesNotion = construirPropiedadesNotion(fila);

        expect(propiedades.Feature.title[0].text.content).toBe('Feature X');
        expect(propiedades.Slug.rich_text[0].text.content).toBe('feature-x');
        expect(propiedades.Estado.select.name).toBe('En curso');
        expect(propiedades.Progreso.rich_text[0].text.content).toBe('1/2 tareas');
        expect(propiedades.Pendiente.rich_text[0].text.content).toBe('T2 — Dos');
        expect(propiedades['PRs abiertos'].rich_text[0].text.content).toBe('#1');
        expect(propiedades.Ramas.rich_text[0].text.content).toBe('feat/x');
        expect(propiedades['Días sin actividad'].number).toBe(5);
        expect(propiedades.Actualizado.date.start).toBe('2026-09-01T00:00:00.000Z');
        expect(propiedades.Documento.url).toBe('https://github.com/owner/repo/blob/master/odd/tasks/feature-x.md');
        expect(propiedades.Huella.rich_text[0].text.content).toBe('abc123');
    });

    test('un campo de texto vacío se envía como "rich_text: []", no con contenido vacío', () => {
        const propiedades = construirPropiedadesNotion(filaBase({ pendiente: '' }));
        expect(propiedades.Pendiente.rich_text).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// validarEsquema
// ---------------------------------------------------------------------------

describe('validarEsquema', () => {
    test('un esquema correcto no reporta problemas', () => {
        expect(validarEsquema(ESQUEMA_CORRECTO_NOTION)).toEqual([]);
    });

    test('nombra la propiedad faltante', () => {
        const sinHuella = Object.fromEntries(
            Object.entries(ESQUEMA_CORRECTO_NOTION).filter(([nombre]) => nombre !== 'Huella'),
        );
        const problemas = validarEsquema(sinHuella);
        expect(problemas).toContainEqual(expect.objectContaining({ nombre: 'Huella', motivo: 'faltante' }));
    });

    test('nombra la propiedad con tipo incorrecto', () => {
        const conTipoMalo = { ...ESQUEMA_CORRECTO_NOTION, 'Días sin actividad': { type: 'rich_text' } };
        const problemas = validarEsquema(conTipoMalo);
        expect(problemas).toContainEqual(
            expect.objectContaining({
                nombre: 'Días sin actividad',
                motivo: 'tipo-incorrecto',
                tipoEsperado: 'number',
                tipoActual: 'rich_text',
            }),
        );
    });
});

// ---------------------------------------------------------------------------
// normalizarIdBaseNotion (T7)
// ---------------------------------------------------------------------------

describe('normalizarIdBaseNotion (T7)', () => {
    const ID_32_HEX = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
    const ID_DASHED = 'a1b2c3d4-e5f6-a1b2-c3d4-e5f6a1b2c3d4';

    test('acepta el ID "pelado" de 32 hex tal cual', () => {
        const resultado = normalizarIdBaseNotion(ID_32_HEX);
        expect(resultado).toEqual({ ok: true, id: ID_32_HEX });
    });

    test('acepta el ID en mayúsculas y lo normaliza a minúsculas', () => {
        const resultado = normalizarIdBaseNotion(ID_32_HEX.toUpperCase());
        expect(resultado).toEqual({ ok: true, id: ID_32_HEX });
    });

    test('acepta el UUID con guiones y lo normaliza a la misma forma que el ID pelado', () => {
        const resultado = normalizarIdBaseNotion(ID_DASHED);
        expect(resultado).toEqual({ ok: true, id: ID_32_HEX });
    });

    test('recorta espacios alrededor del valor', () => {
        const resultado = normalizarIdBaseNotion(`  ${ID_32_HEX}  `);
        expect(resultado).toEqual({ ok: true, id: ID_32_HEX });
    });

    test('extrae el ID de una URL completa con "?v=" (el error real que motivó esta función)', () => {
        const resultado = normalizarIdBaseNotion(
            `https://www.notion.so/miworkspace/Tablero-de-Features-${ID_32_HEX}?v=${'0'.repeat(32)}`,
        );
        expect(resultado).toEqual({ ok: true, id: ID_32_HEX });
    });

    test('extrae el ID de una URL sin título ni "?v="', () => {
        const resultado = normalizarIdBaseNotion(`https://www.notion.so/${ID_32_HEX}`);
        expect(resultado).toEqual({ ok: true, id: ID_32_HEX });
    });

    test('extrae el ID de una URL de "notion.site" (workspace publicado)', () => {
        const resultado = normalizarIdBaseNotion(`https://miworkspace.notion.site/Tablero-${ID_32_HEX}?pvs=4`);
        expect(resultado).toEqual({ ok: true, id: ID_32_HEX });
    });

    test('extrae el UUID con guiones cuando es el último segmento de la URL', () => {
        const resultado = normalizarIdBaseNotion(`https://www.notion.so/miworkspace/${ID_DASHED}`);
        expect(resultado).toEqual({ ok: true, id: ID_32_HEX });
    });

    test('un valor sin ningún ID de Notion reconocible falla con un mensaje claro que no repite el valor crudo', () => {
        const valorCrudo = 'esto-no-es-un-id-de-notion-secreto-xyz';
        const resultado = normalizarIdBaseNotion(valorCrudo);
        expect(resultado.ok).toBe(false);
        if (!resultado.ok) {
            expect(resultado.error).not.toContain(valorCrudo);
            expect(resultado.error).toMatch(/32/);
            expect(resultado.error).toMatch(/url/i);
            expect(resultado.error).toMatch(/vista/i);
        }
    });

    test('una cadena vacía o solo espacios falla', () => {
        const resultado = normalizarIdBaseNotion('   ');
        expect(resultado.ok).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// planificarSync
// ---------------------------------------------------------------------------

describe('planificarSync', () => {
    test('una fila sin página existente se planea para crear', () => {
        const plan = planificarSync([filaBase({ slug: 'nueva' })], []);
        expect(plan.crear.map((f) => f.slug)).toEqual(['nueva']);
        expect(plan.actualizar).toEqual([]);
        expect(plan.huerfanas).toEqual([]);
    });

    test('una fila con página existente por slug se planea para actualizar (huella igual → no reescribe cuerpo)', () => {
        const fila = filaBase({ slug: 'existente', huella: 'h1' });
        const plan = planificarSync([fila], [{ pageId: 'page-1', slug: 'existente', huella: 'h1' }]);

        expect(plan.crear).toEqual([]);
        expect(plan.actualizar).toEqual([{ pageId: 'page-1', fila, reescribirCuerpo: false }]);
    });

    test('"reescribirCuerpo" es true solo cuando la huella cambió', () => {
        const plan = planificarSync(
            [filaBase({ slug: 'a', huella: 'h-nueva' }), filaBase({ slug: 'b', huella: 'h-igual' })],
            [
                { pageId: 'page-a', slug: 'a', huella: 'h-vieja' },
                { pageId: 'page-b', slug: 'b', huella: 'h-igual' },
            ],
        );
        const porSlug = new Map(plan.actualizar.map((a) => [a.fila.slug, a.reescribirCuerpo]));
        expect(porSlug.get('a')).toBe(true);
        expect(porSlug.get('b')).toBe(false);
    });

    test('una página cuyo slug no tiene documento va a "huerfanas" y nunca se borra', () => {
        const paginaHuerfana: PaginaExistente = { pageId: 'page-x', slug: 'ya-no-existe', huella: 'h' };
        const plan = planificarSync([], [paginaHuerfana]);

        expect(plan.crear).toEqual([]);
        expect(plan.actualizar).toEqual([]);
        expect(plan.huerfanas).toEqual([paginaHuerfana]);
    });

    test('dos corridas seguidas contra el mismo set de páginas no crean duplicados (criterio de aceptación)', () => {
        const filas = [filaBase({ slug: 'a', huella: 'h1' }), filaBase({ slug: 'b', huella: 'h2' })];
        const primeraCorrida = planificarSync(filas, []);
        expect(primeraCorrida.crear).toHaveLength(2);

        const paginasExistentes: PaginaExistente[] = primeraCorrida.crear.map((f, i) => ({
            pageId: `page-${i}`,
            slug: f.slug,
            huella: f.huella,
        }));
        const segundaCorrida = planificarSync(filas, paginasExistentes);

        expect(segundaCorrida.crear).toHaveLength(0);
        expect(segundaCorrida.actualizar).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// crearClienteNotion — reescritura de cuerpo (contando llamadas del fake)
// ---------------------------------------------------------------------------

describe('crearClienteNotion — reescritura de cuerpo', () => {
    test('agrega los bloques nuevos ANTES de borrar los viejos, con el agregado en un solo PATCH y un DELETE por bloque viejo (fix T8)', async () => {
        const bloquesExistentes = [
            { id: 'child-1', type: 'to_do', to_do: { rich_text: [], checked: false } },
            { id: 'child-2', type: 'to_do', to_do: { rich_text: [], checked: false } },
        ];
        const llamadas: string[] = [];
        const idsBorrados: string[] = [];
        const fetchFalso: FetchInyectado = async (url, init) => {
            const ruta = url.replace('https://api.notion.com/v1', '');
            llamadas.push(`${init.method} ${ruta}`);
            if (init.method === 'GET' && ruta === '/blocks/page-1/children') {
                return respuestaFalsa(200, { results: bloquesExistentes, has_more: false, next_cursor: null });
            }
            if (init.method === 'PATCH' && ruta === '/blocks/page-1/children') return respuestaFalsa(200, {});
            if (init.method === 'DELETE') {
                idsBorrados.push(ruta.replace('/blocks/', ''));
                return respuestaFalsa(200, {});
            }
            throw new Error(`ruta no simulada en el test: ${init.method} ${ruta}`);
        };
        const dormir: Dormir = async () => {};
        const cliente: ClienteNotion = crearClienteNotion(fetchFalso, 'token-fake', dormir);

        await cliente.reescribirCuerpo('page-1', [tarea({ id: 'T1', hecha: true })]);

        expect(llamadas.filter((l) => l.startsWith('DELETE')).length).toBe(2);
        expect(llamadas.filter((l) => l === 'PATCH /blocks/page-1/children').length).toBe(1);
        // Orden: el ÚLTIMO agregado corre antes que el PRIMER borrado.
        const indiceUltimoAppend = llamadas.lastIndexOf('PATCH /blocks/page-1/children');
        const indicePrimerDelete = llamadas.findIndex((l) => l.startsWith('DELETE'));
        expect(indiceUltimoAppend).toBeGreaterThanOrEqual(0);
        expect(indicePrimerDelete).toBeGreaterThan(indiceUltimoAppend);
        // Solo se borran los ids que ya existían ANTES del agregado.
        expect(idsBorrados.sort()).toEqual(['child-1', 'child-2']);
    });

    test('sin tareas: no agrega nada, y borra igual los bloques viejos', async () => {
        const bloquesExistentes = [{ id: 'child-1', type: 'to_do', to_do: { rich_text: [], checked: false } }];
        const llamadas: string[] = [];
        const fetchFalso: FetchInyectado = async (url, init) => {
            const ruta = url.replace('https://api.notion.com/v1', '');
            llamadas.push(`${init.method} ${ruta}`);
            if (init.method === 'GET' && ruta === '/blocks/page-1/children') {
                return respuestaFalsa(200, { results: bloquesExistentes, has_more: false, next_cursor: null });
            }
            if (init.method === 'DELETE') return respuestaFalsa(200, {});
            throw new Error(`ruta no simulada en el test: ${init.method} ${ruta}`);
        };
        const cliente: ClienteNotion = crearClienteNotion(fetchFalso, 'token-fake', async () => {});

        await cliente.reescribirCuerpo('page-1', []);

        expect(llamadas.some((l) => l.startsWith('PATCH'))).toBe(false);
        expect(llamadas.filter((l) => l.startsWith('DELETE')).length).toBe(1);
    });

    test('si el agregado falla con un 503 en una página CON bloques viejos, no se borra ninguno (R3-001)', async () => {
        const bloquesExistentes = [
            { id: 'child-1', type: 'to_do', to_do: { rich_text: [], checked: false } },
            { id: 'child-2', type: 'to_do', to_do: { rich_text: [], checked: false } },
        ];
        let llamadasDelete = 0;
        const fetchFalso: FetchInyectado = async (url, init) => {
            const ruta = url.replace('https://api.notion.com/v1', '');
            if (init.method === 'GET' && ruta === '/blocks/page-1/children') {
                return respuestaFalsa(200, { results: bloquesExistentes, has_more: false, next_cursor: null });
            }
            if (init.method === 'PATCH' && ruta === '/blocks/page-1/children') {
                return respuestaFalsa(503, { code: 'service_unavailable' });
            }
            if (init.method === 'DELETE') {
                llamadasDelete++;
                return respuestaFalsa(200, {});
            }
            throw new Error(`ruta no simulada en el test: ${init.method} ${ruta}`);
        };
        const cliente = crearClienteNotion(fetchFalso, 'tok', async () => {});

        await expect(cliente.reescribirCuerpo('page-1', [tarea({ id: 'T1' })])).rejects.toThrow(/no idempotente/i);
        expect(llamadasDelete).toBe(0);
    });

    test('si el agregado falla con un error de red en una página CON bloques viejos, no se borra ninguno (R3-001)', async () => {
        const bloquesExistentes = [{ id: 'child-1', type: 'to_do', to_do: { rich_text: [], checked: false } }];
        let llamadasDelete = 0;
        const fetchFalso: FetchInyectado = async (url, init) => {
            const ruta = url.replace('https://api.notion.com/v1', '');
            if (init.method === 'GET' && ruta === '/blocks/page-1/children') {
                return respuestaFalsa(200, { results: bloquesExistentes, has_more: false, next_cursor: null });
            }
            if (init.method === 'PATCH' && ruta === '/blocks/page-1/children') {
                throw new Error('ECONNRESET');
            }
            if (init.method === 'DELETE') {
                llamadasDelete++;
                return respuestaFalsa(200, {});
            }
            throw new Error(`ruta no simulada en el test: ${init.method} ${ruta}`);
        };
        const cliente = crearClienteNotion(fetchFalso, 'tok', async () => {});

        await expect(cliente.reescribirCuerpo('page-1', [tarea({ id: 'T1' })])).rejects.toThrow(/no idempotente/i);
        expect(llamadasDelete).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// crearClienteNotion — reintentos ante 429
// ---------------------------------------------------------------------------

describe('crearClienteNotion — reintentos ante 429', () => {
    test('respeta "Retry-After" (vía "dormir" inyectado) y reintenta hasta lograr éxito', async () => {
        let intentos = 0;
        const dormidas: number[] = [];
        const fetchFalso: FetchInyectado = async () => {
            intentos++;
            if (intentos <= 2) return respuestaFalsa(429, { code: 'rate_limited' }, { 'retry-after': '2' });
            return respuestaFalsa(200, { data_sources: [{ id: 'ds-1' }] });
        };
        const dormir: Dormir = async (ms) => {
            dormidas.push(ms);
        };
        const cliente = crearClienteNotion(fetchFalso, 'token-fake', dormir);

        const id = await cliente.obtenerDataSourceId('db-1');

        expect(id).toBe('ds-1');
        expect(intentos).toBe(3);
        expect(dormidas).toEqual([2000, 2000]);
    });

    test('tras superar el tope de reintentos (3), falla', async () => {
        const fetchFalso: FetchInyectado = async () =>
            respuestaFalsa(429, { code: 'rate_limited' }, { 'retry-after': '1' });
        const dormir: Dormir = async () => {};
        const cliente = crearClienteNotion(fetchFalso, 'token-fake', dormir);

        await expect(cliente.obtenerDataSourceId('db-1')).rejects.toThrow(/429/);
    });

    test('un error HTTP distinto de 429 falla con un mensaje que incluye el status y el cuerpo', async () => {
        const fetchFalso: FetchInyectado = async () =>
            respuestaFalsa(500, { code: 'internal_server_error', message: 'boom' });
        const dormir: Dormir = async () => {};
        const cliente = crearClienteNotion(fetchFalso, 'token-fake', dormir);

        await expect(cliente.obtenerDataSourceId('db-1')).rejects.toThrow(/500/);
    });
});

// ---------------------------------------------------------------------------
// crearClienteNotion — el status HTTP se preserva aunque falle la lectura del
// cuerpo de un error (R2-001 / R3-002 / R4-001)
// ---------------------------------------------------------------------------

describe('crearClienteNotion — status preservado cuando falla la lectura del cuerpo de un error', () => {
    test('escritura NO idempotente con 503 cuyo cuerpo no se puede leer: preserva "503" y "NO idempotente", un solo fetch', async () => {
        let llamadas = 0;
        const fetchFalso: FetchInyectado = async () => {
            llamadas++;
            return {
                status: 503,
                headers: { get: () => null },
                text: () => Promise.reject(new Error('lectura interrumpida')),
            };
        };
        const cliente = crearClienteNotion(fetchFalso, 'tok', async () => {});

        let error: unknown;
        try {
            await cliente.crearPagina('ds-1', { Slug: { rich_text: [] } }, []);
        } catch (e) {
            error = e;
        }
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('503');
        expect((error as Error).message).toMatch(/no idempotente/i);
        expect(llamadas).toBe(1);
    });

    test('429 agotado (3 reintentos) cuyo cuerpo del último intento no se puede leer: preserva "429" y no reintenta de más', async () => {
        let llamadas = 0;
        const dormidas: number[] = [];
        const fetchFalso: FetchInyectado = async () => {
            llamadas++;
            return {
                status: 429,
                headers: { get: (nombre: string) => (nombre.toLowerCase() === 'retry-after' ? '0' : null) },
                text: () => Promise.reject(new Error('lectura interrumpida')),
            };
        };
        const dormir: Dormir = async (ms) => {
            dormidas.push(ms);
        };
        const cliente = crearClienteNotion(fetchFalso, 'tok', dormir);

        let error: unknown;
        try {
            await cliente.obtenerDataSourceId('db-1');
        } catch (e) {
            error = e;
        }
        expect((error as Error).message).toContain('429');
        expect(llamadas).toBe(4); // MAX_REINTENTOS (3) + el intento inicial
        expect(dormidas.length).toBe(3); // MAX_REINTENTOS, sin dormida extra por "manejarFalloDeIntento"
    });

    test('503 persistente (escritura idempotente) cuyo cuerpo del último intento no se puede leer: mensaje "503 tras 3 reintentos"', async () => {
        let llamadas = 0;
        const fetchFalso: FetchInyectado = async () => {
            llamadas++;
            return {
                status: 503,
                headers: { get: () => null },
                text: () => Promise.reject(new Error('lectura interrumpida')),
            };
        };
        const cliente = crearClienteNotion(fetchFalso, 'tok', async () => {});

        await expect(cliente.obtenerDataSourceId('db-1')).rejects.toThrow(/503 tras 3 reintentos/);
        expect(llamadas).toBe(4);
    });

    test('un 400 cuyo cuerpo no se puede leer preserva el status "400"', async () => {
        const fetchFalso: FetchInyectado = async () => ({
            status: 400,
            headers: { get: () => null },
            text: () => Promise.reject(new Error('lectura interrumpida')),
        });
        const cliente = crearClienteNotion(fetchFalso, 'tok', async () => {});

        await expect(cliente.obtenerDataSourceId('db-1')).rejects.toThrow(/400/);
    });
});

// ---------------------------------------------------------------------------
// sincronizar — credenciales
// ---------------------------------------------------------------------------

describe('sincronizar — sin credenciales', () => {
    const listarDocumentos = () => [{ slug: 'feature-x', contenido: docBase() }];
    const ejecutar = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });

    test('sin "--dry-run": código 1 y el fetch falso nunca se llama', async () => {
        const fetchEspiado = jest.fn();
        const resumen = await sincronizar(
            { dryRun: false },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: fetchEspiado as unknown as FetchInyectado,
                listarDocumentos,
                credenciales: null,
                hoy: new Date('2026-09-21T00:00:00Z'),
            },
        );

        expect(resumen.codigo).toBe(1);
        expect(fetchEspiado).not.toHaveBeenCalled();
    });

    test('con "--dry-run": código 0 y cero llamadas al fetch (no consultó Notion)', async () => {
        const fetchEspiado = jest.fn();
        const resumen = await sincronizar(
            { dryRun: true },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: fetchEspiado as unknown as FetchInyectado,
                listarDocumentos,
                credenciales: null,
                hoy: new Date('2026-09-21T00:00:00Z'),
            },
        );

        expect(resumen.codigo).toBe(0);
        expect(resumen.consultoNotion).toBe(false);
        expect(fetchEspiado).not.toHaveBeenCalled();
    });

    test('la salida no informa contadores de escritura que no se pudieron calcular', async () => {
        // Defecto real del "--dry-run" del sync viejo de fichas: informar
        // "Creadas: 0" sin haber consultado Notion es indistinguible de un
        // plan real con cero altas. Sin credenciales, el aviso debe decir
        // explícitamente que el plan no se calculó, y el conteo de errores de
        // formato sigue siendo la única cifra confiable.
        const lineas: string[] = [];
        await sincronizar(
            { dryRun: true },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: jest.fn() as unknown as FetchInyectado,
                listarDocumentos,
                credenciales: null,
                hoy: new Date('2026-09-21T00:00:00Z'),
                log: (linea) => lineas.push(linea),
            },
        );

        const salida = lineas.join('\n');
        expect(salida).not.toContain('Creadas:');
        expect(salida).toMatch(/plan de escritura.*no calculado/i);
    });
});

// ---------------------------------------------------------------------------
// sincronizar — NOTION_TABLERO_DB_ID inválido (T7)
// ---------------------------------------------------------------------------

describe('sincronizar — NOTION_TABLERO_DB_ID inválido (T7)', () => {
    test('con credenciales pero un databaseId que no es un ID de Notion: código 1, cero llamadas al fetch, y la razón en el resumen', async () => {
        const listarDocumentos = () => [{ slug: 'feature-x', contenido: docBase() }];
        const ejecutar = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });
        const fetchEspiado = jest.fn();
        const lineas: string[] = [];

        const resumen = await sincronizar(
            { dryRun: false },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: fetchEspiado as unknown as FetchInyectado,
                listarDocumentos,
                credenciales: { token: 'tok', databaseId: 'esto-no-es-un-id' },
                hoy: new Date('2026-09-21T00:00:00Z'),
                log: (linea) => lineas.push(linea),
            },
        );

        expect(resumen.codigo).toBe(1);
        expect(fetchEspiado).not.toHaveBeenCalled();
        expect(resumen.consultoNotion).toBe(false);
        const salida = lineas.join('\n');
        expect(salida).not.toContain('Creadas:');
        expect(salida).not.toContain('Actualizadas:');
        expect(salida).toMatch(/plan de escritura.*no calculado/i);
        expect(salida).not.toContain('esto-no-es-un-id');
    });

    test('también se valida en "--dry-run" con credenciales', async () => {
        const listarDocumentos = () => [{ slug: 'feature-x', contenido: docBase() }];
        const ejecutar = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });
        const fetchEspiado = jest.fn();

        const resumen = await sincronizar(
            { dryRun: true },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: fetchEspiado as unknown as FetchInyectado,
                listarDocumentos,
                credenciales: { token: 'tok', databaseId: 'https://www.notion.so/miworkspace/una-pagina-cualquiera' },
                hoy: new Date('2026-09-21T00:00:00Z'),
            },
        );

        expect(resumen.codigo).toBe(1);
        expect(fetchEspiado).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// sincronizar — errores de formato mezclados con documentos válidos
// ---------------------------------------------------------------------------

describe('sincronizar — errores de formato mezclados con documentos válidos', () => {
    test('los documentos válidos se sincronizan igual y el proceso termina en código 1', async () => {
        const listarDocumentos = () => [
            { slug: 'valido', contenido: docBase() },
            { slug: 'invalido', contenido: '# Sin frontmatter\n\n## Tareas\n\n- [ ] mal formada' },
        ];
        const ejecutar = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });

        const resumen = await sincronizar(
            { dryRun: true },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: jest.fn() as unknown as FetchInyectado,
                listarDocumentos,
                credenciales: null,
                hoy: new Date('2026-09-21T00:00:00Z'),
            },
        );

        expect(resumen.codigo).toBe(1);
        expect(resumen.erroresDeFormato.map((e) => e.slug)).toEqual(['invalido']);
    });
});

// ---------------------------------------------------------------------------
// sincronizar — commit inexistente en "commits"
// ---------------------------------------------------------------------------

describe('sincronizar — commit inexistente en "commits"', () => {
    const HASH_FANTASMA = `deadbeef${'0'.repeat(32)}`; // 40 caracteres hex

    test('un commit que no existe en el repo es error de formato y el documento se saltea', async () => {
        const listarDocumentos = () => [
            {
                slug: 'con-commit-fantasma',
                contenido: docBase({ frontmatter: `---\nramas: []\ncommits: ["${HASH_FANTASMA}"]\n---` }),
            },
            { slug: 'valido', contenido: docBase() },
        ];
        // "commits: {}" vacío: el hash nunca resuelve → el "ejecutar" falso
        // lanza, tal como lo haría "git show" con un hash inexistente. El
        // repo NO es superficial (ver fix del review de T3): sin esa
        // respuesta, "sincronizar" ya ni llega a intentar resolver el hash.
        const ejecutar = crearEjecutarFalso({
            ramas: '',
            prs: '[]',
            ownerRepo: 'owner/repo',
            commits: {},
            superficial: false,
        });

        const resumen = await sincronizar(
            { dryRun: true },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: jest.fn() as unknown as FetchInyectado,
                listarDocumentos,
                credenciales: null,
                hoy: new Date('2026-09-21T00:00:00Z'),
            },
        );

        expect(resumen.codigo).toBe(1);
        expect(resumen.erroresDeFormato.map((e) => e.slug)).toEqual(['con-commit-fantasma']);
        expect(resumen.erroresDeFormato[0].errores.some((e) => e.includes(HASH_FANTASMA))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// sincronizar — dry-run CON credenciales consulta Notion en modo lectura
// ---------------------------------------------------------------------------

describe('sincronizar — dry-run con credenciales', () => {
    test('cuenta cuántas crearía/actualizaría y lista huérfanas, sin escribir nada', async () => {
        const notionFalso = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
        notionFalso.paginas.set('page-huerfana', {
            id: 'page-huerfana',
            properties: propiedadesMinimas('no-existe-mas', 'hash-x'),
            hijos: [],
        });

        const listarDocumentos = () => [{ slug: 'feature-x', contenido: docBase() }];
        const ejecutar = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });

        const resumen = await sincronizar(
            { dryRun: true },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: notionFalso.fetchFalso,
                listarDocumentos,
                credenciales: { token: 'tok', databaseId: notionFalso.databaseId },
                hoy: new Date('2026-09-21T00:00:00Z'),
            },
        );

        expect(resumen.consultoNotion).toBe(true);
        expect(resumen.creadas).toBe(0);
        expect(resumen.actualizadas).toBe(0);
        expect(resumen.huerfanas).toEqual(['no-existe-mas']);
        expect(notionFalso.llamadas.crearPagina).toBe(0);
        expect(notionFalso.llamadas.actualizarPropiedades).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// sincronizar — esquema inválido (T7)
// ---------------------------------------------------------------------------

describe('sincronizar — esquema inválido (T7)', () => {
    test('lista las columnas que SÍ encontró, en el orden de Notion, y el resumen no informa contadores inventados', async () => {
        // Falta "Huella" y "Progreso" viene con el tipo equivocado: dos
        // problemas de esquema distintos en la misma base falsa.
        const esquemaIncompleto: Record<string, { type: string }> = {
            Nombre: { type: 'title' },
            Estado: { type: 'select' },
            Progreso: { type: 'number' },
        };
        const notionFalso = crearNotionFalsoCompleto(esquemaIncompleto);
        const listarDocumentos = () => [{ slug: 'feature-x', contenido: docBase() }];
        const ejecutar = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });
        const lineas: string[] = [];

        const resumen = await sincronizar(
            { dryRun: false },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: notionFalso.fetchFalso,
                listarDocumentos,
                credenciales: { token: 'tok', databaseId: notionFalso.databaseId },
                hoy: new Date('2026-09-21T00:00:00Z'),
                log: (linea) => lineas.push(linea),
            },
        );

        expect(resumen.codigo).toBe(1);
        expect(notionFalso.llamadas.crearPagina).toBe(0);
        const salida = lineas.join('\n');
        expect(salida).not.toContain('Creadas:');
        expect(salida).not.toContain('Actualizadas:');
        expect(salida).not.toContain('Cuerpos reescritos:');
        expect(salida).toMatch(/plan de escritura.*no calculado.*esquema/i);
        expect(salida).toContain('Columnas encontradas en la base: Nombre (title), Estado (select), Progreso (number)');
    });

    test('sin ninguna columna en la base, informa "(ninguna)"', async () => {
        const notionFalso = crearNotionFalsoCompleto({});
        const listarDocumentos = () => [{ slug: 'feature-x', contenido: docBase() }];
        const ejecutar = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });
        const lineas: string[] = [];

        await sincronizar(
            { dryRun: false },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: notionFalso.fetchFalso,
                listarDocumentos,
                credenciales: { token: 'tok', databaseId: notionFalso.databaseId },
                hoy: new Date('2026-09-21T00:00:00Z'),
                log: (linea) => lineas.push(linea),
            },
        );

        const salida = lineas.join('\n');
        expect(salida).toContain('Columnas encontradas en la base: (ninguna)');
    });
});

// ---------------------------------------------------------------------------
// sincronizar — corrida real de escritura (crear, actualizar, reescribir cuerpo)
// ---------------------------------------------------------------------------

describe('sincronizar — corrida real de escritura contra un Notion falso completo', () => {
    test('1ra corrida crea; 2da (sin cambios) no crea ni reescribe cuerpo; 3ra (con cambio) reescribe', async () => {
        const notionFalso = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
        const ejecutar = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });
        const credenciales = { token: 'tok', databaseId: notionFalso.databaseId };
        const hoy = new Date('2026-09-21T00:00:00Z');

        const contenidoInicial = docBase({
            seccionTareas: ['## Tareas', '', '- [x] **T1 — Uno**: hecha.', '- [ ] **T2 — Dos**: pendiente.'].join(
                '\n',
            ),
        });

        const primera = await sincronizar(
            { dryRun: false },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: notionFalso.fetchFalso,
                listarDocumentos: () => [{ slug: 'feature-x', contenido: contenidoInicial }],
                credenciales,
                hoy,
            },
        );
        expect(primera.creadas).toBe(1);
        expect(notionFalso.llamadas.crearPagina).toBe(1);

        const segunda = await sincronizar(
            { dryRun: false },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: notionFalso.fetchFalso,
                listarDocumentos: () => [{ slug: 'feature-x', contenido: contenidoInicial }],
                credenciales,
                hoy,
            },
        );
        expect(segunda.creadas).toBe(0); // sin duplicados
        expect(segunda.actualizadas).toBe(1); // las propiedades siempre se actualizan
        expect(segunda.cuerposReescritos).toBe(0); // la huella no cambió
        expect(notionFalso.llamadas.borrarBloque).toBe(0);
        expect(notionFalso.llamadas.agregarHijos).toBe(0);

        const contenidoModificado = docBase({
            seccionTareas: ['## Tareas', '', '- [x] **T1 — Uno**: hecha.', '- [x] **T2 — Dos**: ahora hecha.'].join(
                '\n',
            ),
        });

        const tercera = await sincronizar(
            { dryRun: false },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: notionFalso.fetchFalso,
                listarDocumentos: () => [{ slug: 'feature-x', contenido: contenidoModificado }],
                credenciales,
                hoy,
            },
        );
        expect(tercera.creadas).toBe(0);
        expect(tercera.cuerposReescritos).toBe(1); // la huella sí cambió
        expect(notionFalso.llamadas.borrarBloque).toBeGreaterThan(0);
        expect(notionFalso.llamadas.agregarHijos).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// Fix 1 del review de T3: "Huella" se escribe al final, solo con el cuerpo
// completo (determinístico)
// ---------------------------------------------------------------------------

describe('sincronizar — "Huella" se escribe al final (fix 1 del review de T3)', () => {
    test('si la reescritura del cuerpo falla a mitad de camino, la Huella en Notion NO cambia, y la corrida siguiente la repara', async () => {
        const notionFalso = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
        const ejecutar = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });
        const credenciales = { token: 'tok', databaseId: notionFalso.databaseId };
        const hoy = new Date('2026-09-21T00:00:00Z');

        const contenidoInicial = docBase({
            seccionTareas: ['## Tareas', '', '- [x] **T1 — Uno**: hecha.'].join('\n'),
        });
        await sincronizar(
            { dryRun: false },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: notionFalso.fetchFalso,
                listarDocumentos: () => [{ slug: 'feature-x', contenido: contenidoInicial }],
                credenciales,
                hoy,
            },
        );
        const huellaOriginal = [...notionFalso.paginas.values()][0].properties.Huella;

        // Documento modificado (huella distinta) + falla forzada justo al
        // borrar el primer bloque del cuerpo viejo.
        const contenidoModificado = docBase({
            seccionTareas: ['## Tareas', '', '- [x] **T1 — Uno**: hecha DISTINTO ahora.'].join('\n'),
        });
        notionFalso.forzarFalloEn('borrarBloque', 1);
        await expect(
            sincronizar(
                { dryRun: false },
                {
                    raizRepo: '/repo',
                    ejecutar,
                    fetchInyectado: notionFalso.fetchFalso,
                    listarDocumentos: () => [{ slug: 'feature-x', contenido: contenidoModificado }],
                    credenciales,
                    hoy,
                },
            ),
        ).rejects.toThrow(/400/);

        // La Huella en Notion sigue siendo la de ANTES: no quedó corrompida
        // con la huella nueva mientras el cuerpo quedó a medio borrar.
        const paginaTrasFalla = [...notionFalso.paginas.values()][0];
        expect(paginaTrasFalla.properties.Huella).toEqual(huellaOriginal);

        // Corrida siguiente, sin forzar más fallas: como la huella calculada
        // sigue sin coincidir con la guardada, se detecta y se repara sola.
        const reparacion = await sincronizar(
            { dryRun: false },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: notionFalso.fetchFalso,
                listarDocumentos: () => [{ slug: 'feature-x', contenido: contenidoModificado }],
                credenciales,
                hoy,
            },
        );
        expect(reparacion.cuerposReescritos).toBe(1);
        expect(reparacion.creadas).toBe(0);
    });

    test('una alta que falla al agregar el segundo lote de bloques nunca llega a escribir la Huella', async () => {
        const notionFalso = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
        const ejecutar = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });
        const credenciales = { token: 'tok', databaseId: notionFalso.databaseId };

        const contenido = docBase({ seccionTareas: seccionConNTareas(150) }); // > TAMANO_LOTE_BLOQUES (100)
        notionFalso.forzarFalloEn('agregarHijos', 1);

        await expect(
            sincronizar(
                { dryRun: false },
                {
                    raizRepo: '/repo',
                    ejecutar,
                    fetchInyectado: notionFalso.fetchFalso,
                    listarDocumentos: () => [{ slug: 'feature-grande', contenido }],
                    credenciales,
                    hoy: new Date('2026-09-21T00:00:00Z'),
                },
            ),
        ).rejects.toThrow(/400/);

        expect(notionFalso.llamadas.crearPagina).toBe(1); // la página SÍ se creó
        const pagina = [...notionFalso.paginas.values()][0];
        expect(pagina.properties.Huella).toBeUndefined(); // pero la Huella NUNCA se escribió
    });
});

// ---------------------------------------------------------------------------
// Fix 2 del review de T3: "--dry-run" CON credenciales muestra el plan, no
// contadores en cero (determinístico)
// ---------------------------------------------------------------------------

describe('sincronizar — "--dry-run" con credenciales muestra el plan (fix 2 del review de T3)', () => {
    test('la salida no contiene "Creadas:", muestra los 4 números del plan, y las huérfanas una sola vez', async () => {
        const notionFalso = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
        notionFalso.paginas.set('page-huerfana', {
            id: 'page-huerfana',
            properties: propiedadesMinimas('no-existe-mas', 'hash-x'),
            hijos: [],
        });
        const listarDocumentos = () => [{ slug: 'feature-x', contenido: docBase() }];
        const ejecutar = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });
        const lineas: string[] = [];

        const resumen = await sincronizar(
            { dryRun: true },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: notionFalso.fetchFalso,
                listarDocumentos,
                credenciales: { token: 'tok', databaseId: notionFalso.databaseId },
                hoy: new Date('2026-09-21T00:00:00Z'),
                log: (linea) => lineas.push(linea),
            },
        );

        const salida = lineas.join('\n');
        expect(salida).not.toContain('Creadas:');
        // "huerfanas" NO va en "plan" (fix T9: era un dato duplicado que
        // "imprimirResumenFinal" nunca leía de ahí; lee "resumen.huerfanas").
        expect(resumen.plan).toEqual({
            crearia: 1,
            actualizaria: 0,
            cuerposAReescribir: 0,
        });
        expect(salida).toContain('Crearía: 1');
        expect(salida).toContain('Actualizaría: 0');
        expect(salida).toContain('Cuerpos a reescribir: 0');
        // Las huérfanas aparecen UNA sola vez en toda la salida.
        expect((salida.match(/no-existe-mas/g) ?? []).length).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Fix 3 del review de T3: timeout y reintento de errores transitorios
// ---------------------------------------------------------------------------

describe('crearClienteNotion — timeout y reintento de errores transitorios (fix 3 del review de T3)', () => {
    test('un 503 se reintenta con backoff exponencial y funciona', async () => {
        let intentos = 0;
        const dormidas: number[] = [];
        const fetchFalso: FetchInyectado = async () => {
            intentos++;
            if (intentos === 1) return respuestaFalsa(503, { code: 'internal_error' });
            return respuestaFalsa(200, { data_sources: [{ id: 'ds-1' }] });
        };
        const dormir: Dormir = async (ms) => {
            dormidas.push(ms);
        };
        const cliente = crearClienteNotion(fetchFalso, 'token-fake', dormir);

        const id = await cliente.obtenerDataSourceId('db-1');

        expect(id).toBe('ds-1');
        expect(intentos).toBe(2);
        expect(dormidas).toEqual([1000]);
    });

    test('un fetch rechazado (error de red) se reintenta', async () => {
        let intentos = 0;
        const fetchFalso: FetchInyectado = async () => {
            intentos++;
            if (intentos === 1) throw new Error('ECONNRESET');
            return respuestaFalsa(200, { data_sources: [{ id: 'ds-1' }] });
        };
        const dormidas: number[] = [];
        const dormir: Dormir = async (ms) => {
            dormidas.push(ms);
        };
        const cliente = crearClienteNotion(fetchFalso, 'token-fake', dormir);

        const id = await cliente.obtenerDataSourceId('db-1');

        expect(id).toBe('ds-1');
        expect(intentos).toBe(2);
        expect(dormidas).toEqual([1000]);
    });

    test('un timeout (AbortController dispara la señal) se reintenta', async () => {
        let intentos = 0;
        const fetchFalso: FetchInyectado = (_url, init) => {
            intentos++;
            if (intentos === 1) {
                return new Promise((_resolve, reject) => {
                    init.signal?.addEventListener('abort', () => {
                        reject(new DOMException('The operation was aborted.', 'AbortError'));
                    });
                });
            }
            return respuestaFalsa(200, { data_sources: [{ id: 'ds-1' }] });
        };
        const dormidas: number[] = [];
        const dormir: Dormir = async (ms) => {
            dormidas.push(ms);
        };
        // "timeoutMs" bajo (5ms) para que el test no espere de verdad 30s.
        const cliente = crearClienteNotion(fetchFalso, 'token-fake', dormir, 5);

        const id = await cliente.obtenerDataSourceId('db-1');

        expect(id).toBe('ds-1');
        expect(intentos).toBe(2);
        expect(dormidas).toEqual([1000]);
    });

    test('el timeout también cubre la LECTURA del cuerpo (fix T8): se reintenta si es idempotente', async () => {
        let intentos = 0;
        const fetchFalso: FetchInyectado = (_url, init) => {
            intentos++;
            const intentoActual = intentos;
            return Promise.resolve({
                status: 200,
                headers: { get: () => null },
                text: () =>
                    new Promise<string>((resolve, reject) => {
                        if (intentoActual === 1) {
                            // Los headers llegaron bien, pero la LECTURA del
                            // cuerpo se cuelga hasta que el timeout aborta.
                            init.signal?.addEventListener('abort', () => {
                                reject(new DOMException('The operation was aborted.', 'AbortError'));
                            });
                        } else {
                            resolve(JSON.stringify({ data_sources: [{ id: 'ds-1' }] }));
                        }
                    }),
            });
        };
        const dormidas: number[] = [];
        const dormir: Dormir = async (ms) => {
            dormidas.push(ms);
        };
        const cliente = crearClienteNotion(fetchFalso, 'token-fake', dormir, 5);

        const id = await cliente.obtenerDataSourceId('db-1');

        expect(id).toBe('ds-1');
        expect(intentos).toBe(2);
        expect(dormidas).toEqual([1000]);
    });

    test('un cuerpo que nunca resuelve en una escritura NO idempotente falla sin reintentar', async () => {
        let llamadas = 0;
        const fetchFalso: FetchInyectado = (_url, init) => {
            llamadas++;
            return Promise.resolve({
                status: 200,
                headers: { get: () => null },
                text: () =>
                    new Promise<string>((_resolve, reject) => {
                        init.signal?.addEventListener('abort', () => {
                            reject(new DOMException('The operation was aborted.', 'AbortError'));
                        });
                    }),
            });
        };
        const cliente = crearClienteNotion(fetchFalso, 'tok', async () => {}, 5);

        await expect(cliente.crearPagina('ds-1', { Slug: { rich_text: [] } }, [])).rejects.toThrow(
            /no idempotente/i,
        );
        expect(llamadas).toBe(1);
    });

    test('un 400 (4xx que no es 429) falla sin reintentar', async () => {
        let intentos = 0;
        const fetchFalso: FetchInyectado = async () => {
            intentos++;
            return respuestaFalsa(400, { message: 'solicitud inválida' });
        };
        const cliente = crearClienteNotion(fetchFalso, 'token-fake', async () => {});

        await expect(cliente.obtenerDataSourceId('db-1')).rejects.toThrow(/400/);
        expect(intentos).toBe(1);
    });

    test('tras agotar los reintentos de un 503 persistente, falla con un mensaje que incluye el status y el cuerpo', async () => {
        const fetchFalso: FetchInyectado = async () =>
            respuestaFalsa(503, { code: 'service_unavailable', message: 'boom' });
        const cliente = crearClienteNotion(fetchFalso, 'token-fake', async () => {});

        await expect(cliente.obtenerDataSourceId('db-1')).rejects.toThrow(/503/);
        await expect(cliente.obtenerDataSourceId('db-1')).rejects.toThrow(/boom/);
    });
});

// ---------------------------------------------------------------------------
// T6: el reintento respeta idempotencia (no duplicar altas/appends)
// ---------------------------------------------------------------------------

/**
 * Envuelve un `FetchInyectado` para que la PRIMERA llamada que matchee
 * "coincide" nunca le llegue una respuesta al cliente (simula que Notion
 * cortó la conexión justo antes/después de aplicar el cambio): si `modo` es
 * "aplicada", el request real SÍ se ejecuta contra el fake (mutando su
 * estado) antes de "perderse"; si es "no-aplicada", ni siquiera se ejecuta.
 * En ambos casos, lo que le llega al cliente es un rechazo tipo timeout.
 */
function conRespuestaPerdidaUnaVez(
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

describe('crearClienteNotion — el reintento respeta idempotencia (T6)', () => {
    test('un POST de alta (crearPagina) con timeout falla SIN reintentar (no idempotente)', async () => {
        let llamadas = 0;
        const fetchFalso: FetchInyectado = (_url, init) => {
            llamadas++;
            return new Promise((_resolve, reject) => {
                init.signal?.addEventListener('abort', () => {
                    reject(new DOMException('The operation was aborted.', 'AbortError'));
                });
            });
        };
        const dormidas: number[] = [];
        const cliente = crearClienteNotion(
            fetchFalso,
            'tok',
            async (ms) => {
                dormidas.push(ms);
            },
            5,
        );

        await expect(cliente.crearPagina('ds-1', { Slug: { rich_text: [] } }, [])).rejects.toThrow(
            /no idempotente/i,
        );
        expect(llamadas).toBe(1);
        expect(dormidas).toEqual([]);
    });

    test('un PATCH de agregar hijos con 503 falla SIN reintentar (no idempotente)', async () => {
        let llamadas = 0;
        const fetchFalso: FetchInyectado = async (url, init) => {
            llamadas++;
            if (init.method === 'POST' && url.endsWith('/pages')) {
                return respuestaFalsa(200, { id: 'page-1' });
            }
            // PATCH /blocks/page-1/children — el lote restante.
            return respuestaFalsa(503, { code: 'service_unavailable' });
        };
        const cliente = crearClienteNotion(fetchFalso, 'tok', async () => {});
        const tareas = Array.from({ length: 150 }, (_, i) => tarea({ id: `T${i + 1}`, nombre: `n${i}` }));

        await expect(
            cliente.crearPagina('ds-1', { Slug: { rich_text: [] } }, tareas),
        ).rejects.toThrow(/no idempotente/i);
        expect(llamadas).toBe(2); // 1 POST de creación + 1 PATCH que falla, sin reintento
    });

    test('un POST de alta con 429 SÍ reintenta (Notion confirma que no aplicó nada) y funciona', async () => {
        let llamadas = 0;
        const fetchFalso: FetchInyectado = async () => {
            llamadas++;
            if (llamadas === 1) return respuestaFalsa(429, { code: 'rate_limited' }, { 'retry-after': '2' });
            return respuestaFalsa(200, { id: 'page-1' });
        };
        const dormidas: number[] = [];
        const cliente = crearClienteNotion(fetchFalso, 'tok', async (ms) => {
            dormidas.push(ms);
        });

        const pageId = await cliente.crearPagina('ds-1', { Slug: { rich_text: [] } }, []);

        expect(pageId).toBe('page-1');
        expect(llamadas).toBe(2);
        expect(dormidas).toEqual([2000]);
    });

    test('un GET con 503 sigue reintentando (regresión del comportamiento de T5)', async () => {
        let llamadas = 0;
        const fetchFalso: FetchInyectado = async () => {
            llamadas++;
            if (llamadas === 1) return respuestaFalsa(503, { code: 'service_unavailable' });
            return respuestaFalsa(200, { data_sources: [{ id: 'ds-1' }] });
        };
        const dormidas: number[] = [];
        const cliente = crearClienteNotion(fetchFalso, 'tok', async (ms) => {
            dormidas.push(ms);
        });

        const id = await cliente.obtenerDataSourceId('db-1');

        expect(id).toBe('ds-1');
        expect(llamadas).toBe(2);
        expect(dormidas).toEqual([1000]);
    });

    test('un PATCH de propiedades de página con timeout sigue reintentando (es idempotente)', async () => {
        let llamadas = 0;
        const fetchFalso: FetchInyectado = (_url, init) => {
            llamadas++;
            if (llamadas === 1) {
                return new Promise((_resolve, reject) => {
                    init.signal?.addEventListener('abort', () => {
                        reject(new DOMException('The operation was aborted.', 'AbortError'));
                    });
                });
            }
            return respuestaFalsa(200, {});
        };
        const dormidas: number[] = [];
        const cliente = crearClienteNotion(
            fetchFalso,
            'tok',
            async (ms) => {
                dormidas.push(ms);
            },
            5,
        );

        await cliente.actualizarPropiedades('page-1', { Slug: { rich_text: [] } });

        expect(llamadas).toBe(2);
        expect(dormidas).toEqual([1000]);
    });

    test('el agregado no idempotente dentro de "reescribirCuerpo" falla SIN reintentar ante un 503', async () => {
        let llamadasPatch = 0;
        const fetchFalso: FetchInyectado = async (url, init) => {
            const ruta = url.replace('https://api.notion.com/v1', '');
            if (init.method === 'GET' && ruta === '/blocks/page-1/children') {
                return respuestaFalsa(200, { results: [], has_more: false, next_cursor: null });
            }
            if (init.method === 'PATCH' && ruta === '/blocks/page-1/children') {
                llamadasPatch++;
                return respuestaFalsa(503, { code: 'service_unavailable' });
            }
            throw new Error(`ruta no simulada en el test: ${init.method} ${ruta}`);
        };
        const cliente = crearClienteNotion(fetchFalso, 'tok', async () => {});

        await expect(cliente.reescribirCuerpo('page-1', [tarea({ id: 'T1' })])).rejects.toThrow(/no idempotente/i);
        expect(llamadasPatch).toBe(1);
    });

    test('el agregado no idempotente dentro de "reescribirCuerpo" falla SIN reintentar ante un error de red', async () => {
        let llamadasPatch = 0;
        const fetchFalso: FetchInyectado = async (url, init) => {
            const ruta = url.replace('https://api.notion.com/v1', '');
            if (init.method === 'GET' && ruta === '/blocks/page-1/children') {
                return respuestaFalsa(200, { results: [], has_more: false, next_cursor: null });
            }
            if (init.method === 'PATCH' && ruta === '/blocks/page-1/children') {
                llamadasPatch++;
                throw new Error('ECONNRESET');
            }
            throw new Error(`ruta no simulada en el test: ${init.method} ${ruta}`);
        };
        const cliente = crearClienteNotion(fetchFalso, 'tok', async () => {});

        await expect(cliente.reescribirCuerpo('page-1', [tarea({ id: 'T1' })])).rejects.toThrow(/no idempotente/i);
        expect(llamadasPatch).toBe(1);
    });

    test('el agregado dentro de "reescribirCuerpo" SÍ reintenta ante un 429 (Notion confirma que no aplicó nada)', async () => {
        let llamadasPatch = 0;
        const dormidas: number[] = [];
        const fetchFalso: FetchInyectado = async (url, init) => {
            const ruta = url.replace('https://api.notion.com/v1', '');
            if (init.method === 'GET' && ruta === '/blocks/page-1/children') {
                return respuestaFalsa(200, { results: [], has_more: false, next_cursor: null });
            }
            if (init.method === 'PATCH' && ruta === '/blocks/page-1/children') {
                llamadasPatch++;
                if (llamadasPatch === 1) {
                    return respuestaFalsa(429, { code: 'rate_limited' }, { 'retry-after': '2' });
                }
                return respuestaFalsa(200, {});
            }
            if (init.method === 'DELETE') return respuestaFalsa(200, {});
            throw new Error(`ruta no simulada en el test: ${init.method} ${ruta}`);
        };
        const cliente = crearClienteNotion(fetchFalso, 'tok', async (ms) => {
            dormidas.push(ms);
        });

        await cliente.reescribirCuerpo('page-1', [tarea({ id: 'T1' })]);

        expect(llamadasPatch).toBe(2);
        expect(dormidas).toEqual([2000]);
    });
});

describe('sincronizar — recuperación end-to-end cuando una escritura no idempotente falla (T6)', () => {
    test('caso "no aplicada": timeout en el alta (corrida 1) → nada se creó; la corrida 2 crea completo, sin duplicados', async () => {
        const notionFalso = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
        const fetchConPerdida = conRespuestaPerdidaUnaVez(
            notionFalso.fetchFalso,
            (url, init) => init.method === 'POST' && url.endsWith('/pages'),
            'no-aplicada',
        );
        const ejecutar = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });
        const credenciales = { token: 'tok', databaseId: notionFalso.databaseId };
        const contenido = docBase({
            seccionTareas: ['## Tareas', '', '- [x] **T1 — Uno**: hecha.'].join('\n'),
        });
        const hoy = new Date('2026-09-21T00:00:00Z');
        const listarDocumentos = () => [{ slug: 'feature-x', contenido }];

        await expect(
            sincronizar(
                { dryRun: false },
                { raizRepo: '/repo', ejecutar, fetchInyectado: fetchConPerdida, listarDocumentos, credenciales, hoy },
            ),
        ).rejects.toThrow(/no idempotente/i);
        expect(notionFalso.paginas.size).toBe(0); // no se aplicó nada

        const segunda = await sincronizar(
            { dryRun: false },
            { raizRepo: '/repo', ejecutar, fetchInyectado: notionFalso.fetchFalso, listarDocumentos, credenciales, hoy },
        );

        expect(segunda.creadas).toBe(1);
        expect(notionFalso.paginas.size).toBe(1);
        const pagina = [...notionFalso.paginas.values()][0];
        expect(pagina.hijos).toHaveLength(1);
        expect(pagina.properties.Huella).toBeDefined();
    });

    test('caso "aplicada": Notion creó la página pero la respuesta se perdió → la corrida 2 la completa sin duplicarla', async () => {
        const notionFalso = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
        const fetchConPerdida = conRespuestaPerdidaUnaVez(
            notionFalso.fetchFalso,
            (url, init) => init.method === 'POST' && url.endsWith('/pages'),
            'aplicada',
        );
        const ejecutar = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });
        const credenciales = { token: 'tok', databaseId: notionFalso.databaseId };
        const contenido = docBase({
            seccionTareas: ['## Tareas', '', '- [x] **T1 — Uno**: hecha.'].join('\n'),
        });
        const hoy = new Date('2026-09-21T00:00:00Z');
        const listarDocumentos = () => [{ slug: 'feature-x', contenido }];

        await expect(
            sincronizar(
                { dryRun: false },
                { raizRepo: '/repo', ejecutar, fetchInyectado: fetchConPerdida, listarDocumentos, credenciales, hoy },
            ),
        ).rejects.toThrow(/no idempotente/i);
        // La página SÍ quedó creada en Notion, pero sin Huella (se corta antes
        // de esa última escritura — ver "Huella al final", arreglo 1 de T5).
        expect(notionFalso.paginas.size).toBe(1);
        expect([...notionFalso.paginas.values()][0].properties.Huella).toBeUndefined();

        const segunda = await sincronizar(
            { dryRun: false },
            { raizRepo: '/repo', ejecutar, fetchInyectado: notionFalso.fetchFalso, listarDocumentos, credenciales, hoy },
        );

        // La corrida 2 ve la página existente (por Slug) con huella "" ≠ la
        // calculada: la trata como actualización con reescritura de cuerpo,
        // no como una alta nueva — sin duplicados.
        expect(segunda.creadas).toBe(0);
        expect(segunda.cuerposReescritos).toBe(1);
        expect(notionFalso.paginas.size).toBe(1);
        const paginaFinal = [...notionFalso.paginas.values()][0];
        expect(paginaFinal.hijos).toHaveLength(1);
        expect(paginaFinal.properties.Huella).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Fix 4 del review de T3: texto de bloque recortado y alta en lotes
// ---------------------------------------------------------------------------

function seccionConNTareas(n: number): string {
    const lineas = ['## Tareas', ''];
    for (let i = 1; i <= n; i++) {
        lineas.push(`- [ ] **T${i} — Tarea ${i}**: desc ${i}.`);
    }
    return lineas.join('\n');
}

describe('crearClienteNotion.crearPagina — recorte de texto y alta en lotes (fix 4 del review de T3)', () => {
    test('una descripción de 5000 caracteres llega recortada con "…" en el bloque to_do', async () => {
        const notionFalso = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
        const cliente = crearClienteNotion(notionFalso.fetchFalso, 'tok', async () => {});
        const dataSourceId = await cliente.obtenerDataSourceId(notionFalso.databaseId);
        const tareaLarga = tarea({ descripcion: 'x'.repeat(5000) });

        const pageId = await cliente.crearPagina(dataSourceId, { Slug: { rich_text: [] } }, [tareaLarga]);

        const pagina = notionFalso.paginas.get(pageId)!;
        const bloque = pagina.hijos[0].bloque as { to_do: { rich_text: Array<{ text: { content: string } }> } };
        const contenido = bloque.to_do.rich_text[0].text.content;
        expect(contenido.length).toBeLessThanOrEqual(1900);
        expect(contenido.endsWith('…')).toBe(true);
    });

    test('un documento con más tareas que el tamaño del lote genera un POST de alta y los appends necesarios', async () => {
        const notionFalso = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
        const cliente = crearClienteNotion(notionFalso.fetchFalso, 'tok', async () => {});
        const dataSourceId = await cliente.obtenerDataSourceId(notionFalso.databaseId);
        const tareas = Array.from({ length: 250 }, (_, i) => tarea({ id: `T${i + 1}`, nombre: `n${i}` }));

        const pageId = await cliente.crearPagina(dataSourceId, { Slug: { rich_text: [] } }, tareas);

        expect(notionFalso.llamadas.crearPagina).toBe(1);
        expect(notionFalso.llamadas.agregarHijos).toBe(2); // 150 restantes → lotes de 100 + 50
        expect(notionFalso.paginas.get(pageId)!.hijos).toHaveLength(250);
    });
});

// ---------------------------------------------------------------------------
// Fix 5 del review de T3: carpeta "odd/tasks" faltante o vacía es error
// ---------------------------------------------------------------------------

describe('listarDocumentosODD — carpeta faltante o vacía (fix 5 del review de T3)', () => {
    const raicesCreadas: string[] = [];
    afterAll(() => {
        for (const raiz of raicesCreadas) fs.rmSync(raiz, { recursive: true, force: true });
    });

    test('carpeta "odd/tasks" inexistente lanza un error explícito', () => {
        const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-tablero-sin-carpeta-'));
        raicesCreadas.push(raiz);

        expect(() => listarDocumentosODD(raiz)).toThrow(/no se encontró/i);
    });

    test('carpeta "odd/tasks" existente pero sin ningún ".md" lanza un error explícito', () => {
        const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-tablero-vacia-'));
        raicesCreadas.push(raiz);
        fs.mkdirSync(path.join(raiz, 'odd', 'tasks'), { recursive: true });

        expect(() => listarDocumentosODD(raiz)).toThrow(/ningún documento/i);
    });
});

describe('sincronizar — "listarDocumentos" que lanza es error de entorno (fix 5 del review de T3)', () => {
    test('código 1 y CERO llamadas al fetch, ANTES de cualquier llamada a Notion (aunque haya credenciales)', async () => {
        const fetchEspiado = jest.fn();
        const listarDocumentos = (): Array<{ slug: string; contenido: string }> => {
            throw new Error('No se encontró "odd/tasks" en "/otro/lugar".');
        };

        const resumen = await sincronizar(
            { dryRun: true },
            {
                raizRepo: '/otro/lugar',
                ejecutar: crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' }),
                fetchInyectado: fetchEspiado as unknown as FetchInyectado,
                listarDocumentos,
                credenciales: { token: 'tok', databaseId: 'db-1' },
                hoy: new Date('2026-09-21T00:00:00Z'),
            },
        );

        expect(resumen.codigo).toBe(1);
        expect(fetchEspiado).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Fix 7 del review de T3: falla de git ≠ error de formato
// ---------------------------------------------------------------------------

describe('sincronizar — falla de git ≠ error de formato (fix 7 del review de T3)', () => {
    const HASH = `a${'0'.repeat(39)}`; // 40 caracteres hex, formato válido

    test('repositorio superficial con documentos que declaran "commits" es error de ENTORNO, no de formato', async () => {
        const listarDocumentos = () => [
            {
                slug: 'con-commits',
                contenido: docBase({ frontmatter: `---\nramas: []\ncommits: ["${HASH}"]\n---` }),
            },
        ];
        const ejecutar = crearEjecutarFalso({
            ramas: '',
            prs: '[]',
            ownerRepo: 'owner/repo',
            superficial: true,
        });

        const resumen = await sincronizar(
            { dryRun: true },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: jest.fn() as unknown as FetchInyectado,
                listarDocumentos,
                credenciales: null,
                hoy: new Date('2026-09-21T00:00:00Z'),
            },
        );

        expect(resumen.codigo).toBe(1);
        expect(resumen.erroresDeFormato).toEqual([]); // NO es un error de formato del documento
    });

    test('si "git" no puede correr (ENOENT o similar), es error de entorno, no de formato', async () => {
        const listarDocumentos = () => [
            {
                slug: 'con-commits',
                contenido: docBase({ frontmatter: `---\nramas: []\ncommits: ["${HASH}"]\n---` }),
            },
        ];
        const ejecutar = crearEjecutarFalso({
            ramas: '',
            prs: '[]',
            ownerRepo: 'owner/repo',
            gitNoDisponible: true,
        });

        const resumen = await sincronizar(
            { dryRun: true },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: jest.fn() as unknown as FetchInyectado,
                listarDocumentos,
                credenciales: null,
                hoy: new Date('2026-09-21T00:00:00Z'),
            },
        );

        expect(resumen.codigo).toBe(1);
        expect(resumen.erroresDeFormato).toEqual([]);
    });

    test('en un repo COMPLETO con git funcionando, un commit inexistente sigue siendo error de FORMATO', async () => {
        const listarDocumentos = () => [
            {
                slug: 'con-commits',
                contenido: docBase({ frontmatter: `---\nramas: []\ncommits: ["${HASH}"]\n---` }),
            },
        ];
        const ejecutar = crearEjecutarFalso({
            ramas: '',
            prs: '[]',
            ownerRepo: 'owner/repo',
            superficial: false,
            commits: {},
        });

        const resumen = await sincronizar(
            { dryRun: true },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: jest.fn() as unknown as FetchInyectado,
                listarDocumentos,
                credenciales: null,
                hoy: new Date('2026-09-21T00:00:00Z'),
            },
        );

        expect(resumen.codigo).toBe(1);
        expect(resumen.erroresDeFormato).toHaveLength(1);
        expect(resumen.erroresDeFormato[0].slug).toBe('con-commits');
    });
});

// ---------------------------------------------------------------------------
// Fix 8 del review de T3: slugs duplicados en Notion se informan
// ---------------------------------------------------------------------------

describe('resolverDuplicadosPorSlug (fix 8 del review de T3)', () => {
    test('dos páginas con el mismo Slug: se actualiza la más antigua, la otra queda "duplicada"; nada se borra', () => {
        const paginas: PaginaExistente[] = [
            { pageId: 'page-nueva', slug: 'x', huella: 'h1', createdTime: '2026-09-01T00:00:00Z' },
            { pageId: 'page-vieja', slug: 'x', huella: 'h1', createdTime: '2026-01-01T00:00:00Z' },
        ];
        const { unicas, duplicadas } = resolverDuplicadosPorSlug(paginas);

        expect(unicas).toEqual([paginas[1]]);
        expect(duplicadas).toEqual([{ slug: 'x', pageIds: ['page-nueva'] }]);
    });

    test('sin slugs repetidos, todas quedan "únicas" y "duplicadas" queda vacío', () => {
        const paginas: PaginaExistente[] = [
            { pageId: 'a', slug: 'x', huella: 'h' },
            { pageId: 'b', slug: 'y', huella: 'h' },
        ];
        const { unicas, duplicadas } = resolverDuplicadosPorSlug(paginas);

        expect(unicas).toHaveLength(2);
        expect(duplicadas).toEqual([]);
    });

    test('sin "createdTime" en ninguna, se conserva la primera en el orden de la consulta', () => {
        const paginas: PaginaExistente[] = [
            { pageId: 'primera', slug: 'x', huella: 'h' },
            { pageId: 'segunda', slug: 'x', huella: 'h' },
        ];
        const { unicas, duplicadas } = resolverDuplicadosPorSlug(paginas);

        expect(unicas[0].pageId).toBe('primera');
        expect(duplicadas).toEqual([{ slug: 'x', pageIds: ['segunda'] }]);
    });
});

describe('sincronizar — slugs duplicados en Notion se informan (fix 8 del review de T3)', () => {
    test('dos páginas con el mismo Slug: se actualiza la más antigua, la otra aparece como duplicada, código 1, nada se borra', async () => {
        const notionFalso = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
        notionFalso.paginas.set('page-1', {
            id: 'page-1',
            properties: propiedadesMinimas('feature-x', 'h-vieja'),
            hijos: [],
            createdTime: '2026-01-01T00:00:00Z',
        });
        notionFalso.paginas.set('page-2', {
            id: 'page-2',
            properties: propiedadesMinimas('feature-x', 'h-vieja'),
            hijos: [],
            createdTime: '2026-06-01T00:00:00Z',
        });

        const listarDocumentos = () => [{ slug: 'feature-x', contenido: docBase() }];
        const ejecutar = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });

        const resumen = await sincronizar(
            { dryRun: false },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: notionFalso.fetchFalso,
                listarDocumentos,
                credenciales: { token: 'tok', databaseId: notionFalso.databaseId },
                hoy: new Date('2026-09-21T00:00:00Z'),
            },
        );

        expect(resumen.codigo).toBe(1);
        expect(resumen.duplicadas).toEqual([{ slug: 'feature-x', pageIds: ['page-2'] }]);
        // Ambas páginas siguen existiendo en el fake: nada se borró.
        expect(notionFalso.paginas.has('page-1')).toBe(true);
        expect(notionFalso.paginas.has('page-2')).toBe(true);
        // Se actualizó la más antigua (page-1): sus propiedades cambiaron.
        expect(notionFalso.paginas.get('page-1')!.properties.Huella).not.toEqual(
            propiedadesMinimas('feature-x', 'h-vieja').Huella,
        );
    });
});
