/**
 * Tests del adaptador de gh: los campos que se piden a `gh pr list` (en una
 * sola llamada) y el autor de cada PR (login), sin bots.
 */
import { obtenerAutoresDePR, obtenerPRs } from '../../src/adapters/gh-cli';
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

describe('obtenerAutoresDePR', () => {
    test('pide los commits del PR y toma el login de cada autor (si no, nombre y email); el resto son coautores', () => {
        const llamadas: string[][] = [];
        const salida = JSON.stringify({
            commits: [
                {
                    authors: [
                        { login: 'octocat', name: 'The Octocat', email: 'o@x.com' },
                        { login: '', name: 'Bruno', email: 'b@x.com' },
                    ],
                },
                { authors: [{ name: 'Sin Cuenta', email: 's@x.com' }] },
                { authors: [] },
                {},
            ],
        });
        const autores = obtenerAutoresDePR((comando, args) => {
            llamadas.push([comando, ...args]);
            return salida;
        }, 12);

        expect(llamadas).toEqual([['gh', 'pr', 'view', '12', '--json', 'commits']]);
        expect(autores).toEqual([
            { nombre: 'octocat', email: '', coautores: [{ nombre: 'Bruno', email: 'b@x.com' }] },
            { nombre: 'Sin Cuenta', email: 's@x.com', coautores: [] },
        ]);
    });
});

test('obtenerAutoresDePR: si gh falla o su salida no es JSON, null (no se sabe)', () => {
    expect(
        obtenerAutoresDePR(() => {
            throw new Error('gh: HTTP 502');
        }, 1),
    ).toBeNull();
    expect(obtenerAutoresDePR(() => 'no es json', 1)).toBeNull();
    expect(obtenerAutoresDePR(() => '{"commits":[]}', 1)).toEqual([]);
});
