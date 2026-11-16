import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Regresiones del hook de Claude tras el refactor del paquete de Pi
// (odd/tasks/plugin-claude-odd.md, T5): mismo texto y código que antes.
const HOOK = path.resolve('plugin/hooks/validar-odd.mjs');
const temporales: string[] = [];

function temporal(prefijo: string): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), prefijo));
    temporales.push(dir);
    return dir;
}

afterEach(() => {
    for (const dir of temporales.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function correr(script: string, bin: string) {
    const dir = temporal('hk-');
    const entrada = JSON.stringify({
        tool_name: 'Edit',
        tool_input: { file_path: path.join(dir, 'odd', 'tasks', 'a.md') },
        cwd: dir,
    });
    return spawnSync(process.execPath, [script], {
        input: entrada,
        encoding: 'utf8',
        env: { ...process.env, TABLERO_NOTION_BIN: bin },
    });
}

test('sin ejecutor que se pueda arrancar: exit 0 con el mismo aviso de antes', () => {
    const r = correr(HOOK, 'nonexistent-runner-xyz');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe(
        'tablero: could not run tablero-notion --validar (spawnSync nonexistent-runner-xyz ENOENT); ODD document not validated.\n',
    );
});

(process.platform === 'win32' ? test : test.skip)(
    'ejecutado con unidad en minúscula y ruta con espacios sigue validando',
    () => {
        const dir = temporal('Plugin Root ');
        mkdirSync(path.join(dir, 'hooks'));
        cpSync(HOOK, path.join(dir, 'hooks', 'validar-odd.mjs'));
        const falla = path.join(dir, 'falla.js');
        writeFileSync(falla, 'process.stdout.write("bad\\n");process.exit(1)');
        const script = path.join(dir, 'hooks', 'validar-odd.mjs');
        const r = correr(script[0].toLowerCase() + script.slice(1), falla);
        expect(r.status).toBe(2);
        expect(r.stderr).toContain('bad');
    },
);
