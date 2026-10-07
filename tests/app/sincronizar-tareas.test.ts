/**
 * @jest-environment node
 *
 * Tests de la orquestación con las dos entidades (Features y Tareas):
 * no-op sin carpeta de Tareas, salteo sin NOTION_TAREAS_DB_ID, bloque de
 * Tareas en "--dry-run", orden y código de salida de la corrida real, y el
 * aviso de feature padre inexistente.
 *
 * Como en el resto de los tests de la app, los documentos son strings
 * fixture (nunca se lee `odd/` real).
 */
import * as app from '../../src/app/sincronizar';
import { crearDescriptorFeature } from '../../src/core/entities/feature';
import type { FetchInyectado } from '../../src/ports/notion';
import type { DependenciasSincronizar, EjecutarComando, RepositorioGit } from '../../src/ports/sincronizar';
import {
    combinarNotionFalsos,
    crearEjecutarFalso,
    crearNotionFalsoCompleto,
    crearNotionFalsoTareas,
    docBase,
    ESQUEMA_CORRECTO_NOTION,
} from '../helpers/fixtures';
import { sincronizar, sincronizarEntidad } from '../helpers/sincronizar-compuesto';

import '../helpers/aislar-board-language';

const HOY = new Date('2026-09-21T00:00:00Z');
const AJUSTES = { carpetaFeatures: 'odd/tasks', carpetaTareas: 'odd/tareas', ramaBaseDocumento: 'main' };

const documentosFeatures = () => [{ slug: 'feature-x', contenido: docBase() }];
const docTarea = (padre: string | null, titulo = '# Tarea X') =>
    docBase({
        frontmatter: ['---', 'ramas: ["feat/tarea-x*"]', ...(padre === null ? [] : [`feature: "${padre}"`]), '---'].join(
            '\n',
        ),
        titulo,
    });
const documentosTareas = (padre: string | null = 'feature-x') => () => [{ slug: 'tarea-x', contenido: docTarea(padre) }];

const ejecutar = () => crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });

/** Puertos falsos sin adaptadores, para mirar exactamente qué pide la app. */
function puertosFalsos(
    listarDocumentos: DependenciasSincronizar['listarDocumentos'],
    extra: Partial<DependenciasSincronizar> = {},
): DependenciasSincronizar {
    const repositorio: RepositorioGit = {
        esRepoSuperficial: () => false,
        fechaCommit: () => null,
        fechaDocumento: () => '2026-09-01T00:00:00Z',
        ramasConFecha: () => [],
        prs: () => [],
        ownerRepo: () => 'owner/repo',
    };
    return {
        raizRepo: '/repo',
        listarDocumentos,
        repositorio,
        configuracion: { cargarCredenciales: () => null, leerBoardLanguage: () => undefined },
        crearClienteNotion: jest.fn(),
        ajustes: AJUSTES,
        hoy: HOY,
        credenciales: null,
        ...extra,
    };
}

// ---------------------------------------------------------------------------
// Sin carpeta de Tareas: no-op, salida idéntica a la de solo Features
// ---------------------------------------------------------------------------

describe('sincronizar — sin documentos de Tareas', () => {
    test.each([true, false])(
        'el log y el código son EXACTAMENTE los de solo Features (dry-run: %s)',
        async (dryRun) => {
            const correr = async (soloFeatures: boolean) => {
                const notionFalso = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
                const lineas: string[] = [];
                const entrada = {
                    raizRepo: '/repo',
                    ejecutar: ejecutar(),
                    fetchInyectado: notionFalso.fetchFalso,
                    listarDocumentos: documentosFeatures,
                    credenciales: dryRun ? null : { token: 'tok', databaseId: notionFalso.databaseId },
                    hoy: HOY,
                    ajustes: AJUSTES,
                    log: (l: string) => lineas.push(l),
                };
                const resumen: app.ResumenGeneral = soloFeatures
                    ? await sincronizarEntidad(crearDescriptorFeature(AJUSTES), { dryRun }, entrada)
                    : await sincronizar({ dryRun }, entrada);
                return { resumen, lineas };
            };

            const soloFeatures = await correr(true);
            const ambas = await correr(false);

            expect(ambas.lineas.length).toBeGreaterThan(2);
            expect(ambas.lineas).toEqual(soloFeatures.lineas);
            expect(ambas.resumen.codigo).toBe(soloFeatures.resumen.codigo);
            expect(ambas.resumen.tareas).toBeUndefined();
        },
    );

    test('con puertos falsos idénticos, el log es byte a byte el de solo Features', async () => {
        const lineasSoloFeatures: string[] = [];
        await app.sincronizarEntidad(
            crearDescriptorFeature(AJUSTES),
            { dryRun: true },
            puertosFalsos(documentosFeatures, { log: (l) => lineasSoloFeatures.push(l) }),
        );
        const lineas: string[] = [];
        const listarDocumentos = jest.fn((carpeta: string) => (carpeta === 'odd/tasks' ? documentosFeatures() : []));

        await app.sincronizar({ dryRun: true }, puertosFalsos(listarDocumentos, { log: (l) => lineas.push(l) }));

        expect(lineas).toEqual(lineasSoloFeatures);
    });
});

// ---------------------------------------------------------------------------
// listarDocumentos recibe la carpeta de cada descriptor
// ---------------------------------------------------------------------------

describe('sincronizar — carpeta de cada entidad', () => {
    test('listarDocumentos recibe la carpeta de Features y la de Tareas (esta, como opcional)', async () => {
        const listarDocumentos = jest.fn((carpeta: string) =>
            carpeta === 'docs/features' ? documentosFeatures() : documentosTareas()(),
        );

        await app.sincronizar(
            { dryRun: true },
            puertosFalsos(listarDocumentos, {
                ajustes: { carpetaFeatures: 'docs/features', carpetaTareas: 'docs/tareas', ramaBaseDocumento: 'main' },
            }),
        );

        expect(listarDocumentos.mock.calls).toEqual([['docs/features'], ['docs/tareas', { opcional: true }]]);
    });
});

describe('sincronizar — carpeta de Tareas inválida (TABLERO_CARPETA_TAREAS)', () => {
    test.each([
        ['vacía', '', /^TABLERO_CARPETA_TAREAS está vacía/],
        ['igual a la de Features', './odd/tasks/', /^TABLERO_CARPETA_TAREAS \(".\/odd\/tasks\/"\) es la misma carpeta que TABLERO_CARPETA/],
    ])('%s: error de configuración con código 1, antes de cualquier llamada a Notion', async (_caso, carpetaTareas, mensaje) => {
        const lineas: string[] = [];
        const crearClienteNotion = jest.fn();
        const listarDocumentos = jest.fn(() => documentosFeatures());

        const resumen = await app.sincronizar(
            { dryRun: false },
            puertosFalsos(listarDocumentos, {
                ajustes: { ...AJUSTES, carpetaTareas },
                credenciales: { token: 'tok', databaseId: '0123456789abcdef0123456789abcdef' },
                crearClienteNotion,
                log: (l) => lineas.push(l),
            }),
        );

        expect(resumen.codigo).toBe(1);
        expect(lineas).toHaveLength(1);
        expect(lineas[0]).toMatch(mensaje);
        expect(crearClienteNotion).not.toHaveBeenCalled();
        expect(listarDocumentos).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// "--dry-run" sin credenciales: bloque de Tareas
// ---------------------------------------------------------------------------

describe('sincronizar — "--dry-run" sin credenciales con Tareas', () => {
    test('imprime un segundo bloque "Tareas:" con el slug de la feature padre', async () => {
        const lineas: string[] = [];
        const resumen = await sincronizar(
            { dryRun: true },
            {
                raizRepo: '/repo',
                ejecutar: ejecutar(),
                fetchInyectado: jest.fn() as unknown as FetchInyectado,
                listarDocumentos: documentosFeatures,
                listarDocumentosTareas: documentosTareas('feature-x'),
                credenciales: null,
                hoy: HOY,
                log: (l) => lineas.push(l),
            },
        );

        expect(resumen.codigo).toBe(0);
        expect(resumen.tareas?.entidad).toBe('tarea');
        const inicioTareas = lineas.indexOf('Tareas:');
        expect(inicioTareas).toBeGreaterThan(lineas.indexOf('Errores de formato: 0'));
        expect(lineas[inicioTareas - 1]).toBe('');
        expect(lineas.slice(inicioTareas + 1, inicioTareas + 3)).toEqual([
            '--dry-run sin credenciales: NO se consultó Notion. Filas calculadas desde el repositorio:',
            'slug | feature | estado | progreso | PRs abiertos | días | actualizado',
        ]);
        expect(lineas[inicioTareas + 3]).toMatch(/^tarea-x\s+\| feature-x\s+\| Terminada\s+\| 1\/1 tareas/);
        expect(lineas.slice(inicioTareas + 4)).toEqual([
            'Plan de escritura: no calculado (no se consultó Notion).',
            'Errores de formato: 0',
        ]);
    });

    test('un error de formato en una Tarea vuelve el código 1 aunque Features esté bien', async () => {
        const lineas: string[] = [];
        const resumen = await sincronizar(
            { dryRun: true },
            {
                raizRepo: '/repo',
                ejecutar: ejecutar(),
                fetchInyectado: jest.fn() as unknown as FetchInyectado,
                listarDocumentos: documentosFeatures,
                listarDocumentosTareas: () => [{ slug: 'rota', contenido: '# sin frontmatter' }],
                credenciales: null,
                hoy: HOY,
                log: (l) => lineas.push(l),
            },
        );

        expect(resumen.erroresDeFormato).toEqual([]); // los de Features
        expect(resumen.tareas?.erroresDeFormato.map((e) => e.slug)).toEqual(['rota']);
        expect(resumen.codigo).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Feature padre inexistente: aviso, no error
// ---------------------------------------------------------------------------

describe('sincronizar — feature padre inexistente', () => {
    test('se avisa en el resumen de Tareas, la fila se arma igual y el código no cambia', async () => {
        const lineas: string[] = [];
        const resumen = await sincronizar(
            { dryRun: true },
            {
                raizRepo: '/repo',
                ejecutar: ejecutar(),
                fetchInyectado: jest.fn() as unknown as FetchInyectado,
                listarDocumentos: documentosFeatures,
                listarDocumentosTareas: documentosTareas('no-existe'),
                credenciales: null,
                hoy: HOY,
                log: (l) => lineas.push(l),
            },
        );

        expect(resumen.codigo).toBe(0);
        expect(resumen.tareas?.erroresDeFormato).toEqual([]);
        expect(resumen.tareas?.avisos).toEqual([
            {
                slug: 'tarea-x',
                mensajes: ['La feature padre "no-existe" no existe: no hay ningún documento "no-existe.md" en "odd/tasks".'],
            },
        ]);
        const inicioTareas = lineas.indexOf('Tareas:');
        expect(lineas.slice(inicioTareas)).toEqual(
            expect.arrayContaining([
                'Avisos: 1',
                '  tarea-x:',
                '    - La feature padre "no-existe" no existe: no hay ningún documento "no-existe.md" en "odd/tasks".',
            ]),
        );
        expect(lineas.slice(inicioTareas).some((l) => l.startsWith('tarea-x '))).toBe(true);
    });

    test.each([
        ['repositorio superficial', { superficial: true }],
        ['git no disponible', { gitNoDisponible: true }],
    ])('el aviso se imprime también en el retorno temprano por %s', async (_caso, entorno) => {
        const lineas: string[] = [];
        const sha = 'a'.repeat(40);
        const frontmatter = ['---', 'ramas: ["feat/t*"]', `commits: ["${sha}"]`, 'feature: "no-existe"', '---'].join('\n');
        const base = ejecutar();
        // git solo "falla" para las Tareas (las únicas que declaran commits).
        const ejecutarEntorno: EjecutarComando = (comando, args) =>
            comando === 'git' && args[0] === 'rev-parse'
                ? crearEjecutarFalso({ ...entorno })(comando, args)
                : base(comando, args);

        const resumen = await sincronizar(
            { dryRun: true },
            {
                raizRepo: '/repo',
                ejecutar: ejecutarEntorno,
                fetchInyectado: jest.fn() as unknown as FetchInyectado,
                listarDocumentos: documentosFeatures,
                listarDocumentosTareas: () => [{ slug: 'tarea-x', contenido: docBase({ frontmatter }) }],
                credenciales: null,
                hoy: HOY,
                log: (l) => lineas.push(l),
            },
        );

        expect(resumen.codigo).toBe(1);
        expect(resumen.tareas?.avisos?.map((a) => a.slug)).toEqual(['tarea-x']);
        const bloqueTareas = lineas.slice(lineas.indexOf('Tareas:'));
        expect(bloqueTareas[1]).toMatch(/^Error de entorno: /);
        expect(bloqueTareas.slice(2)).toEqual([
            'Avisos: 1',
            '  tarea-x:',
            '    - La feature padre "no-existe" no existe: no hay ningún documento "no-existe.md" en "odd/tasks".',
        ]);
    });

    test('una tarea sin padre, o con un padre que existe, no genera avisos', async () => {
        const lineas: string[] = [];
        const resumen = await sincronizar(
            { dryRun: true },
            {
                raizRepo: '/repo',
                ejecutar: ejecutar(),
                fetchInyectado: jest.fn() as unknown as FetchInyectado,
                listarDocumentos: documentosFeatures,
                listarDocumentosTareas: () => [
                    { slug: 'con-padre', contenido: docTarea('feature-x') },
                    { slug: 'sin-padre', contenido: docTarea(null) },
                ],
                credenciales: null,
                hoy: HOY,
                log: (l) => lineas.push(l),
            },
        );

        expect(resumen.tareas?.avisos).toBeUndefined();
        expect(lineas.join('\n')).not.toContain('Avisos:');
    });
});

// ---------------------------------------------------------------------------
// Credenciales: NOTION_TAREAS_DB_ID opcional
// ---------------------------------------------------------------------------

describe('sincronizar — sin NOTION_TAREAS_DB_ID', () => {
    test('corrida real: Features se sincroniza, Tareas se saltea con un aviso informativo y el código no cambia', async () => {
        const notionFalso = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
        const lineas: string[] = [];

        const resumen = await sincronizar(
            { dryRun: false },
            {
                raizRepo: '/repo',
                ejecutar: ejecutar(),
                fetchInyectado: notionFalso.fetchFalso,
                listarDocumentos: documentosFeatures,
                listarDocumentosTareas: documentosTareas(),
                credenciales: { token: 'tok', databaseId: notionFalso.databaseId },
                hoy: HOY,
                log: (l) => lineas.push(l),
            },
        );

        expect(resumen.codigo).toBe(0);
        expect(resumen.creadas).toBe(1);
        expect(resumen.tareas?.codigo).toBe(0);
        expect(resumen.tareas?.consultoNotion).toBe(false);
        expect(notionFalso.paginas.size).toBe(1);
        expect(lineas.slice(lineas.indexOf('Tareas:'))).toEqual([
            'Tareas:',
            'NOTION_TAREAS_DB_ID no está definido: se omite la sincronización de Tareas con Notion.',
            'Plan de escritura: no calculado (no se consultó Notion).',
            'Errores de formato: 0',
        ]);
    });

    test.each([false, true])(
        'las Tareas se validan igual: un error de formato da código 1 y el aviso de padre se imprime (dry-run: %s)',
        async (dryRun) => {
            const notionFalso = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
            const lineas: string[] = [];

            const resumen = await sincronizar(
                { dryRun },
                {
                    raizRepo: '/repo',
                    ejecutar: ejecutar(),
                    fetchInyectado: notionFalso.fetchFalso,
                    listarDocumentos: documentosFeatures,
                    listarDocumentosTareas: () => [
                        { slug: 'huerfana', contenido: docTarea('no-existe') },
                        { slug: 'rota', contenido: '# sin frontmatter' },
                    ],
                    credenciales: { token: 'tok', databaseId: notionFalso.databaseId },
                    hoy: HOY,
                    log: (l) => lineas.push(l),
                },
            );

            expect(resumen.erroresDeFormato).toEqual([]);
            expect(resumen.tareas?.erroresDeFormato.map((e) => e.slug)).toEqual(['rota']);
            expect(resumen.tareas?.avisos?.map((a) => a.slug)).toEqual(['huerfana']);
            expect(resumen.codigo).toBe(1);
            const bloqueTareas = lineas.slice(lineas.indexOf('Tareas:'));
            expect(bloqueTareas[1]).toBe(
                'NOTION_TAREAS_DB_ID no está definido: se omite la sincronización de Tareas con Notion.',
            );
            expect(bloqueTareas).toEqual(
                expect.arrayContaining(['Avisos: 1', '  huerfana:', 'Errores de formato: 1', '  rota:']),
            );
        },
    );

    test('sin ninguna credencial y sin "--dry-run", Tareas no agrega nada al error de Features', async () => {
        const lineas: string[] = [];
        const lineasSinTareas: string[] = [];
        const entrada = {
            raizRepo: '/repo',
            ejecutar: ejecutar(),
            fetchInyectado: jest.fn() as unknown as FetchInyectado,
            listarDocumentos: documentosFeatures,
            credenciales: null,
            hoy: HOY,
        };

        const resumen = await sincronizar(
            { dryRun: false },
            { ...entrada, listarDocumentosTareas: documentosTareas(), log: (l) => lineas.push(l) },
        );
        await sincronizar({ dryRun: false }, { ...entrada, log: (l) => lineasSinTareas.push(l) });

        expect(resumen.codigo).toBe(1);
        expect(lineas).toEqual(lineasSinTareas);
    });

    test('un NOTION_TAREAS_DB_ID mal formado es error de configuración de Tareas (código 1), nombrando su variable', async () => {
        const notionFalso = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
        const lineas: string[] = [];

        const resumen = await sincronizar(
            { dryRun: false },
            {
                raizRepo: '/repo',
                ejecutar: ejecutar(),
                fetchInyectado: notionFalso.fetchFalso,
                listarDocumentos: documentosFeatures,
                listarDocumentosTareas: documentosTareas(),
                credenciales: { token: 'tok', databaseId: notionFalso.databaseId, databaseIdTareas: 'no-es-un-id' },
                hoy: HOY,
                log: (l) => lineas.push(l),
            },
        );

        expect(resumen.creadas).toBe(1); // Features se sincronizó igual
        expect(resumen.tareas?.codigo).toBe(1);
        expect(resumen.codigo).toBe(1);
        const tareas = lineas.slice(lineas.indexOf('Tareas:')).join('\n');
        expect(tareas).toMatch(/^NOTION_TAREAS_DB_ID no contiene un ID de base de Notion/m);
        expect(tareas).not.toContain('NOTION_TABLERO_DB_ID');
    });
});

// ---------------------------------------------------------------------------
// Corrida real con las dos bases
// ---------------------------------------------------------------------------

describe('sincronizar — corrida real con Features y Tareas', () => {
    test('sincroniza primero Features y después Tareas, cada una en su base', async () => {
        const features = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
        const tareas = crearNotionFalsoTareas();
        const { fetchFalso, orden } = combinarNotionFalsos(features, tareas);
        const lineas: string[] = [];

        const resumen = await sincronizar(
            { dryRun: false },
            {
                raizRepo: '/repo',
                ejecutar: ejecutar(),
                fetchInyectado: fetchFalso,
                listarDocumentos: documentosFeatures,
                listarDocumentosTareas: documentosTareas(),
                // La URL completa de la base de Tareas también vale.
                credenciales: {
                    token: 'tok',
                    databaseId: features.databaseId,
                    databaseIdTareas: `https://www.notion.so/Tareas-${tareas.databaseId}?v=123`,
                },
                hoy: HOY,
                log: (l) => lineas.push(l),
            },
        );

        expect(resumen.codigo).toBe(0);
        expect(resumen.creadas).toBe(1);
        expect(resumen.tareas?.creadas).toBe(1);
        expect(orden.indexOf('tareas')).toBeGreaterThan(orden.lastIndexOf('features'));

        const [paginaFeature] = [...features.paginas.values()];
        const [paginaTarea] = [...tareas.paginas.values()];
        expect(paginaFeature.properties.Feature).toEqual({ title: [{ type: 'text', text: { content: 'Feature X' } }] });
        expect(paginaTarea.properties.Tarea).toEqual({ title: [{ type: 'text', text: { content: 'Tarea X' } }] });
        expect(paginaTarea.properties).not.toHaveProperty('Feature');
        expect(paginaTarea.properties.Documento).toEqual({
            url: 'https://github.com/owner/repo/blob/main/odd/tareas/tarea-x.md',
        });

        const inicioTareas = lineas.indexOf('Tareas:');
        expect(lineas.slice(inicioTareas + 1)).toEqual([
            'Creadas: 1',
            'Actualizadas: 0',
            'Cuerpos reescritos: 0',
            'Huérfanas: 0',
            'Errores de formato: 0',
        ]);
    });

    test('un esquema de Tareas inválido vuelve el código 1 sin afectar lo ya escrito en Features', async () => {
        const features = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
        // Una base de Tareas con columnas de Features (título "Feature").
        const tareas = crearNotionFalsoTareas(ESQUEMA_CORRECTO_NOTION);
        const { fetchFalso } = combinarNotionFalsos(features, tareas);

        const resumen = await sincronizar(
            { dryRun: false },
            {
                raizRepo: '/repo',
                ejecutar: ejecutar(),
                fetchInyectado: fetchFalso,
                listarDocumentos: documentosFeatures,
                listarDocumentosTareas: documentosTareas(),
                credenciales: { token: 'tok', databaseId: features.databaseId, databaseIdTareas: tareas.databaseId },
                hoy: HOY,
            },
        );

        expect(resumen.creadas).toBe(1);
        expect(features.paginas.size).toBe(1);
        expect(tareas.paginas.size).toBe(0);
        expect(resumen.tareas?.codigo).toBe(1);
        expect(resumen.codigo).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Ajustes explícitos (seguimiento del review de PR 1b)
// ---------------------------------------------------------------------------

describe('sincronizar — ajustes explícitos distintos de los por defecto', () => {
    test('las carpetas y la rama base recibidas guían la lectura, el fechado en git y el enlace "Documento"', async () => {
        const ajustes = { carpetaFeatures: 'docs/features', carpetaTareas: 'docs/tareas', ramaBaseDocumento: 'develop' };
        const features = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
        const tareas = crearNotionFalsoTareas();
        const { fetchFalso } = combinarNotionFalsos(features, tareas);
        const rutasFechadas: string[] = [];
        const base = ejecutar();
        const ejecutarEspiado: EjecutarComando = (comando, args) => {
            if (comando === 'git' && args[0] === 'log') rutasFechadas.push(args[args.length - 1]);
            return base(comando, args);
        };
        const carpetasLeidas: string[] = [];

        const resumen = await sincronizar(
            { dryRun: false },
            {
                raizRepo: '/repo',
                ejecutar: ejecutarEspiado,
                fetchInyectado: fetchFalso,
                listarDocumentos: (carpeta) => {
                    carpetasLeidas.push(carpeta);
                    return documentosFeatures();
                },
                listarDocumentosTareas: (carpeta) => {
                    carpetasLeidas.push(carpeta);
                    return documentosTareas()();
                },
                credenciales: { token: 'tok', databaseId: features.databaseId, databaseIdTareas: tareas.databaseId },
                hoy: HOY,
                ajustes,
            },
        );

        expect(resumen.codigo).toBe(0);
        expect(carpetasLeidas).toEqual(['docs/features', 'docs/tareas']);
        expect(rutasFechadas).toEqual(['docs/features/feature-x.md', 'docs/tareas/tarea-x.md']);
        expect([...features.paginas.values()][0].properties.Documento).toEqual({
            url: 'https://github.com/owner/repo/blob/develop/docs/features/feature-x.md',
        });
        expect([...tareas.paginas.values()][0].properties.Documento).toEqual({
            url: 'https://github.com/owner/repo/blob/develop/docs/tareas/tarea-x.md',
        });
    });

    test('"sincronizarEntidad" pide a listarDocumentos exactamente la carpeta del descriptor', async () => {
        const listarDocumentos = jest.fn(() => documentosFeatures());

        await app.sincronizarEntidad(
            crearDescriptorFeature({ ...AJUSTES, carpetaFeatures: 'otra/carpeta' }),
            { dryRun: true },
            puertosFalsos(listarDocumentos),
        );

        expect(listarDocumentos.mock.calls).toEqual([['otra/carpeta']]);
    });
});
