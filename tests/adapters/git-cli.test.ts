/**
 * Tests del adaptador de git para los contribuyentes y las versiones de los
 * documentos en las ramas: el formato que se le pide a git, su lectura
 * defensiva y la resolución de la rama base. Nunca se
 * corre git real: el comando es un falso que registra lo que recibe.
 */
import {
    FORMATO_AUTORES,
    obtenerAutoresDeCommit,
    obtenerAutoresDeRango,
    obtenerRefRamaBase,
    obtenerVersionesEnRamas,
    parsearAutoresGit,
} from '../../src/adapters/git-cli';
import type { EjecutarComando } from '../../src/ports/sincronizar';

const US = '\x1f';
const RS = '\x1e';
const GS = '\x1d';

/** Un `ejecutar` que registra cada llamada y responde con `responder`. */
function registrador(responder: (args: string[]) => string) {
    const llamadas: string[][] = [];
    const ejecutar: EjecutarComando = (comando, args) => {
        llamadas.push([comando, ...args]);
        return responder(args);
    };
    return { ejecutar, llamadas };
}

describe('parsearAutoresGit', () => {
    test('lee nombre, email y coautores de cada registro (como los imprime git log)', () => {
        const salida =
            `Ana Pérez${US}ana@x.com${US}Bruno <b@x.com>${GS}Carla Díaz <9+carla@users.noreply.github.com>${RS}\n` +
            `Zoe${US}zoe@x.com${US}${RS}\n`;
        expect(parsearAutoresGit(salida)).toEqual([
            {
                nombre: 'Ana Pérez',
                email: 'ana@x.com',
                coautores: [
                    { nombre: 'Bruno', email: 'b@x.com' },
                    { nombre: 'Carla Díaz', email: '9+carla@users.noreply.github.com' },
                ],
            },
            { nombre: 'Zoe', email: 'zoe@x.com', coautores: [] },
        ]);
    });

    test('es defensivo: salida vacía, CRLF, registros sin campos y trailers sin email', () => {
        expect(parsearAutoresGit('')).toEqual([]);
        expect(parsearAutoresGit('\r\n')).toEqual([]);
        const salida = `\r\nAna${US}a@x.com${US}Solo Nombre${GS} ${GS}<sin@nombre.com>${RS}\r\nbasura sin separadores${RS}`;
        expect(parsearAutoresGit(salida)).toEqual([
            {
                nombre: 'Ana',
                email: 'a@x.com',
                coautores: [
                    { nombre: 'Solo Nombre', email: '' },
                    { nombre: '', email: 'sin@nombre.com' },
                ],
            },
        ]);
    });
});

describe('obtenerRefRamaBase', () => {
    test('prefiere origin/<base> si existe', () => {
        const { ejecutar, llamadas } = registrador(() => 'abc\n');
        expect(obtenerRefRamaBase(ejecutar, 'main')).toBe('refs/remotes/origin/main');
        expect(llamadas).toEqual([['git', 'rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main']]);
    });

    test('si no, la rama local; si tampoco, null', () => {
        const soloLocal = registrador((args) => {
            if (args.includes('refs/heads/main')) return 'abc\n';
            throw new Error('exit 1');
        });
        expect(obtenerRefRamaBase(soloLocal.ejecutar, 'main')).toBe('refs/heads/main');
        const ninguna = registrador(() => {
            throw new Error('exit 1');
        });
        expect(obtenerRefRamaBase(ninguna.ejecutar, 'main')).toBeNull();
    });
});

describe('obtenerAutoresDeRango', () => {
    test('pide los commits de la rama local y de origin que no están en la base', () => {
        const { ejecutar, llamadas } = registrador(() => `Ana${US}a@x.com${US}${RS}\n`);
        expect(obtenerAutoresDeRango(ejecutar, 'refs/remotes/origin/main', 'feat/x')).toEqual([
            { nombre: 'Ana', email: 'a@x.com', coautores: [] },
        ]);
        expect(llamadas).toEqual([
            [
                'git',
                'log',
                '--ignore-missing',
                `--format=${FORMATO_AUTORES}`,
                'refs/heads/feat/x',
                'refs/remotes/origin/feat/x',
                '--not',
                'refs/remotes/origin/main',
                '--',
            ],
        ]);
    });

    test('si git falla, null (no se sabe), distinto de "sin autores"', () => {
        const { ejecutar } = registrador(() => {
            throw new Error('fatal');
        });
        expect(obtenerAutoresDeRango(ejecutar, 'refs/heads/main', 'feat/x')).toBeNull();
        expect(obtenerAutoresDeRango(() => '', 'refs/heads/main', 'feat/x')).toEqual([]);
    });
});

describe('obtenerAutoresDeCommit', () => {
    test('pide el autor y los coautores de un commit por hash', () => {
        const { ejecutar, llamadas } = registrador(() => `Ana${US}a@x.com${US}Bruno <b@x.com>${RS}\n`);
        expect(obtenerAutoresDeCommit(ejecutar, 'a'.repeat(40))).toEqual([
            { nombre: 'Ana', email: 'a@x.com', coautores: [{ nombre: 'Bruno', email: 'b@x.com' }] },
        ]);
        expect(llamadas).toEqual([['git', 'show', '-s', `--format=${FORMATO_AUTORES}`, 'a'.repeat(40)]]);
    });

    test('si git falla, null (no se sabe)', () => {
        const { ejecutar } = registrador(() => {
            throw new Error('fatal');
        });
        expect(obtenerAutoresDeCommit(ejecutar, 'a'.repeat(40))).toBeNull();
    });
});

test('el formato separa campos con 0x1f, coautores con 0x1d y registros con 0x1e', () => {
    expect(FORMATO_AUTORES).toBe('%aN%x1f%aE%x1f%(trailers:key=Co-authored-by,valueonly,separator=%x1d)%x1e');
});

describe('obtenerVersionesEnRamas', () => {
    const NUL = '\0';
    /** Salida de `git ls-tree -z`: `<modo> <tipo> <objeto>\t<ruta>`, separadas por NUL. */
    const lsTree = (entradas: Array<[tipo: string, objeto: string, ruta: string]>) =>
        entradas.map(([tipo, objeto, ruta]) => `100644 ${tipo} ${objeto}\t${ruta}${NUL}`).join('');

    function repositorioFalso() {
        return registrador((args) => {
            if (args[0] === 'for-each-ref') {
                return 'refs/heads/feat/a\nrefs/remotes/origin/HEAD\nrefs/remotes/origin/feat/b\n';
            }
            if (args[0] === 'ls-tree' && args[2] === 'HEAD') {
                return lsTree([
                    ['blob', 'b-igual', 'odd/tasks/igual.md'],
                    ['blob', 'b-viejo', 'odd/tasks/cambia.md'],
                ]);
            }
            if (args[0] === 'ls-tree' && args[2] === 'refs/heads/feat/a') {
                return lsTree([
                    ['blob', 'b-igual', 'odd/tasks/igual.md'],
                    ['blob', 'b-nuevo', 'odd/tasks/cambia.md'],
                    ['blob', 'b-notas', 'odd/tasks/notas.txt'],
                    ['tree', 't-sub', 'odd/tasks/sub'],
                ]);
            }
            if (args[0] === 'ls-tree' && args[2] === 'refs/remotes/origin/feat/b') {
                return lsTree([['blob', 'b-solo', 'odd/tasks/Solo-En-Rama.MD']]);
            }
            if (args[0] === 'log') return `2026-10-0${args[3] === 'refs/heads/feat/a' ? 1 : 2}T10:00:00Z\n`;
            if (args[0] === 'cat-file') return `contenido de ${args[2]}\n`;
            throw new Error(`no simulado: git ${args.join(' ')}`);
        });
    }

    test('devuelve las versiones de cada rama que difieren del checkout, con su fecha y la rama sin "origin/"', () => {
        const { ejecutar } = repositorioFalso();
        expect(obtenerVersionesEnRamas(ejecutar, 'odd/tasks')).toEqual([
            { rama: 'feat/a', slug: 'cambia', contenido: 'contenido de b-nuevo\n', fecha: '2026-10-01T10:00:00Z' },
            { rama: 'feat/b', slug: 'Solo-En-Rama', contenido: 'contenido de b-solo\n', fecha: '2026-10-02T10:00:00Z' },
        ]);
    });

    test('no lee los blobs idénticos al checkout, ni lo que no es un ".md", ni origin/HEAD', () => {
        const { ejecutar, llamadas } = repositorioFalso();
        obtenerVersionesEnRamas(ejecutar, 'odd/tasks');
        expect(llamadas.filter((l) => l[1] === 'cat-file').map((l) => l[3])).toEqual(['b-nuevo', 'b-solo']);
        expect(llamadas.some((l) => l.includes('refs/remotes/origin/HEAD') && l[1] !== 'for-each-ref')).toBe(false);
        expect(llamadas).toContainEqual(['git', 'ls-tree', '-z', 'refs/heads/feat/a', '--', 'odd/tasks/']);
        expect(llamadas).toContainEqual(['git', 'log', '-1', '--format=%cI', 'refs/heads/feat/a', '--', 'odd/tasks/cambia.md']);
    });

    test('una versión sin fecha de commit (git log vacío) se saltea sin leer su contenido', () => {
        const { ejecutar, llamadas } = registrador((args) => {
            if (args[0] === 'for-each-ref') return 'refs/heads/feat/a\n';
            if (args[0] === 'ls-tree' && args[2] === 'HEAD') return '';
            if (args[0] === 'ls-tree') return lsTree([['blob', 'b-x', 'odd/tasks/x.md']]);
            if (args[0] === 'log') return '\n';
            throw new Error(`no simulado: git ${args.join(' ')}`);
        });
        expect(obtenerVersionesEnRamas(ejecutar, 'odd/tasks')).toEqual([]);
        expect(llamadas.some((l) => l[1] === 'cat-file')).toBe(false);
    });

    test('sin ramas no consulta nada más', () => {
        const { ejecutar, llamadas } = registrador(() => '');
        expect(obtenerVersionesEnRamas(ejecutar, 'odd/tasks')).toEqual([]);
        expect(llamadas).toHaveLength(1);
    });

    test('si git falla, lanza: el llamador avisa y usa solo el checkout', () => {
        const { ejecutar } = registrador(() => {
            throw new Error('fatal: not a git repository');
        });
        expect(() => obtenerVersionesEnRamas(ejecutar, 'odd/tasks')).toThrow('not a git repository');
    });
});
