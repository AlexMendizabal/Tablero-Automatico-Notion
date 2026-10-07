/**
 * @jest-environment node
 *
 * Tests de huella, plan de sync y slugs duplicados (núcleo).
 *
 * Los casos NO leen `odd/tasks/` real: los documentos son strings fixture
 * dentro del propio test (convención de la casa, ver
 * `validar-rutas-docs.test.ts`), así que mover o editar un archivo del repo
 * no puede volver estos tests rojos por accidente.
 */
import { calcularHuella, planificarSync, resolverDuplicadosPorSlug } from '../../src/core/plan';
import { type PaginaExistente, type TareaDocumento } from '../../src/core/types';
import { filaBase, tarea } from '../helpers/fixtures';

import '../helpers/aislar-board-language';

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

    test('un "createdTime" que no es una fecha válida se trata como ausente: gana la fecha válida, sin importar el orden', () => {
        const invalida: PaginaExistente = { pageId: 'invalida', slug: 'x', huella: 'h', createdTime: 'no-es-fecha' };
        const valida: PaginaExistente = { pageId: 'valida', slug: 'x', huella: 'h', createdTime: '2026-05-01T00:00:00Z' };
        const masNueva: PaginaExistente = { pageId: 'mas-nueva', slug: 'x', huella: 'h', createdTime: '2026-06-01T00:00:00Z' };

        for (const orden of [
            [invalida, valida, masNueva],
            [masNueva, invalida, valida],
            [valida, masNueva, invalida],
            [invalida, masNueva, valida],
        ]) {
            const { unicas, duplicadas } = resolverDuplicadosPorSlug(orden);
            expect(unicas.map((p) => p.pageId)).toEqual(['valida']);
            expect(duplicadas[0].pageIds).toHaveLength(2);
            expect(duplicadas[0].pageIds.indexOf('mas-nueva')).toBeLessThan(duplicadas[0].pageIds.indexOf('invalida'));
        }
    });

    test('"createdTime" inválido y ausente empatan (los dos van al final): se conserva el orden de la consulta', () => {
        const paginas: PaginaExistente[] = [
            { pageId: 'invalida', slug: 'x', huella: 'h', createdTime: 'basura' },
            { pageId: 'sin-fecha', slug: 'x', huella: 'h' },
        ];
        const { unicas, duplicadas } = resolverDuplicadosPorSlug(paginas);

        expect(unicas[0].pageId).toBe('invalida');
        expect(duplicadas).toEqual([{ slug: 'x', pageIds: ['sin-fecha'] }]);
    });
});
