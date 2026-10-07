/**
 * @jest-environment node
 *
 * Tests de estado y actividad de una feature (núcleo).
 *
 * Los casos NO leen `odd/tasks/` real: los documentos son strings fixture
 * dentro del propio test (convención de la casa, ver
 * `validar-rutas-docs.test.ts`), así que mover o editar un archivo del repo
 * no puede volver estos tests rojos por accidente.
 */
import { calcularActualizado, coincideRama, derivarEstado, diasSinActividad } from '../../src/core/status';
import { type PullRequestInfo } from '../../src/core/types';
import { tarea } from '../helpers/fixtures';

import '../helpers/aislar-board-language';

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
