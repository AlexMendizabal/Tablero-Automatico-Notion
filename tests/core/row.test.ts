/**
 * @jest-environment node
 *
 * Tests del armado de fila del tablero (núcleo).
 *
 * Los casos NO leen `odd/tasks/` real: los documentos son strings fixture
 * dentro del propio test (convención de la casa, ver
 * `validar-rutas-docs.test.ts`), así que mover o editar un archivo del repo
 * no puede volver estos tests rojos por accidente.
 */
import { construirFila, ENCABEZADO_FILA_LEGIBLE, formatearFilaLegible } from '../../src/core/entities/feature';
import { type DocumentoODD } from '../../src/core/types';
import { filaBase, tarea } from '../helpers/fixtures';

import '../helpers/aislar-board-language';

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

describe('construirFila — contribuyentes', () => {
    const pr = (number: number, headRefName: string, autor?: string) => ({
        number,
        headRefName,
        state: 'MERGED' as const,
        createdAt: '2026-08-01T00:00:00Z',
        mergedAt: '2026-08-02T00:00:00Z',
        closedAt: '2026-08-02T00:00:00Z',
        ...(autor ? { autor } : {}),
    });

    test('une los autores de sus commits con los autores de SUS PRs (solo los que matchean sus ramas)', () => {
        const documento: DocumentoODD = { slug: 'x', ramas: ['feat/x*'], commits: [], titulo: 'X', tareas: [tarea()] };
        const fila = construirFila({
            documento,
            todasLasRamas: [],
            todosLosPRs: [pr(1, 'feat/x-1', 'octocat'), pr(2, 'feat/otra', 'intrusa'), pr(3, 'feat/x-2')],
            autoresCommits: [
                { nombre: 'Zoe', email: 'zoe@x.com', coautores: [{ nombre: 'Bruno', email: 'b@x.com' }] },
                { nombre: 'Octo', email: '1+OctoCat@users.noreply.github.com', coautores: [] },
            ],
            fechaDocumento: null,
            hoy: new Date('2026-09-21T00:00:00Z'),
            ownerRepo: 'o/r',
        });

        expect(fila.contribuyentes).toEqual(['Bruno', 'octocat', 'Zoe']);
    });

    test('sin autores ni PRs, ninguno', () => {
        const documento: DocumentoODD = { slug: 'x', ramas: ['feat/x'], commits: [], titulo: 'X', tareas: [tarea()] };
        const fila = construirFila({
            documento,
            todasLasRamas: [],
            todosLosPRs: [],
            fechaDocumento: null,
            hoy: new Date('2026-09-21T00:00:00Z'),
            ownerRepo: 'o/r',
        });
        expect(fila.contribuyentes).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// formatearFilaLegible ("--dry-run" sin credenciales)
// ---------------------------------------------------------------------------

describe('formatearFilaLegible', () => {
    test('fija el ancho de cada columna y el separador " | "', () => {
        expect(formatearFilaLegible(filaBase())).toBe(
            'feature-x                    | En curso       | 1/2 tareas   | #1               | 5d     | 2026-09-01T00:00:00.000Z | —',
        );
    });

    test('los contribuyentes van al final, separados por comas', () => {
        const columnas = formatearFilaLegible(filaBase({ contribuyentes: ['Ana', 'octocat'] })).split(' | ');
        expect(columnas[columnas.length - 1]).toBe('Ana, octocat');
    });

    test('el encabezado nombra la columna de contribuyentes', () => {
        expect(ENCABEZADO_FILA_LEGIBLE).toBe('slug | estado | progreso | PRs abiertos | días | actualizado | contribuyentes');
    });

    test('sin PRs abiertos muestra una raya (—) en esa columna', () => {
        const columnas = formatearFilaLegible(filaBase({ prsAbiertos: '' })).split(' | ');
        expect(columnas[3]).toBe('—'.padEnd(16));
    });

    test('un slug más largo que su columna no se recorta', () => {
        const slugLargo = 'una-feature-con-un-slug-muy-largo-de-verdad';
        expect(formatearFilaLegible(filaBase({ slug: slugLargo })).startsWith(`${slugLargo} | `)).toBe(true);
    });
});
