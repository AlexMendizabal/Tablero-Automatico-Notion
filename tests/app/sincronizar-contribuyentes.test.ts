/**
 * @jest-environment node
 *
 * Tests de la recolección de contribuyentes por documento en la
 * orquestación: commits de las ramas del documento que no están en la rama
 * base, autores de sus anclas de "commits" y autores de sus PRs, más el aviso
 * cuando la rama base no existe.
 */
import { FORMATO_AUTORES } from '../../src/adapters/git-cli';
import type { AjustesProyecto } from '../../src/core/ajustes';
import { crearDescriptorFeature, type DescriptorFeature } from '../../src/core/entities/feature';
import type { FilaTablero } from '../../src/core/types';
import type { EjecutarComando } from '../../src/ports/sincronizar';
import type { PropiedadEsquemaNotion } from '../../src/core/types';
import {
    autorCommit,
    combinarNotionFalsos,
    crearEjecutarFalso,
    crearNotionFalsoCompleto,
    crearNotionFalsoTareas,
    docBase,
    ESQUEMA_CORRECTO_NOTION,
    ESQUEMA_CORRECTO_NOTION_EN,
    ESQUEMA_CORRECTO_NOTION_TAREAS,
    ESQUEMA_CORRECTO_NOTION_TAREAS_EN,
    propiedadesMinimas,
} from '../helpers/fixtures';
import { sincronizar, sincronizarEntidad } from '../helpers/sincronizar-compuesto';

import '../helpers/aislar-board-language';

const HOY = new Date('2026-09-21T00:00:00Z');
const SHA = 'c'.repeat(40);

/** Descriptor de Features que además guarda cada fila que arma. */
function descriptorEspia(ajustes: AjustesProyecto) {
    const filas: FilaTablero[] = [];
    const base = crearDescriptorFeature(ajustes);
    const descriptor: DescriptorFeature = {
        ...base,
        construirFila: (parametros) => {
            const fila = base.construirFila(parametros);
            filas.push(fila);
            return fila;
        },
    };
    return { descriptor, filas };
}

/** `ejecutar` falso que además registra cada llamada a git. */
function conRegistro(ejecutar: EjecutarComando) {
    const llamadas: string[][] = [];
    const llamadasGh: string[][] = [];
    const registrado: EjecutarComando = (comando, args) => {
        if (comando === 'git') llamadas.push(args);
        if (comando === 'gh') llamadasGh.push(args);
        return ejecutar(comando, args);
    };
    return { ejecutar: registrado, llamadas, llamadasGh };
}

const RAMAS = ['feat/x-1\t2026-09-01T00:00:00Z', 'feat/x-2\t2026-09-02T00:00:00Z', 'feat/otra\t2026-09-03T00:00:00Z'].join('\n');
const PRS = JSON.stringify([
    { number: 1, headRefName: 'feat/x-1', state: 'MERGED', createdAt: '2026-08-01T00:00:00Z', mergedAt: '2026-08-02T00:00:00Z', closedAt: null, author: { login: 'octocat' } },
    { number: 2, headRefName: 'feat/otra', state: 'OPEN', createdAt: '2026-08-01T00:00:00Z', mergedAt: null, closedAt: null, author: { login: 'intrusa' } },
]);
const AUTORES_POR_RAMA = {
    'feat/x-1': [autorCommit('Ana', 'ana@x.com', [autorCommit('Bruno', 'b@x.com')])],
    'feat/x-2': [autorCommit('dependabot[bot]', '49699333+dependabot[bot]@users.noreply.github.com')],
    'feat/otra': [autorCommit('Intrusa', 'i@x.com')],
};

async function correr(
    documentos: Array<{ slug: string; contenido: string }>,
    opciones: Parameters<typeof crearEjecutarFalso>[0] = {},
    ramaBase = 'main',
) {
    const ajustes: AjustesProyecto = { carpetaFeatures: 'odd/tasks', carpetaTareas: 'odd/tareas', ramaBaseDocumento: ramaBase };
    const { descriptor, filas } = descriptorEspia(ajustes);
    const { ejecutar, llamadas, llamadasGh } = conRegistro(
        crearEjecutarFalso({ ramas: RAMAS, prs: PRS, autoresPorRama: AUTORES_POR_RAMA, ...opciones }),
    );
    const lineas: string[] = [];
    const resumen = await sincronizarEntidad(descriptor, { dryRun: true }, {
        raizRepo: '/repo',
        ejecutar,
        fetchInyectado: jest.fn(),
        listarDocumentos: () => documentos,
        credenciales: null,
        hoy: HOY,
        log: (l) => lineas.push(l),
        ajustes,
    });
    return { resumen, filas, llamadas, llamadasGh, lineas };
}

const doc = (ramas: string, commits: string[] = []) =>
    docBase({
        frontmatter: ['---', `ramas: ${ramas}`, ...(commits.length > 0 ? [`commits: ${JSON.stringify(commits)}`] : []), '---'].join('\n'),
    });

describe('sincronizarEntidad — contribuyentes por documento', () => {
    test('autores de sus ramas fuera de la base, de sus anclas y de sus PRs (sin bots ni otras ramas)', async () => {
        const { resumen, filas } = await correr([{ slug: 'x', contenido: doc('["feat/x*"]', [SHA]) }], {
            commits: { [SHA]: '2026-07-01T00:00:00Z' },
            autoresPorCommit: { [SHA]: [autorCommit('Carla', '7+carla@users.noreply.github.com')] },
        });

        expect(resumen.codigo).toBe(0);
        expect(filas.map((f) => f.contribuyentes)).toEqual([['Ana', 'Bruno', 'carla', 'octocat']]);
    });

    test('"--dry-run" sin credenciales los muestra como última columna de la fila', async () => {
        const { lineas } = await correr([
            { slug: 'x', contenido: doc('["feat/x-1"]') },
            { slug: 'y', contenido: doc('["feat/nada"]') },
        ]);

        expect(lineas).toContain('slug | estado | progreso | PRs abiertos | días | actualizado | contribuyentes');
        expect(lineas.find((l) => l.startsWith('x '))).toMatch(/ \| Ana, Bruno, octocat$/);
        expect(lineas.find((l) => l.startsWith('y '))).toMatch(/ \| —$/);
    });

    test('compara contra origin/<rama base> y consulta cada rama una sola vez aunque la compartan varios documentos', async () => {
        const { filas, llamadas } = await correr([
            { slug: 'a', contenido: doc('["feat/x-1"]') },
            { slug: 'b', contenido: doc('["feat/x-1"]') },
        ]);

        expect(filas.map((f) => f.contribuyentes)).toEqual([
            ['Ana', 'Bruno', 'octocat'],
            ['Ana', 'Bruno', 'octocat'],
        ]);
        const logs = llamadas.filter((args) => args[0] === 'log' && args.includes('--ignore-missing'));
        expect(logs).toHaveLength(1);
        expect(logs[0].slice(-4)).toEqual(['refs/remotes/origin/feat/x-1', '--not', 'refs/remotes/origin/main', '--']);
    });

    test('sin origin/<base>, usa la rama base local; la rama base sale de los ajustes', async () => {
        const { filas, llamadas } = await correr([{ slug: 'a', contenido: doc('["feat/x-1"]') }], { ramaBase: 'local' }, 'develop');

        expect(filas[0].contribuyentes).toEqual(['Ana', 'Bruno', 'octocat']);
        const log = llamadas.find((args) => args[0] === 'log' && args.includes('--ignore-missing'));
        expect(log?.slice(-2)).toEqual(['refs/heads/develop', '--']);
    });

    test('sin rama base, se saltean los commits de ramas con UN aviso (no error); anclas y PRs siguen', async () => {
        const { resumen, filas, lineas, llamadas } = await correr(
            [
                { slug: 'a', contenido: doc('["feat/x*"]', [SHA]) },
                { slug: 'b', contenido: doc('["feat/x-1"]') },
            ],
            {
                ramaBase: null,
                commits: { [SHA]: '2026-07-01T00:00:00Z' },
                autoresPorCommit: { [SHA]: [autorCommit('Carla', 'c@x.com')] },
            },
        );

        expect(resumen.codigo).toBe(0);
        expect(filas.map((f) => f.contribuyentes)).toEqual([['Carla', 'octocat'], ['octocat']]);
        const aviso =
            'Aviso: no existe la rama base "main" (ni "origin/main"): los contribuyentes no incluyen los commits de las ramas.';
        expect(lineas.filter((l) => l === aviso)).toHaveLength(1);
        expect(llamadas.some((args) => args[0] === 'log' && args.includes('--ignore-missing'))).toBe(false);
    });

    test('un documento sin ramas vivas que matcheen ni anclas no consulta la rama base', async () => {
        const { filas, llamadas, lineas } = await correr([{ slug: 'a', contenido: doc('["feat/nada"]') }], { ramaBase: null });

        expect(filas[0].contribuyentes).toEqual([]);
        expect(llamadas.some((args) => args[0] === 'rev-parse' && args[1] === '--verify')).toBe(false);
        expect(lineas.some((l) => l.startsWith('Aviso: no existe la rama base'))).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Propiedad opcional "Contribuyentes" en Notion
// ---------------------------------------------------------------------------

/** El esquema sin la columna `nombre`. */
function sin(esquema: Record<string, PropiedadEsquemaNotion>, nombre: string): Record<string, PropiedadEsquemaNotion> {
    const { [nombre]: _quitada, ...resto } = esquema;
    return resto;
}

const IDIOMAS = {
    es: { columna: 'Contribuyentes', features: ESQUEMA_CORRECTO_NOTION, tareas: ESQUEMA_CORRECTO_NOTION_TAREAS },
    en: { columna: 'Contributors', features: ESQUEMA_CORRECTO_NOTION_EN, tareas: ESQUEMA_CORRECTO_NOTION_TAREAS_EN },
} as const;

function escenarioNotion(
    idioma: 'es' | 'en',
    esquemas: { features?: Record<string, PropiedadEsquemaNotion>; tareas?: Record<string, PropiedadEsquemaNotion> } = {},
) {
    const features = crearNotionFalsoCompleto(esquemas.features ?? IDIOMAS[idioma].features);
    const tareas = crearNotionFalsoTareas(esquemas.tareas ?? IDIOMAS[idioma].tareas);
    const { fetchFalso } = combinarNotionFalsos(features, tareas);
    const lineas: string[] = [];
    const entrada = {
        raizRepo: '/repo',
        ejecutar: crearEjecutarFalso({ ramas: RAMAS, prs: PRS, autoresPorRama: AUTORES_POR_RAMA }),
        fetchInyectado: fetchFalso,
        listarDocumentos: () => [{ slug: 'padre', contenido: doc('["feat/x-1"]') }],
        listarDocumentosTareas: () => [{ slug: 'tarea-x', contenido: doc('["feat/nada"]') }],
        credenciales: { token: 'tok', databaseId: features.databaseId, databaseIdTareas: tareas.databaseId },
        hoy: HOY,
        idioma,
        log: (l: string) => lineas.push(l),
    };
    return { features, tareas, entrada, lineas };
}

describe('sincronizar — "Contribuyentes" en Notion', () => {
    test.each(['es', 'en'] as const)('con la columna, se escribe al crear y en cada actualización (idioma: %s)', async (idioma) => {
        const { columna } = IDIOMAS[idioma];
        const { features, tareas, entrada, lineas } = escenarioNotion(idioma);

        const primera = await sincronizar({ dryRun: false }, entrada);
        const altas = features.solicitudes.filter((s) => s.metodo === 'POST' && s.ruta === '/pages');
        // Alguien edita la columna a mano; la corrida siguiente la vuelve a escribir.
        const pagina = [...features.paginas.values()][0];
        pagina.properties[columna] = { multi_select: [{ name: 'otro' }] };
        const segunda = await sincronizar({ dryRun: false }, entrada);

        expect(primera.codigo).toBe(0);
        expect(segunda.codigo).toBe(0);
        expect(segunda.actualizadas).toBe(1);
        expect(JSON.parse(altas[0].cuerpo).properties[columna]).toEqual({
            multi_select: [{ name: 'Ana' }, { name: 'Bruno' }, { name: 'octocat' }],
        });
        expect(pagina.properties[columna]).toEqual({ multi_select: [{ name: 'Ana' }, { name: 'Bruno' }, { name: 'octocat' }] });
        // La tarea no tiene contribuyentes: lista vacía, no ausente.
        expect([...tareas.paginas.values()][0].properties[columna]).toEqual({ multi_select: [] });
        expect(lineas.some((l) => l.includes('no tiene la columna'))).toBe(false);
    });

    test.each(['es', 'en'] as const)(
        'sin la columna en ninguna base: UNA línea informativa por entidad, nunca se escribe y el código no cambia (idioma: %s)',
        async (idioma) => {
            const { columna, features: esquemaFeatures, tareas: esquemaTareas } = IDIOMAS[idioma];
            const { features, tareas, entrada, lineas } = escenarioNotion(idioma, {
                features: sin(esquemaFeatures, columna),
                tareas: sin(esquemaTareas, columna),
            });
            features.paginas.set('page-vieja', { id: 'page-vieja', properties: propiedadesMinimas('padre', 'x'), hijos: [] });

            const resumen = await sincronizar({ dryRun: false }, entrada);

            expect(resumen.codigo).toBe(0);
            expect(resumen.actualizadas).toBe(1);
            expect(resumen.tareas?.creadas).toBe(1);
            expect(lineas.filter((l) => l.includes('no tiene la columna'))).toEqual([
                `La base de Features no tiene la columna "${columna}": se omite.`,
                `La base de Tareas no tiene la columna "${columna}": se omite.`,
            ]);
            for (const solicitud of [...features.solicitudes, ...tareas.solicitudes]) {
                expect(solicitud.cuerpo).not.toContain(columna);
                expect(solicitud.cuerpo).not.toContain('multi_select');
            }
        },
    );

    test('también en "--dry-run" con credenciales se informa la columna ausente', async () => {
        const { entrada, lineas } = escenarioNotion('es', { features: sin(ESQUEMA_CORRECTO_NOTION, 'Contribuyentes') });

        const resumen = await sincronizar({ dryRun: true }, entrada);

        expect(resumen.codigo).toBe(0);
        expect(lineas.filter((l) => l.includes('no tiene la columna'))).toEqual([
            'La base de Features no tiene la columna "Contribuyentes": se omite.',
        ]);
    });

    test('una columna con el tipo incorrecto es un error de esquema (código 1, no se escribe nada)', async () => {
        const { features, entrada, lineas } = escenarioNotion('es', {
            features: { ...ESQUEMA_CORRECTO_NOTION, Contribuyentes: { type: 'rich_text' } },
        });

        const resumen = await sincronizar({ dryRun: false }, entrada);

        expect(resumen.codigo).toBe(1);
        expect(features.llamadas.crearPagina).toBe(0);
        expect(lineas).toContain('La propiedad "Contribuyentes" es de tipo "rich_text", debería ser "multi_select".');
    });
});

// ---------------------------------------------------------------------------
// Commits de PRs mergeados (gh pr view)
// ---------------------------------------------------------------------------

const PRS_VIEJOS = JSON.stringify([
    { number: 3, headRefName: 'feat/viejo-1', state: 'MERGED', createdAt: '2026-08-01T00:00:00Z', mergedAt: '2026-08-02T00:00:00Z', closedAt: null, author: { login: 'ana-gh' } },
    { number: 4, headRefName: 'feat/viejo-2', state: 'OPEN', createdAt: '2026-08-01T00:00:00Z', mergedAt: null, closedAt: null, author: { login: 'eva' } },
    { number: 5, headRefName: 'feat/viejo-3', state: 'CLOSED', createdAt: '2026-08-01T00:00:00Z', mergedAt: null, closedAt: '2026-08-03T00:00:00Z' },
    { number: 6, headRefName: 'feat/otra-cosa', state: 'MERGED', createdAt: '2026-08-01T00:00:00Z', mergedAt: '2026-08-02T00:00:00Z', closedAt: null },
]);
const COMMITS_POR_PR = {
    3: [[{ login: 'ana-gh' }, { name: 'Coautora', email: 'c@x.com' }], [{ name: 'Dana', email: 'd@x.com' }]],
    6: [[{ login: 'intrusa' }]],
};
const vistas = (llamadasGh: string[][]) => llamadasGh.filter((a) => a[0] === 'pr' && a[1] === 'view').map((a) => a[2]);

describe('sincronizarEntidad — commits de PRs mergeados', () => {
    test('suma los autores de los commits de sus PRs mergeados; los abiertos o cerrados sin merge no se consultan', async () => {
        const { filas, llamadasGh } = await correr([{ slug: 'x', contenido: doc('["feat/viejo-*"]') }], {
            ramas: '',
            prs: PRS_VIEJOS,
            commitsPorPR: COMMITS_POR_PR,
        });

        expect(filas[0].contribuyentes).toEqual(['ana-gh', 'Coautora', 'Dana', 'eva']);
        expect(vistas(llamadasGh)).toEqual(['3']);
    });
});

describe('sincronizar — un "gh pr view" por PR en toda la corrida', () => {
    test('Features y Tareas que comparten un PR mergeado lo consultan una sola vez', async () => {
        const { ejecutar, llamadasGh } = conRegistro(
            crearEjecutarFalso({ ramas: '', prs: PRS_VIEJOS, commitsPorPR: COMMITS_POR_PR }),
        );
        const lineas: string[] = [];

        await sincronizar({ dryRun: true }, {
            raizRepo: '/repo',
            ejecutar,
            fetchInyectado: jest.fn(),
            listarDocumentos: () => [
                { slug: 'a', contenido: doc('["feat/viejo-1"]') },
                { slug: 'b', contenido: doc('["feat/viejo-*"]') },
            ],
            listarDocumentosTareas: () => [{ slug: 't', contenido: doc('["feat/viejo-1"]') }],
            credenciales: null,
            hoy: HOY,
            log: (l) => lineas.push(l),
        });

        expect(vistas(llamadasGh)).toEqual(['3']);
        // La tarea (segunda entidad) recibe los autores del PR ya consultado
        // por Features: la última celda de su fila, exacta.
        const filaTarea = lineas.find((l) => l.startsWith('t '));
        expect(filaTarea?.split(' | ').at(-1)).toBe('ana-gh, Coautora, Dana');
    });
});

// ---------------------------------------------------------------------------
// git o gh no se pudieron leer: se conservan los contribuyentes de Notion
// ---------------------------------------------------------------------------

describe('sincronizar — contribuyentes desconocidos (git o gh fallaron)', () => {
    const viejos = { multi_select: [{ name: 'Vieja' }] };
    const pagina = (id: string, slug: string) => ({
        id,
        properties: { ...propiedadesMinimas(slug, 'x'), Contribuyentes: viejos },
        hijos: [],
    });
    const aviso = (slugs: string) =>
        `Aviso: no se pudieron leer los contribuyentes de git o gh para: ${slugs}. Se conservan los de Notion.`;

    async function correrReal(
        documentos: Array<{ slug: string; contenido: string }>,
        opciones: Parameters<typeof crearEjecutarFalso>[0],
    ) {
        const features = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
        const lineas: string[] = [];
        features.paginas.set('page-a', pagina('page-a', 'a'));
        features.paginas.set('page-b', pagina('page-b', 'b'));
        const resumen = await sincronizar({ dryRun: false }, {
            raizRepo: '/repo',
            ejecutar: crearEjecutarFalso({ ramas: RAMAS, prs: PRS, autoresPorRama: AUTORES_POR_RAMA, ...opciones }),
            fetchInyectado: features.fetchFalso,
            listarDocumentos: () => documentos,
            credenciales: { token: 'tok', databaseId: features.databaseId },
            hoy: HOY,
            log: (l) => lineas.push(l),
        });
        const parches = (id: string) =>
            features.solicitudes
                .filter((s) => s.metodo === 'PATCH' && s.ruta === `/pages/${id}`)
                .map((s) => JSON.parse(s.cuerpo).properties as Record<string, unknown>);
        return { resumen, features, lineas, parches };
    }

    test('si "git log" de una rama falla, esa página no recibe Contribuyentes (las demás sí) y se avisa una vez', async () => {
        const { resumen, features, lineas, parches } = await correrReal(
            [
                { slug: 'a', contenido: doc('["feat/x-1"]') },
                { slug: 'b', contenido: doc('["feat/otra"]') },
            ],
            { fallanRamas: ['feat/x-1'] },
        );

        expect(resumen.codigo).toBe(0);
        expect(resumen.actualizadas).toBe(2);
        expect(parches('page-a').length).toBeGreaterThan(0);
        for (const propiedades of parches('page-a')) expect(propiedades).not.toHaveProperty('Contribuyentes');
        expect(parches('page-a').some((p) => 'Estado' in p)).toBe(true);
        expect(features.paginas.get('page-a')?.properties.Contribuyentes).toEqual(viejos);
        expect(features.paginas.get('page-b')?.properties.Contribuyentes).toEqual({ multi_select: [{ name: 'intrusa' }] });
        expect(lineas.filter((l) => l.startsWith('Aviso: no se pudieron leer los contribuyentes'))).toEqual([aviso('a')]);
    });

    test('si "gh pr view" de un PR mergeado falla, lo mismo; una página nueva se crea sin Contribuyentes', async () => {
        const { resumen, features, lineas, parches } = await correrReal(
            [
                { slug: 'a', contenido: doc('["feat/viejo-1"]') },
                { slug: 'nueva', contenido: doc('["feat/viejo-*"]') },
            ],
            { ramas: '', prs: PRS_VIEJOS, commitsPorPR: COMMITS_POR_PR, fallanPRs: [3] },
        );

        expect(resumen.codigo).toBe(0);
        for (const propiedades of parches('page-a')) expect(propiedades).not.toHaveProperty('Contribuyentes');
        expect(features.paginas.get('page-a')?.properties.Contribuyentes).toEqual(viejos);
        const alta = features.solicitudes.find((s) => s.metodo === 'POST' && s.ruta === '/pages');
        expect(alta && JSON.parse(alta.cuerpo).properties).not.toHaveProperty('Contribuyentes');
        expect(lineas.filter((l) => l.startsWith('Aviso: no se pudieron leer los contribuyentes'))).toEqual([
            aviso('a, nueva'),
        ]);
    });

    test('"--dry-run" sin credenciales muestra "?" en vez de una lista', async () => {
        const { lineas } = await correr([{ slug: 'a', contenido: doc('["feat/x-1"]') }], { fallanRamas: ['feat/x-1'] });

        expect(lineas.find((l) => l.startsWith('a '))).toMatch(/ \| \?$/);
        expect(lineas).toContain(aviso('a'));
    });
});

describe('sincronizarEntidad — ancla de "commits" inexistente', () => {
    test('es un error de formato de ese documento: nunca llega a leer autores ni vuelve desconocidos a los demás', async () => {
        const inexistente = 'd'.repeat(40);
        const { resumen, filas, llamadas, lineas } = await correr(
            [
                { slug: 'roto', contenido: doc('["feat/x-1"]', [inexistente]) },
                { slug: 'sano', contenido: doc('["feat/x-1"]', [SHA]) },
            ],
            {
                commits: { [SHA]: '2026-07-01T00:00:00Z' },
                autoresPorCommit: { [SHA]: [autorCommit('Carla', 'c@x.com')] },
            },
        );

        expect(resumen.erroresDeFormato).toEqual([
            { slug: 'roto', errores: [`El commit "${inexistente}" listado en "commits" no existe en el repositorio.`] },
        ]);
        expect(filas.map((f) => [f.slug, f.contribuyentes])).toEqual([['sano', ['Ana', 'Bruno', 'Carla', 'octocat']]]);
        const lecturasDeAutores = llamadas.filter((a) => a[0] === 'show' && a.includes(`--format=${FORMATO_AUTORES}`));
        expect(lecturasDeAutores.map((a) => a[a.length - 1])).toEqual([SHA]);
        expect(lineas.some((l) => l.startsWith('Aviso: no se pudieron leer los contribuyentes'))).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Sin la columna en la base: no se leen las fuentes de contribuyentes
// ---------------------------------------------------------------------------

describe('sincronizar — sin la columna "Contribuyentes" no se leen sus fuentes', () => {
    const PRS_MEZCLADOS = JSON.stringify([...JSON.parse(PRS), ...JSON.parse(PRS_VIEJOS)]);
    const lecturasDeAutoresGit = (llamadas: string[][]) =>
        llamadas.filter(
            (a) =>
                a.includes(`--format=${FORMATO_AUTORES}`) || (a[0] === 'rev-parse' && a[1] === '--verify'),
        );

    function escenario(esquemas: Parameters<typeof escenarioNotion>[1]) {
        const base = escenarioNotion('es', esquemas);
        const registro = conRegistro(
            crearEjecutarFalso({
                ramas: RAMAS,
                prs: PRS_MEZCLADOS,
                autoresPorRama: AUTORES_POR_RAMA,
                commitsPorPR: COMMITS_POR_PR,
                commits: { [SHA]: '2026-07-01T00:00:00Z' },
                autoresPorCommit: { [SHA]: [autorCommit('Carla', 'c@x.com')] },
            }),
        );
        const entrada = {
            ...base.entrada,
            ejecutar: registro.ejecutar,
            listarDocumentos: () => [{ slug: 'padre', contenido: doc('["feat/x-1", "feat/viejo-1"]', [SHA]) }],
            listarDocumentosTareas: () => [{ slug: 'tarea-x', contenido: doc('["feat/viejo-*"]') }],
        };
        return { ...base, ...registro, entrada };
    }

    test('sin la columna en ninguna base: cero "gh pr view", cero lecturas de autores en git y sin aviso', async () => {
        const { entrada, llamadas, llamadasGh, lineas } = escenario({
            features: sin(ESQUEMA_CORRECTO_NOTION, 'Contribuyentes'),
            tareas: sin(ESQUEMA_CORRECTO_NOTION_TAREAS, 'Contribuyentes'),
        });

        const resumen = await sincronizar({ dryRun: false }, entrada);

        expect(resumen.codigo).toBe(0);
        expect(vistas(llamadasGh)).toEqual([]);
        expect(lecturasDeAutoresGit(llamadas)).toEqual([]);
        expect(lineas.some((l) => l.startsWith('Aviso: no se pudieron leer los contribuyentes'))).toBe(false);
    });

    test('sin la columna solo en Features: las Tareas sí las leen', async () => {
        const { entrada, llamadasGh } = escenario({ features: sin(ESQUEMA_CORRECTO_NOTION, 'Contribuyentes') });

        await sincronizar({ dryRun: false }, entrada);

        expect(vistas(llamadasGh)).toEqual(['3']);
    });

    test('con la columna en las dos bases, se leen como siempre', async () => {
        const { entrada, llamadas, llamadasGh } = escenario({});

        const resumen = await sincronizar({ dryRun: false }, entrada);

        expect(resumen.codigo).toBe(0);
        expect(vistas(llamadasGh)).toEqual(['1', '3']);
        expect(lecturasDeAutoresGit(llamadas).length).toBeGreaterThan(0);
    });
});

describe('sincronizar — Tareas que omiten Notion (sin NOTION_TAREAS_DB_ID)', () => {
    test('no leen las fuentes de contribuyentes de sus documentos, pero los validan igual', async () => {
        const { entrada: base, features } = escenarioNotion('es');
        const { ejecutar, llamadas, llamadasGh } = conRegistro(
            crearEjecutarFalso({ ramas: RAMAS, prs: PRS_VIEJOS, autoresPorRama: AUTORES_POR_RAMA, commitsPorPR: COMMITS_POR_PR }),
        );
        const lineas: string[] = [];

        const resumen = await sincronizar({ dryRun: false }, {
            ...base,
            ejecutar,
            log: (l) => lineas.push(l),
            credenciales: { token: 'tok', databaseId: features.databaseId },
            listarDocumentos: () => [{ slug: 'padre', contenido: doc('["feat/nada"]') }],
            listarDocumentosTareas: () => [
                { slug: 'tarea-x', contenido: doc('["feat/viejo-1", "feat/x-1"]') },
                { slug: 'tarea-rota', contenido: '# sin frontmatter' },
            ],
        });

        expect(vistas(llamadasGh)).toEqual([]);
        expect(llamadas.filter((a) => a.includes(`--format=${FORMATO_AUTORES}`))).toEqual([]);
        expect(resumen.tareas?.erroresDeFormato.map((e) => e.slug)).toEqual(['tarea-rota']);
        expect(resumen.codigo).toBe(1);
    });
});
