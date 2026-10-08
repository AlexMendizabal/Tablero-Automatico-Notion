/**
 * @jest-environment node
 *
 * Tests del punto de entrada de la CLI: la detección de ejecución directa y
 * el texto de "--ayuda". Importar el módulo NO debe ejecutar `principal()`
 * (Jest corre con su propio `process.argv[1]`).
 */
import { AYUDA, componerDependencias, esInvocacionDirecta } from '../../src/entrypoints/cli';
import type { FetchInyectado } from '../../src/ports/notion';
import type { EjecutarComando } from '../../src/ports/sincronizar';
import { autorCommit, crearEjecutarFalso } from '../helpers/fixtures';

describe('esInvocacionDirecta', () => {
    test.each([
        'src/entrypoints/cli.ts',
        '/home/alguien/repo/src/entrypoints/cli.ts',
        'C:\\Proyectos\\tablero\\src\\entrypoints\\cli.ts',
        'dist/entrypoints/cli.js',
        '/repo/dist/entrypoints/cli.mjs',
        '/repo/dist/entrypoints/cli.cjs',
    ])('reconoce "%s"', (ruta) => {
        expect(esInvocacionDirecta(ruta)).toBe(true);
    });

    test.each([
        '/repo/node_modules/jest-worker/build/workers/processChild.js',
        '/repo/node_modules/.bin/jest',
        'src/app/sincronizar.ts',
        'src/entrypoints/cli.test.ts',
        'src/entrypoints/otra-cli.ts',
        '',
        undefined,
    ])('NO reconoce "%s"', (ruta) => {
        expect(esInvocacionDirecta(ruta)).toBe(false);
    });

    describe('instalada como paquete (bin "tablero-notion")', () => {
        const ARCHIVO = '/proyecto/node_modules/tablero-automatico-notion/dist/entrypoints/cli.js';
        /** `realpath` falso: el enlace de `.bin` (o el de npx) apunta al CLI compilado. */
        const resolverRuta = (ruta: string) => {
            const enlaces: Record<string, string> = {
                '/proyecto/node_modules/.bin/tablero-notion': ARCHIVO,
                '/home/u/.npm/_npx/abc/node_modules/.bin/tablero-notion': ARCHIVO,
            };
            if (ruta in enlaces) return enlaces[ruta];
            if (ruta === ARCHIVO || ruta.startsWith('/repo/')) return ruta;
            throw new Error(`ENOENT: ${ruta}`);
        };

        test.each([
            '/proyecto/node_modules/.bin/tablero-notion',
            '/home/u/.npm/_npx/abc/node_modules/.bin/tablero-notion',
        ])('reconoce el enlace "%s" que resuelve a este archivo', (ruta) => {
            expect(esInvocacionDirecta(ruta, { archivoActual: ARCHIVO, resolverRuta })).toBe(true);
        });

        test('sigue reconociendo la ruta directa al CLI compilado', () => {
            expect(esInvocacionDirecta(ARCHIVO, { archivoActual: ARCHIVO, resolverRuta })).toBe(true);
        });

        test.each([
            '/repo/node_modules/.bin/jest',
            '/no/existe/tablero-notion',
            '',
            undefined,
        ])('NO reconoce "%s" (otro archivo o ruta irresoluble)', (ruta) => {
            expect(esInvocacionDirecta(ruta, { archivoActual: ARCHIVO, resolverRuta })).toBe(false);
        });

        test('sin resolvedor inyectado usa el realpath real: el worker de Jest no es este archivo', () => {
            expect(esInvocacionDirecta(process.argv[1], { archivoActual: __filename })).toBe(false);
        });
    });
});

describe('AYUDA', () => {
    test('muestra el comando real de la CLI, no el script monolítico viejo', () => {
        expect(AYUDA).toContain('npm run sync');
        expect(AYUDA).toContain('npx tsx src/entrypoints/cli.ts');
        expect(AYUDA).not.toContain('sync-tablero-features');
    });
});

describe('componerDependencias — contribuyentes', () => {
    const componer = (ejecutar: EjecutarComando) =>
        componerDependencias({
            raizRepo: '/repo',
            ejecutar,
            fetchInyectado: jest.fn() as unknown as FetchInyectado,
            listarDocumentos: () => [],
        });

    test('el repositorio resuelve la rama base y los autores con git y el PR con gh', () => {
        const { repositorio } = componer(
            crearEjecutarFalso({
                autoresPorRama: { 'feat/x': [autorCommit('Ana', 'a@x.com', [autorCommit('Bruno', 'b@x.com')])] },
                autoresPorCommit: { abc: [autorCommit('Zoe', 'z@x.com')] },
                prs: JSON.stringify([
                    { number: 1, headRefName: 'feat/x', state: 'OPEN', createdAt: '2026-09-01T00:00:00Z', mergedAt: null, closedAt: null, author: { login: 'octocat' } },
                ]),
            }),
        );

        expect(repositorio.refRamaBase('main')).toBe('refs/remotes/origin/main');
        expect(repositorio.autoresDeRango('refs/remotes/origin/main', 'feat/x')).toEqual([
            { nombre: 'Ana', email: 'a@x.com', coautores: [{ nombre: 'Bruno', email: 'b@x.com' }] },
        ]);
        expect(repositorio.autoresDeRango('refs/remotes/origin/main', 'feat/otra')).toEqual([]);
        expect(repositorio.autoresDeCommit('abc')).toEqual([{ nombre: 'Zoe', email: 'z@x.com', coautores: [] }]);
        expect(repositorio.prs().map((pr) => pr.autor)).toEqual(['octocat']);
    });

    test('sin rama base (ni origin/ ni local), refRamaBase da null', () => {
        expect(componer(crearEjecutarFalso({ ramaBase: null })).repositorio.refRamaBase('main')).toBeNull();
        expect(componer(crearEjecutarFalso({ ramaBase: 'local' })).repositorio.refRamaBase('main')).toBe('refs/heads/main');
    });
});
