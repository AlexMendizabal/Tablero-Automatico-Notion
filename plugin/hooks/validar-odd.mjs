#!/usr/bin/env node
// PostToolUse hook of the `tablero` Claude Code plugin.
//
// Reads the hook JSON from stdin ({ tool_name, tool_input: { file_path }, cwd }).
// When the edited file is a `.md` inside an `odd/tasks/` or `odd/tareas/`
// folder, runs `tablero-notion --validar` in `cwd`:
//   - format errors (non-zero exit) -> its output goes to stderr, exit 2
//     (Claude Code shows it to the model);
//   - valid -> exit 0, silent.
// Any other file -> exit 0, silent. If the runner cannot be started, prints a
// short warning and exits 0: a missing tool never blocks editing.
//
// Runner resolution: TABLERO_NOTION_BIN (override) -> local package in
// node_modules -> `npx -y -p tablero-automatico-notion tablero-notion`.
// Plain Node, no dependencies, Windows-safe.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ES_WINDOWS = process.platform === 'win32';
const REGEX_DOC_ODD = /(^|\/)odd\/(tasks|tareas)\/(.+\/)?[^/]+\.md$/i;
const TIEMPO_MAXIMO_MS = 120_000;

function leerEntrada() {
    try {
        const texto = readFileSync(0, 'utf8');
        return texto.trim() === '' ? {} : JSON.parse(texto);
    } catch {
        return {};
    }
}

export function esDocumentoOdd(rutaArchivo) {
    if (typeof rutaArchivo !== 'string' || rutaArchivo === '') return false;
    return REGEX_DOC_ODD.test(rutaArchivo.replace(/\\/g, '/'));
}

function esScriptNode(ruta) {
    return /\.(c|m)?js$/i.test(ruta);
}

/** Returns { comando, argumentos, shell } for the first available runner. */
function resolverEjecutor(cwd) {
    const binForzado = process.env.TABLERO_NOTION_BIN;
    if (binForzado) {
        if (esScriptNode(binForzado)) {
            return { comando: process.execPath, argumentos: [binForzado], shell: false };
        }
        return { comando: binForzado, argumentos: [], shell: ES_WINDOWS && /\.(cmd|bat)$/i.test(binForzado) };
    }
    const cliLocal = path.join(cwd, 'node_modules', 'tablero-automatico-notion', 'dist', 'entrypoints', 'cli.js');
    if (existsSync(cliLocal)) {
        return { comando: process.execPath, argumentos: [cliLocal], shell: false };
    }
    const binLocal = path.join(cwd, 'node_modules', '.bin', ES_WINDOWS ? 'tablero-notion.cmd' : 'tablero-notion');
    if (existsSync(binLocal)) {
        return { comando: binLocal, argumentos: [], shell: ES_WINDOWS };
    }
    return {
        comando: 'npx',
        argumentos: ['-y', '-p', 'tablero-automatico-notion', 'tablero-notion'],
        shell: ES_WINDOWS,
    };
}

function citarSiHaceFalta(parte) {
    return /[\s"]/.test(parte) ? `"${parte.replace(/"/g, '\\"')}"` : parte;
}

function principal() {
    const entrada = leerEntrada();
    const cwd = typeof entrada.cwd === 'string' && entrada.cwd !== '' ? entrada.cwd : process.cwd();
    const rutaArchivo = entrada?.tool_input?.file_path;
    if (!esDocumentoOdd(rutaArchivo)) return 0;

    const { comando, argumentos, shell } = resolverEjecutor(cwd);
    const todos = [...argumentos, '--validar'];
    // With shell (Windows .cmd shims) pass a single quoted command line.
    const resultado = shell
        ? spawnSync([comando, ...todos].map(citarSiHaceFalta).join(' '), {
              cwd,
              encoding: 'utf8',
              shell: true,
              timeout: TIEMPO_MAXIMO_MS,
              windowsHide: true,
          })
        : spawnSync(comando, todos, {
              cwd,
              encoding: 'utf8',
              timeout: TIEMPO_MAXIMO_MS,
              windowsHide: true,
          });

    if (resultado.error || resultado.status === null) {
        const motivo = resultado.error ? resultado.error.message : `terminated by ${resultado.signal}`;
        process.stderr.write(`tablero: could not run tablero-notion --validar (${motivo}); ODD document not validated.\n`);
        return 0;
    }
    if (resultado.status !== 0) {
        const salida = [resultado.stdout, resultado.stderr].filter((s) => s && s.trim() !== '').join('\n');
        // A release older than --validar rejects the option: warn, never block.
        if (/Opción desconocida: .*--validar/.test(salida)) {
            process.stderr.write(
                'tablero: the installed tablero-notion does not support --validar (update tablero-automatico-notion); ODD document not validated.\n',
            );
            return 0;
        }
        process.stderr.write(
            `tablero-notion --validar failed after editing ${rutaArchivo} (exit ${resultado.status}):\n${salida}\n`,
        );
        return 2;
    }
    return 0;
}

process.exitCode = principal();
