/**
 * Tests del adaptador de git para los contribuyentes: el formato que se le
 * pide a git, su lectura defensiva y la resolución de la rama base. Nunca se
 * corre git real: el comando es un falso que registra lo que recibe.
 */
import {
    FORMATO_AUTORES,
    obtenerAutoresDeCommit,
    obtenerAutoresDeRango,
    obtenerRefRamaBase,
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

    test('si git falla, ninguno', () => {
        const { ejecutar } = registrador(() => {
            throw new Error('fatal');
        });
        expect(obtenerAutoresDeRango(ejecutar, 'refs/heads/main', 'feat/x')).toEqual([]);
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

    test('si git falla, ninguno', () => {
        const { ejecutar } = registrador(() => {
            throw new Error('fatal');
        });
        expect(obtenerAutoresDeCommit(ejecutar, 'a'.repeat(40))).toEqual([]);
    });
});

test('el formato separa campos con 0x1f, coautores con 0x1d y registros con 0x1e', () => {
    expect(FORMATO_AUTORES).toBe('%aN%x1f%aE%x1f%(trailers:key=Co-authored-by,valueonly,separator=%x1d)%x1e');
});
