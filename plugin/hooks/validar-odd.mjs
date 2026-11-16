#!/usr/bin/env node
// PostToolUse hook of the `tablero` Claude Code plugin, and the shared
// validation module of the Pi extension (pi/extensions/validar-odd.ts).
//
// As a hook (run directly with node) it reads the hook JSON from stdin
// ({ tool_name, tool_input: { file_path }, cwd }).
// When the edited file is a `.md` inside an `odd/tasks/` or `odd/tareas/`
// folder, runs `tablero-notion --validar` in `cwd`:
//   - format errors (non-zero exit) -> its output goes to stderr, exit 2
//     (Claude Code shows it to the model);
//   - valid -> exit 0, silent.
// Any other file -> exit 0, silent. If the runner cannot be started, prints a
// short warning and exits 0: a missing tool never blocks editing.
//
// When imported, it only exports the pure pieces (path filter, runner
// resolution, run + classify) and does not read stdin.
//
// Runner resolution: TABLERO_NOTION_BIN (override) -> local package in
// node_modules -> `npx -y -p tablero-automatico-notion tablero-notion`.
// Plain Node, no dependencies, Windows-safe.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** True when `rutaArchivo` is a `.md` under `odd/tasks/` or `odd/tareas/` (any depth, `/` or `\`). */
export function esDocumentoOdd(rutaArchivo) {
    if (typeof rutaArchivo !== 'string' || rutaArchivo === '') return false;
    return REGEX_DOC_ODD.test(rutaArchivo.replace(/\\/g, '/'));
}

function esScriptNode(ruta) {
    return /\.(c|m)?js$/i.test(ruta);
}

/** Returns { comando, argumentos, shell } for the first available runner. */
export function resolverEjecutor(cwd, env = process.env) {
    const binForzado = env.TABLERO_NOTION_BIN;
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

/**
 * Runs `<runner> --validar` in `cwd` without blocking the event loop.
 * Resolves { error, status, signal, stdout, stderr } (never rejects).
 */
export function ejecutarValidacion(cwd, { env = process.env, timeoutMs = TIEMPO_MAXIMO_MS } = {}) {
    const { comando, argumentos, shell } = resolverEjecutor(cwd, env);
    const todos = [...argumentos, '--validar'];
    const opciones = { cwd, env, timeout: timeoutMs, windowsHide: true };
    return new Promise((resolver) => {
        let stdout = '';
        let stderr = '';
        let terminado = false;
        const terminar = (resultado) => {
            if (terminado) return;
            terminado = true;
            resolver({ stdout, stderr, ...resultado });
        };
        let hijo;
        try {
            // With shell (Windows .cmd shims) pass a single quoted command line.
            hijo = shell
                ? spawn([comando, ...todos].map(citarSiHaceFalta).join(' '), { ...opciones, shell: true })
                : spawn(comando, todos, opciones);
        } catch (error) {
            terminar({ error, status: null, signal: null });
            return;
        }
        hijo.stdout?.setEncoding('utf8');
        hijo.stderr?.setEncoding('utf8');
        hijo.stdout?.on('data', (parte) => {
            stdout += parte;
        });
        hijo.stderr?.on('data', (parte) => {
            stderr += parte;
        });
        hijo.on('error', (error) => terminar({ error, status: null, signal: null }));
        hijo.on('close', (status, signal) => terminar({ error: undefined, status, signal }));
    });
}

/**
 * Classifies a validation run:
 *   - { tipo: 'valido' }                 exit 0;
 *   - { tipo: 'invalido', mensaje }      format errors (validator output);
 *   - { tipo: 'aviso', mensaje }         runner missing/killed or a release
 *                                        older than --validar: never blocks.
 *
 * @typedef {{ tipo: 'valido' } | { tipo: 'invalido' | 'aviso', mensaje: string }} Clasificacion
 * @returns {Clasificacion}
 */
export function clasificarResultado(resultado, rutaArchivo) {
    if (resultado.error || resultado.status === null) {
        const motivo = resultado.error ? resultado.error.message : `terminated by ${resultado.signal}`;
        return {
            tipo: 'aviso',
            mensaje: `tablero: could not run tablero-notion --validar (${motivo}); ODD document not validated.`,
        };
    }
    if (resultado.status === 0) return { tipo: 'valido' };
    const salida = [resultado.stdout, resultado.stderr].filter((s) => s && s.trim() !== '').join('\n');
    // A release older than --validar rejects the option: warn, never block.
    if (/Opción desconocida: .*--validar/.test(salida)) {
        return {
            tipo: 'aviso',
            mensaje:
                'tablero: the installed tablero-notion does not support --validar (update tablero-automatico-notion); ODD document not validated.',
        };
    }
    return {
        tipo: 'invalido',
        mensaje: `tablero-notion --validar failed after editing ${rutaArchivo} (exit ${resultado.status}):\n${salida}`,
    };
}

/**
 * Validates after editing `rutaArchivo`; null when it is not an ODD document.
 * @returns {Promise<Clasificacion | null>}
 */
export async function validarDocumentoOdd(rutaArchivo, cwd, opciones) {
    if (!esDocumentoOdd(rutaArchivo)) return null;
    return clasificarResultado(await ejecutarValidacion(cwd, opciones), rutaArchivo);
}

async function principal() {
    const entrada = leerEntrada();
    const cwd = typeof entrada.cwd === 'string' && entrada.cwd !== '' ? entrada.cwd : process.cwd();
    const rutaArchivo = entrada?.tool_input?.file_path;
    const resultado = await validarDocumentoOdd(rutaArchivo, cwd);
    if (resultado === null || resultado.tipo === 'valido') return 0;
    process.stderr.write(`${resultado.mensaje}\n`);
    return resultado.tipo === 'invalido' ? 2 : 0;
}

function esEjecucionDirecta() {
    const script = process.argv[1];
    if (!script) return false;
    try {
        const ejecutado = realpathSync(path.resolve(script));
        const este = realpathSync(fileURLToPath(import.meta.url));
        return ES_WINDOWS ? ejecutado.toLowerCase() === este.toLowerCase() : ejecutado === este;
    } catch {
        return false;
    }
}

if (esEjecucionDirecta()) {
    principal().then(
        (codigo) => {
            process.exitCode = codigo;
        },
        (error) => {
            // Never block editing on an unexpected failure of the hook itself.
            process.stderr.write(`tablero: ODD document not validated (${error?.message ?? error}).\n`);
            process.exitCode = 0;
        },
    );
}
