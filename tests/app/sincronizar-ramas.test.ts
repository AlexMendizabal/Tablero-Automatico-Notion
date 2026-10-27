/**
 * @jest-environment node
 *
 * Tests de la orquestación con documentos que cambian en las ramas vivas:
 * el tablero publica la versión editada más recientemente (avance en vivo),
 * con el enlace "Documento" a su rama, para Features y Tareas.
 */
import type { FetchInyectado } from '../../src/ports/notion';
import type { EjecutarComando } from '../../src/ports/sincronizar';
import {
    combinarNotionFalsos,
    crearEjecutarFalso,
    crearNotionFalsoCompleto,
    crearNotionFalsoTareas,
    docBase,
    ESQUEMA_CORRECTO_NOTION,
} from '../helpers/fixtures';
import { sincronizar } from '../helpers/sincronizar-compuesto';

import '../helpers/aislar-board-language';

const HOY = new Date('2026-10-20T00:00:00Z');

const tareas = (hechas: boolean[]) =>
    ['## Tareas', '', ...hechas.map((hecha, i) => `- [${hecha ? 'x' : ' '}] **T${i + 1} — Paso ${i + 1}**: algo.`)].join(
        '\n',
    );
const featureX = (hechas: boolean[]) =>
    docBase({ frontmatter: '---\nramas: ["feat/x*"]\n---', seccionTareas: tareas(hechas) });
const docTarea = (hechas: boolean[]) =>
    ['---', 'ramas: ["feat/x*"]', 'feature: "feature-x"', '---', '', '# Tarea X', '', tareas(hechas), ''].join('\n');

const EN_CHECKOUT = featureX([false, false]);
const EN_RAMA = featureX([true, true]);

/** El checkout (`HEAD`) tiene feature-x sin avance; `feat/x-1` la completó
 *  después y además trae un documento nuevo, feature-nueva. */
const documentosPorRama = {
    HEAD: { 'odd/tasks/feature-x.md': { contenido: EN_CHECKOUT, fecha: '2026-10-01T00:00:00Z' } },
    'origin/feat/x-1': {
        'odd/tasks/feature-x.md': { contenido: EN_RAMA, fecha: '2026-10-15T00:00:00Z' },
        'odd/tasks/feature-nueva.md': {
            contenido: docBase({ frontmatter: '---\nramas: ["feat/x-1"]\n---', titulo: '# Nueva' }),
            fecha: '2026-10-15T00:00:00Z',
        },
        'odd/tareas/tarea-x.md': { contenido: docTarea([true]), fecha: '2026-10-15T00:00:00Z' },
    },
};

const ejecutarConRamas = (extra: Parameters<typeof crearEjecutarFalso>[0] = {}) =>
    crearEjecutarFalso({
        ramas: 'origin/feat/x-1\t2026-10-15T00:00:00Z',
        prs: '[]',
        ownerRepo: 'owner/repo',
        fechasPorSlug: { 'feature-x': '2026-10-01T00:00:00Z', 'tarea-x': '2026-10-01T00:00:00Z' },
        documentosPorRama,
        ...extra,
    });

async function dryRun(ejecutar: EjecutarComando, documentosEnCheckout = [{ slug: 'feature-x', contenido: EN_CHECKOUT }]) {
    const lineas: string[] = [];
    const resumen = await sincronizar(
        { dryRun: true },
        {
            raizRepo: '/repo',
            ejecutar,
            fetchInyectado: jest.fn() as unknown as FetchInyectado,
            listarDocumentos: () => documentosEnCheckout,
            listarDocumentosTareas: () => [{ slug: 'tarea-x', contenido: docTarea([false]) }],
            credenciales: null,
            hoy: HOY,
            log: (l) => lineas.push(l),
        },
    );
    return { resumen, lineas };
}

const filaDe = (lineas: string[], slug: string) => lineas.find((l) => l.startsWith(`${slug} `));

describe('sincronizar — avance en vivo desde las ramas', () => {
    test('publica el avance de la versión de la rama editada después que la del checkout', async () => {
        const { resumen, lineas } = await dryRun(ejecutarConRamas());

        expect(resumen.codigo).toBe(0);
        expect(filaDe(lineas, 'feature-x')).toContain('2/2 tareas');
        expect(filaDe(lineas, 'feature-x')).toContain('Terminada');
    });

    test('un documento que solo existe en una rama aparece en el tablero', async () => {
        const { resumen, lineas } = await dryRun(ejecutarConRamas());

        expect(resumen.slugsDocumentos).toEqual(['feature-x', 'feature-nueva']);
        expect(filaDe(lineas, 'feature-nueva')).toBeDefined();
    });

    test('las Tareas también publican la versión más reciente de su rama', async () => {
        const { lineas } = await dryRun(ejecutarConRamas());
        const tareasLog = lineas.slice(lineas.indexOf('Tareas:'));

        expect(filaDe(tareasLog, 'tarea-x')).toContain('1/1 tareas');
    });

    test('si la versión del checkout es la más reciente, se publica la del checkout', async () => {
        const { lineas } = await dryRun(ejecutarConRamas({ fechasPorSlug: { 'feature-x': '2026-10-18T00:00:00Z' } }));

        expect(filaDe(lineas, 'feature-x')).toContain('0/2 tareas');
    });

    test('si git no puede leer las ramas, avisa y usa solo el checkout', async () => {
        const base = ejecutarConRamas();
        const ejecutar: EjecutarComando = (comando, args) => {
            if (args[0] === 'ls-tree') throw new Error('fatal: bad object');
            return base(comando, args);
        };
        const { resumen, lineas } = await dryRun(ejecutar);

        expect(resumen.codigo).toBe(0);
        expect(filaDe(lineas, 'feature-x')).toContain('0/2 tareas');
        expect(filaDe(lineas, 'feature-nueva')).toBeUndefined();
        expect(lineas).toContain(
            'Aviso: no se pudieron leer los documentos de "odd/tasks" en las ramas (fatal: bad object): se usan solo los del checkout.',
        );
    });

    test('una versión de rama con errores de formato se ignora con un aviso', async () => {
        const { lineas } = await dryRun(
            ejecutarConRamas({
                documentosPorRama: {
                    ...documentosPorRama,
                    'origin/feat/x-1': {
                        'odd/tasks/feature-x.md': { contenido: '# sin frontmatter\n', fecha: '2026-10-15T00:00:00Z' },
                    },
                },
            }),
        );

        expect(filaDe(lineas, 'feature-x')).toContain('0/2 tareas');
        expect(lineas).toContain(
            'Aviso: la versión de "feature-x" en la rama "feat/x-1" tiene errores de formato: se ignora.',
        );
    });

    test('en Notion, el enlace "Documento" apunta a la rama de la versión publicada', async () => {
        const features = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
        const notionTareas = crearNotionFalsoTareas();
        const { fetchFalso } = combinarNotionFalsos(features, notionTareas);

        const resumen = await sincronizar(
            { dryRun: false },
            {
                raizRepo: '/repo',
                ejecutar: ejecutarConRamas({
                    fechasPorSlug: { 'feature-x': '2026-10-18T00:00:00Z', 'tarea-x': '2026-10-01T00:00:00Z' },
                }),
                fetchInyectado: fetchFalso,
                listarDocumentos: () => [{ slug: 'feature-x', contenido: EN_CHECKOUT }],
                listarDocumentosTareas: () => [{ slug: 'tarea-x', contenido: docTarea([false]) }],
                credenciales: { token: 'tok', databaseId: features.databaseId, databaseIdTareas: notionTareas.databaseId },
                hoy: HOY,
            },
        );

        expect(resumen.codigo).toBe(0);
        const urls = (paginas: Map<string, { properties: Record<string, unknown> }>) =>
            [...paginas.values()].map((p) => (p.properties.Documento as { url: string }).url).sort();
        expect(urls(features.paginas)).toEqual([
            'https://github.com/owner/repo/blob/feat/x-1/odd/tasks/feature-nueva.md',
            // El checkout es más reciente: el enlace sigue en la rama base.
            'https://github.com/owner/repo/blob/main/odd/tasks/feature-x.md',
        ]);
        expect(urls(notionTareas.paginas)).toEqual(['https://github.com/owner/repo/blob/feat/x-1/odd/tareas/tarea-x.md']);
    });
});
