/**
 * @jest-environment node
 *
 * Tests del plugin de Claude Code `tablero` (manifest, marketplace, skill,
 * comandos y hook de validación).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parsearDocumento } from '../../src/core/parse';

const RAIZ = path.resolve(__dirname, '..', '..');
const leer = (relativa: string): string => readFileSync(path.join(RAIZ, relativa), 'utf8');
const leerJson = (relativa: string): any => JSON.parse(leer(relativa));

const paquete = leerJson('package.json');

describe('skill del formato ODD', () => {
    test('skill/SKILL.md y la copia del plugin son idénticas byte a byte', () => {
        const original = readFileSync(path.join(RAIZ, 'skill', 'SKILL.md'));
        const copia = readFileSync(path.join(RAIZ, 'plugin', 'skills', 'tablero-odd-documents', 'SKILL.md'));
        expect(copia.equals(original)).toBe(true);
    });

    test('mantiene el nombre tablero-odd-documents en el frontmatter', () => {
        expect(leer('skill/SKILL.md')).toMatch(/^---\r?\nname: tablero-odd-documents\r?\n/);
    });

    test('el documento de ejemplo pasa el parser del sync', () => {
        const skill = leer('skill/SKILL.md');
        const seccion = skill.split(/^## Example document\s*$/m)[1];
        expect(seccion).toBeDefined();
        const bloque = /```markdown\r?\n([\s\S]*?)\r?\n```/.exec(seccion)?.[1];
        expect(bloque).toBeDefined();

        const resultado = parsearDocumento('plugin-claude-odd', bloque as string);

        expect(resultado.ok).toBe(true);
        if (!resultado.ok) return;
        expect(resultado.documento.ramas).toEqual(['feat/plugin-claude-odd']);
        expect(resultado.documento.titulo).toBe('Claude Code plugin and Gentle-compatible ODD format');
        expect(resultado.documento.tareas.map((t) => t.id)).toEqual(['T1', 'T2', 'QA1']);
    });
});

describe('manifest y marketplace', () => {
    test('plugin.json se llama tablero y su versión coincide con package.json', () => {
        const plugin = leerJson('plugin/.claude-plugin/plugin.json');
        expect(plugin.name).toBe('tablero');
        expect(plugin.version).toBe(paquete.version);
        expect(plugin.license).toBe('MIT');
        expect(plugin.author).toEqual({ name: 'AlexMendizabal' });
        expect(typeof plugin.description).toBe('string');
        expect(plugin.repository).toContain('github.com/AlexMendizabal/Tablero-Automatico-Notion');
    });

    test('marketplace.json publica el plugin tablero desde ./plugin', () => {
        const marketplace = leerJson('.claude-plugin/marketplace.json');
        expect(marketplace.name).toBe('tablero-automatico-notion');
        expect(marketplace.name).toBe(paquete.name);
        expect(marketplace.owner).toEqual({ name: 'AlexMendizabal' });
        expect(marketplace.plugins).toHaveLength(1);
        const [entrada] = marketplace.plugins;
        expect(entrada.name).toBe('tablero');
        expect(entrada.source).toBe('./plugin');
        expect(existsSync(path.join(RAIZ, entrada.source, '.claude-plugin', 'plugin.json'))).toBe(true);
    });

    test.each(['validar', 'sync'])('el comando /tablero:%s tiene frontmatter con description y allowed-tools', (nombre) => {
        const comando = leer(`plugin/commands/${nombre}.md`);
        expect(comando).toMatch(/^---\r?\n[\s\S]*?^description: .+$[\s\S]*?^---\r?$/m);
        expect(comando).toMatch(/^allowed-tools: .*Bash\(npx:\*\)/m);
    });
});

describe('hook de validación', () => {
    const SCRIPT = path.join(RAIZ, 'plugin', 'hooks', 'validar-odd.mjs');
    let temporal: string;

    beforeEach(() => {
        temporal = mkdtempSync(path.join(os.tmpdir(), 'tablero-hook-'));
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

    function correrHook(filePath: string, bin?: string) {
        const env = { ...process.env };
        delete env.TABLERO_NOTION_BIN;
        if (bin) env.TABLERO_NOTION_BIN = bin;
        return spawnSync(process.execPath, [SCRIPT], {
            input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: filePath }, cwd: temporal }),
            encoding: 'utf8',
            env,
        });
    }

    test('hooks.json apunta a un script que existe', () => {
        const hooks = leerJson('plugin/hooks/hooks.json');
        const [grupo] = hooks.hooks.PostToolUse;
        expect(grupo.matcher).toBe('Edit|Write|MultiEdit');
        const [hook] = grupo.hooks;
        expect(hook.type).toBe('command');
        const relativa = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)/.exec(hook.command)?.[1];
        expect(relativa).toBe('hooks/validar-odd.mjs');
        expect(existsSync(path.join(RAIZ, 'plugin', relativa as string))).toBe(true);
    });

    test.each([
        path.join('src', 'core', 'parse.ts'),
        'README.md',
        'odd/tasks/notas.txt',
        'docs/odd/otra/x.md',
    ])('ignora un archivo que no es documento ODD (%s): exit 0 sin salida', (ruta) => {
        const resultado = correrHook(path.join(temporal, ruta), ejecutorFalso(1));
        expect(resultado.status).toBe(0);
        expect(resultado.stdout).toBe('');
        expect(resultado.stderr).toBe('');
    });

    test.each([
        'odd/tasks/login.md',
        'odd\\tareas\\login-api.md',
        'C:\\repo\\packages\\api\\odd\\tasks\\pagos.md',
    ])('con formato inválido (%s) sale 2 y muestra la salida del validador en stderr', (ruta) => {
        const resultado = correrHook(ruta, ejecutorFalso(1));
        expect(resultado.status).toBe(2);
        expect(resultado.stdout).toBe('');
        expect(resultado.stderr).toContain('salida --validar');
        expect(resultado.stderr).toContain('error de formato en demo');
    });

    test('con un tablero-notion viejo sin --validar avisa y sale 0 (no bloquea la edición)', () => {
        const viejo = path.join(temporal, 'runner-viejo.js');
        writeFileSync(viejo, `process.stderr.write('Opción desconocida: --validar\\n');\nprocess.exit(1);\n`);
        const resultado = correrHook(path.join(temporal, 'odd', 'tasks', 'login.md'), viejo);
        expect(resultado.status).toBe(0);
        expect(resultado.stdout).toBe('');
        expect(resultado.stderr).toBe(
            'tablero: the installed tablero-notion does not support --validar (update tablero-automatico-notion); ODD document not validated.\n',
        );
    });

    test('con formato válido sale 0 sin salida', () => {
        const resultado = correrHook(path.join(temporal, 'odd', 'tasks', 'login.md'), ejecutorFalso(0));
        expect(resultado.status).toBe(0);
        expect(resultado.stdout).toBe('');
        expect(resultado.stderr).toBe('');
    });

    test('si el ejecutor no puede arrancar avisa y sale 0 (no bloquea la edición)', () => {
        const resultado = correrHook('odd/tasks/login.md', path.join(temporal, 'no-existe-tablero-notion'));
        expect(resultado.status).toBe(0);
        expect(resultado.stderr).toContain('could not run tablero-notion --validar');
    });
});
