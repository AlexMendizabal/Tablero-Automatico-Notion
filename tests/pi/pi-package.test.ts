/**
 * @jest-environment node
 *
 * Tests del paquete de Pi (Gentle Shell): manifest `pi` de package.json,
 * plantillas de comandos y extensión que valida al editar documentos ODD.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RAIZ = path.resolve(__dirname, '..', '..');
const leer = (relativa: string): string => readFileSync(path.join(RAIZ, relativa), 'utf8');
const paquete = JSON.parse(leer('package.json'));

const EXTENSION = path.join(RAIZ, 'pi', 'extensions', 'validar-odd.ts');
const DRIVER = path.join(__dirname, 'ejecutar-extension.ts');
const TSX_CLI = require.resolve('tsx/cli');
const HOOK = path.join(RAIZ, 'plugin', 'hooks', 'validar-odd.mjs');

const AVISO_VIEJO =
    'tablero: the installed tablero-notion does not support --validar (update tablero-automatico-notion); ODD document not validated.';

describe('manifest pi de package.json', () => {
    test('declara skill, prompts y extensión con rutas que existen', () => {
        expect(paquete.pi).toEqual({
            skills: ['./skill'],
            prompts: ['./pi/prompts/*.md'],
            extensions: ['./pi/extensions/validar-odd.ts'],
        });
        expect(existsSync(path.join(RAIZ, 'skill', 'SKILL.md'))).toBe(true);
        expect(existsSync(path.join(RAIZ, 'pi', 'prompts', 'tablero-validar.md'))).toBe(true);
        expect(existsSync(path.join(RAIZ, 'pi', 'prompts', 'tablero-sync.md'))).toBe(true);
        expect(existsSync(EXTENSION)).toBe(true);
    });

    test('es descubrible como pi-package y publica lo que la extensión carga', () => {
        expect(paquete.keywords).toContain('pi-package');
        expect(paquete.files).toEqual(expect.arrayContaining(['skill', 'pi', 'plugin/hooks/validar-odd.mjs']));
    });

    test('la extensión no necesita dependencias nuevas ni importa paquetes de Pi', () => {
        expect(Object.keys(paquete.dependencies)).toEqual(['dotenv']);
        const fuente = readFileSync(EXTENSION, 'utf8');
        const importaciones = [...fuente.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
        expect(importaciones).toEqual(['../../plugin/hooks/validar-odd.mjs']);
    });
});

describe('plantillas de comandos de Pi', () => {
    test.each([
        ['tablero-validar', '--validar'],
        ['tablero-sync', '--dry-run'],
    ])('%s tiene description, usa %s, TABLERO_NOTION_BIN y $ARGUMENTS, sin allowed-tools', (nombre, opcion) => {
        const plantilla = leer(`pi/prompts/${nombre}.md`);
        expect(plantilla).toMatch(/^---\r?\ndescription: .+\r?\n---\r?\n/);
        expect(plantilla).not.toMatch(/allowed-tools/);
        expect(plantilla).toContain(opcion);
        expect(plantilla).toContain('TABLERO_NOTION_BIN');
        expect(plantilla).toContain('npx -y -p tablero-automatico-notion tablero-notion');
        expect(plantilla).toContain('tablero-odd-documents');
        expect(plantilla.trimEnd().endsWith('$ARGUMENTS')).toBe(true);
    });

    test('tablero-sync corre el dry-run primero y el sync real solo tras confirmación explícita', () => {
        const plantilla = leer('pi/prompts/tablero-sync.md');
        const dryRun = plantilla.indexOf('with `--dry-run`');
        const confirmar = plantilla.indexOf('Only after an explicit yes');
        expect(dryRun).toBeGreaterThan(-1);
        expect(confirmar).toBeGreaterThan(dryRun);
    });
});

describe('módulo compartido del hook', () => {
    test('importarlo exporta las piezas puras y no ejecuta el hook (no lee stdin ni escribe)', () => {
        const resultado = spawnSync(
            process.execPath,
            [
                '--input-type=module',
                '-e',
                `const m = await import(${JSON.stringify(pathToFileURL(HOOK).href)}); console.log(Object.keys(m).sort().join(','));`,
            ],
            { input: JSON.stringify({ tool_input: { file_path: 'odd/tasks/x.md' } }), encoding: 'utf8' },
        );
        expect(resultado.stderr).toBe('');
        expect(resultado.status).toBe(0);
        expect(resultado.stdout.trim()).toBe(
            'clasificarResultado,ejecutarValidacion,esDocumentoOdd,resolverEjecutor,validarDocumentoOdd',
        );
    });
});

describe('extensión validar-odd de Pi', () => {
    let temporal: string;

    beforeEach(() => {
        temporal = mkdtempSync(path.join(os.tmpdir(), 'tablero-pi-'));
    });
    afterEach(() => {
        rmSync(temporal, { recursive: true, force: true });
    });

    function ejecutorFalso(codigo: number): string {
        const ruta = path.join(temporal, `runner-${codigo}.js`);
        writeFileSync(
            ruta,
            `process.stdout.write('salida ' + process.argv.slice(2).join(' ') + '\\n');\n` +
                `process.stderr.write('error de formato en demo\\n');\n` +
                `process.exit(${codigo});\n`,
        );
        return ruta;
    }

    const CONTENIDO = [{ type: 'text', text: 'Successfully wrote 120 bytes' }];

    function correr(evento: Record<string, unknown>, bin?: string, hasUI = true) {
        const env = { ...process.env };
        delete env.TABLERO_NOTION_BIN;
        if (bin) env.TABLERO_NOTION_BIN = bin;
        const proceso = spawnSync(process.execPath, [TSX_CLI, DRIVER], {
            input: JSON.stringify({
                extension: EXTENSION,
                cwd: temporal,
                hasUI,
                evento: { toolCallId: 'c1', content: CONTENIDO, isError: false, ...evento },
            }),
            encoding: 'utf8',
            env,
        });
        expect(proceso.stderr).toBe('');
        expect(proceso.status).toBe(0);
        return JSON.parse(proceso.stdout) as {
            eventos: string[];
            resultados: unknown[];
            avisos: Array<{ mensaje: string; tipo?: string }>;
        };
    }

    test.each([
        ['write', 'src/core/parse.ts'],
        ['edit', 'README.md'],
        ['write', 'odd/tasks/notas.txt'],
        ['edit', 'docs/odd/otra/x.md'],
        ['read', 'odd/tasks/login.md'],
        ['bash', 'odd/tasks/login.md'],
    ])('%s sobre %s no es una edición de documento ODD: resultado sin cambios', (toolName, ruta) => {
        const salida = correr({ toolName, input: { path: ruta } }, ejecutorFalso(1));
        expect(salida.eventos).toEqual(['tool_result']);
        expect(salida.resultados).toEqual([null]);
        expect(salida.avisos).toEqual([]);
    }, 30_000);

    test.each([
        ['write', 'odd/tasks/login.md'],
        ['edit', 'odd\\tareas\\login-api.md'],
        ['edit', 'C:\\repo\\packages\\api\\odd\\tasks\\sub\\pagos.md'],
    ])('%s con formato inválido (%s) agrega la salida del validador al resultado que ve el modelo', (toolName, ruta) => {
        const salida = correr({ toolName, input: { path: ruta } }, ejecutorFalso(1));
        expect(salida.avisos).toEqual([]);
        expect(salida.resultados).toHaveLength(1);
        const resultado = salida.resultados[0] as { content: Array<{ type: string; text: string }>; isError?: boolean };
        expect(resultado.isError).toBeUndefined();
        expect(resultado.content).toHaveLength(2);
        expect(resultado.content[0]).toEqual(CONTENIDO[0]);
        expect(resultado.content[1].type).toBe('text');
        expect(resultado.content[1].text).toContain(`tablero-notion --validar failed after editing ${ruta} (exit 1):`);
        expect(resultado.content[1].text).toContain('salida --validar');
        expect(resultado.content[1].text).toContain('error de formato en demo');
    }, 30_000);

    test('con formato válido el resultado queda sin cambios', () => {
        const salida = correr({ toolName: 'write', input: { path: 'odd/tasks/login.md' } }, ejecutorFalso(0));
        expect(salida.resultados).toEqual([null]);
        expect(salida.avisos).toEqual([]);
    }, 30_000);

    test('si la herramienta falló no valida', () => {
        const salida = correr(
            { toolName: 'edit', input: { path: 'odd/tasks/login.md' }, isError: true },
            ejecutorFalso(1),
        );
        expect(salida.resultados).toEqual([null]);
        expect(salida.avisos).toEqual([]);
    }, 30_000);

    test('con un tablero-notion viejo sin --validar avisa por la UI y no marca error', () => {
        const viejo = path.join(temporal, 'runner-viejo.js');
        writeFileSync(viejo, `process.stderr.write('Opción desconocida: --validar\\n');\nprocess.exit(1);\n`);
        const salida = correr({ toolName: 'edit', input: { path: 'odd/tasks/login.md' } }, viejo);
        expect(salida.resultados).toEqual([null]);
        expect(salida.avisos).toEqual([{ mensaje: AVISO_VIEJO, tipo: 'warning' }]);
    }, 30_000);

    test('sin UI el aviso no bloquea ni cambia el resultado', () => {
        const viejo = path.join(temporal, 'runner-viejo.js');
        writeFileSync(viejo, `process.stderr.write('Opción desconocida: --validar\\n');\nprocess.exit(1);\n`);
        const salida = correr({ toolName: 'edit', input: { path: 'odd/tasks/login.md' } }, viejo, false);
        expect(salida.resultados).toEqual([null]);
        expect(salida.avisos).toEqual([]);
    }, 30_000);

    test('si el ejecutor no puede arrancar avisa y no marca error', () => {
        const salida = correr(
            { toolName: 'write', input: { path: 'odd/tasks/login.md' } },
            path.join(temporal, 'no-existe-tablero-notion'),
        );
        expect(salida.resultados).toEqual([null]);
        expect(salida.avisos).toHaveLength(1);
        expect(salida.avisos[0].tipo).toBe('warning');
        expect(salida.avisos[0].mensaje).toContain('could not run tablero-notion --validar');
    }, 30_000);
});
