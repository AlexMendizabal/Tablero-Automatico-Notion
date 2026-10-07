/**
 * @jest-environment node
 *
 * Tests de la recolección de contribuyentes por documento en la
 * orquestación: commits de las ramas del documento que no están en la rama
 * base, autores de sus anclas de "commits" y autores de sus PRs, más el aviso
 * cuando la rama base no existe.
 */
import type { AjustesProyecto } from '../../src/core/ajustes';
import { crearDescriptorFeature, type DescriptorFeature } from '../../src/core/entities/feature';
import type { FilaTablero } from '../../src/core/types';
import type { EjecutarComando } from '../../src/ports/sincronizar';
import { autorCommit, crearEjecutarFalso, docBase } from '../helpers/fixtures';
import { sincronizarEntidad } from '../helpers/sincronizar-compuesto';

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
    const registrado: EjecutarComando = (comando, args) => {
        if (comando === 'git') llamadas.push(args);
        return ejecutar(comando, args);
    };
    return { ejecutar: registrado, llamadas };
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
    const { ejecutar, llamadas } = conRegistro(
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
    return { resumen, filas, llamadas, lineas };
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
