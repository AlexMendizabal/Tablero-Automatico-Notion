/**
 * Tests del adaptador de gh: los campos que se piden a `gh pr list` (en una
 * sola llamada) y el autor de cada PR (login), sin bots.
 */
import { obtenerPRs } from '../../src/adapters/gh-cli';
import type { EjecutarComando } from '../../src/ports/sincronizar';

describe('obtenerPRs', () => {
    const pr = (author: unknown) => ({
        number: 1,
        headRefName: 'feat/x',
        state: 'OPEN',
        createdAt: '2026-09-01T00:00:00Z',
        mergedAt: null,
        closedAt: null,
        author,
    });

    test('pide el autor junto con el resto de los campos, en una sola llamada', () => {
        const llamadas: string[][] = [];
        const ejecutar: EjecutarComando = (comando, args) => {
            llamadas.push([comando, ...args]);
            return '[]';
        };
        obtenerPRs(ejecutar);
        expect(llamadas).toEqual([
            [
                'gh',
                'pr',
                'list',
                '--state',
                'all',
                '--limit',
                '1000',
                '--json',
                'number,headRefName,state,createdAt,mergedAt,closedAt,author',
            ],
        ]);
    });

    test('el login del autor viaja como "autor"; un bot, un autor ausente o sin login, no', () => {
        const salida = JSON.stringify([
            pr({ login: 'octocat', is_bot: false }),
            pr({ login: 'app/dependabot', is_bot: true }),
            pr(null),
            pr({}),
        ]);
        const prs = obtenerPRs(() => salida);
        expect(prs.map((p) => p.autor)).toEqual(['octocat', undefined, undefined, undefined]);
        expect(prs.filter((p) => 'autor' in p)).toHaveLength(1);
    });
});
