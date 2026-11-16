/**
 * @jest-environment node
 *
 * Tests del punto de entrada de la CLI: la detección de ejecución directa y
 * el texto de "--ayuda". Importar el módulo NO debe ejecutar `principal()`
 * (Jest corre con su propio `process.argv[1]`).
 */
import dotenv from 'dotenv';

import { AYUDA, componerDependencias, ejecutarCLI, esInvocacionDirecta } from '../../src/entrypoints/cli';
import type { FetchInyectado } from '../../src/ports/notion';
import type { EjecutarComando } from '../../src/ports/sincronizar';
import { autorCommit, crearEjecutarFalso, docBase } from '../helpers/fixtures';

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

    test('describe --validar', () => {
        expect(AYUDA).toContain('tablero-notion [--dry-run | --validar] [--ayuda]');
        expect(AYUDA).toContain(
            '  --validar   Solo lee y parsea los documentos (odd/tasks y odd/tareas):\n' +
                '              sin .env, sin Notion y sin git/gh. Sale con 1 si hay errores\n' +
                '              de formato o las carpetas no son válidas. No detecta commits\n' +
                '              inexistentes en "commits" (eso lo hace --dry-run). No se\n' +
                '              combina con --dry-run.',
        );
    });
});

describe('ejecutarCLI', () => {
    const AJUSTES = { carpetaFeatures: 'odd/tasks', carpetaTareas: 'odd/tareas', ramaBaseDocumento: 'main' };

    function entorno(extra: { listarDocumentos?: (carpeta: string, opciones?: { opcional?: boolean }) => Array<{ slug: string; contenido: string }>; ejecutar?: EjecutarComando } = {}) {
        const salida: string[] = [];
        const errores: string[] = [];
        const ejecutar = jest.fn(extra.ejecutar ?? (() => {
            throw new Error('no se debía ejecutar ningún comando');
        }));
        const fetchInyectado = jest.fn() as unknown as FetchInyectado;
        const listarDocumentos = jest.fn(
            extra.listarDocumentos ?? ((carpeta: string, opciones?: { opcional?: boolean }) => {
                if (carpeta === 'odd/tasks') return [{ slug: 'feature-x', contenido: docBase() }];
                if (opciones?.opcional) return [];
                throw new Error(`No se encontró "${carpeta}" en "/repo".`);
            }),
        );
        return {
            salida,
            errores,
            ejecutar,
            fetchInyectado,
            listarDocumentos,
            entorno: {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado,
                listarDocumentos,
                ajustes: AJUSTES,
                credenciales: null,
                idioma: 'es' as const,
                hoy: new Date('2026-09-21T00:00:00Z'),
                log: (l: string) => salida.push(l),
                logError: (l: string) => errores.push(l),
            },
        };
    }

    let configDotenv: jest.SpyInstance;
    beforeEach(() => {
        configDotenv = jest.spyOn(dotenv, 'config');
    });
    afterEach(() => configDotenv.mockRestore());

    test('--validar con documentos válidos: código 0 y resumen, sin .env, git/gh ni Notion', async () => {
        const e = entorno();

        const codigo = await ejecutarCLI(['--validar'], e.entorno);

        expect(codigo).toBe(0);
        expect(e.salida).toEqual([
            '--validar: solo se leyeron y parsearon los documentos (sin .env, sin Notion, sin git/gh).',
            'Errores de formato: 0',
        ]);
        expect(e.errores).toEqual([]);
        expect(e.ejecutar).not.toHaveBeenCalled();
        expect(e.fetchInyectado).not.toHaveBeenCalled();
        expect(configDotenv).not.toHaveBeenCalled();
    });

    test('--validar con un documento mal formado: código 1 y su error', async () => {
        const e = entorno({ listarDocumentos: (carpeta) => (carpeta === 'odd/tasks' ? [{ slug: 'rota', contenido: '# sin frontmatter' }] : []) });

        const codigo = await ejecutarCLI(['--validar'], e.entorno);

        expect(codigo).toBe(1);
        expect(e.salida).toEqual(expect.arrayContaining(['Errores de formato: 1', '  rota:']));
        expect(e.ejecutar).not.toHaveBeenCalled();
        expect(e.fetchInyectado).not.toHaveBeenCalled();
        expect(configDotenv).not.toHaveBeenCalled();
    });

    test('--validar sin la carpeta de Features: código 1', async () => {
        const e = entorno({
            listarDocumentos: (carpeta, opciones) => {
                if (opciones?.opcional) return [];
                throw new Error(`No se encontró "${carpeta}" en "/repo".`);
            },
        });

        const codigo = await ejecutarCLI(['--validar'], e.entorno);

        expect(codigo).toBe(1);
        expect(e.salida).toContain('Error de entorno: No se encontró "odd/tasks" en "/repo".');
        expect(e.ejecutar).not.toHaveBeenCalled();
        expect(configDotenv).not.toHaveBeenCalled();
    });

    test('--validar junto con --dry-run: error, código 1, no se lee nada', async () => {
        const e = entorno();

        const codigo = await ejecutarCLI(['--validar', '--dry-run'], e.entorno);

        expect(codigo).toBe(1);
        expect(e.salida).toEqual([]);
        expect(e.errores).toEqual([
            '--validar y --dry-run no se pueden usar juntos: --validar solo lee y parsea los documentos; --dry-run además consulta git/gh (y Notion, con credenciales).',
            'Usá --ayuda para ver las opciones disponibles.',
        ]);
        expect(e.listarDocumentos).not.toHaveBeenCalled();
        expect(e.ejecutar).not.toHaveBeenCalled();
        expect(configDotenv).not.toHaveBeenCalled();
    });

    test.each([['--ayuda'], ['-h'], ['--validar', '--ayuda'], ['--desconocida', '-h']])(
        '%s muestra la ayuda y sale con 0 (como antes)',
        async (...argumentos) => {
            const e = entorno();

            const codigo = await ejecutarCLI(argumentos, e.entorno);

            expect(codigo).toBe(0);
            expect(e.salida).toEqual([AYUDA]);
            expect(e.errores).toEqual([]);
            expect(e.listarDocumentos).not.toHaveBeenCalled();
        },
    );

    test('una opción desconocida sale con 1 y el mismo mensaje de antes', async () => {
        const e = entorno();

        const codigo = await ejecutarCLI(['--dry-run', '--x', 'y'], e.entorno);

        expect(codigo).toBe(1);
        expect(e.salida).toEqual([]);
        expect(e.errores).toEqual(['Opción desconocida: --x, y', 'Usá --ayuda para ver las opciones disponibles.']);
        expect(e.listarDocumentos).not.toHaveBeenCalled();
    });

    test('--dry-run sigue corriendo el sync (consulta git/gh, sin escribir en Notion)', async () => {
        const e = entorno({ ejecutar: crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' }) });

        const codigo = await ejecutarCLI(['--dry-run'], e.entorno);

        expect(codigo).toBe(0);
        expect(e.salida).toContain('--dry-run sin credenciales: NO se consultó Notion. Filas calculadas desde el repositorio:');
        expect(e.salida).toContain('Errores de formato: 0');
        expect(e.ejecutar).toHaveBeenCalled();
        expect(e.fetchInyectado).not.toHaveBeenCalled();
    });

    test('un error inesperado del sync se informa con "Error:" y código 1 (como antes)', async () => {
        // El "ejecutar" por defecto lanza: "git for-each-ref" falla y el
        // sync rechaza su promesa.
        const e = entorno();

        const codigo = await ejecutarCLI(['--dry-run'], e.entorno);

        expect(codigo).toBe(1);
        expect(e.errores).toEqual(['Error: no se debía ejecutar ningún comando']);
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

    test('el repositorio lee con git las versiones de los documentos en las ramas', () => {
        const { repositorio } = componer(
            crearEjecutarFalso({
                documentosPorRama: {
                    HEAD: { 'odd/tasks/x.md': { contenido: 'igual', fecha: '2026-09-01T00:00:00Z' } },
                    'origin/feat/x': {
                        'odd/tasks/x.md': { contenido: 'igual', fecha: '2026-09-01T00:00:00Z' },
                        'odd/tasks/y.md': { contenido: 'nuevo', fecha: '2026-09-05T00:00:00Z' },
                    },
                },
            }),
        );

        expect(repositorio.versionesEnRamas('odd/tasks')).toEqual([
            { rama: 'feat/x', slug: 'y', contenido: 'nuevo', fecha: '2026-09-05T00:00:00Z' },
        ]);
    });

    test('sin rama base (ni origin/ ni local), refRamaBase da null', () => {
        expect(componer(crearEjecutarFalso({ ramaBase: null })).repositorio.refRamaBase('main')).toBeNull();
        expect(componer(crearEjecutarFalso({ ramaBase: 'local' })).repositorio.refRamaBase('main')).toBe('refs/heads/main');
    });
});
