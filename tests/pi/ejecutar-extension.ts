/**
 * Driver for tests/pi/pi-package.test.ts (not a test file).
 *
 * Loads the Pi extension with a fake `pi` object, the same way Pi does (a
 * default factory that receives the API), invokes every registered
 * `tool_result` handler with the event read from stdin and prints the handler
 * results and the UI notifications as JSON. It runs under `tsx` in a child
 * process because the extension imports the hook's ESM module (`.mjs`), which
 * the CommonJS jest runtime cannot load.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

type Manejador = (evento: unknown, ctx: unknown) => unknown;

async function principal(): Promise<void> {
    const escenario = JSON.parse(readFileSync(0, 'utf8')) as {
        extension: string;
        cwd: string;
        hasUI?: boolean;
        evento: unknown;
    };
    const modulo = await import(pathToFileURL(escenario.extension).href);
    const fabrica = (modulo.default?.default ?? modulo.default) as (pi: unknown) => unknown;

    const manejadores = new Map<string, Manejador[]>();
    const pi = {
        on(evento: string, manejador: Manejador) {
            manejadores.set(evento, [...(manejadores.get(evento) ?? []), manejador]);
        },
    };
    await fabrica(pi);

    const avisos: Array<{ mensaje: string; tipo?: string }> = [];
    const ctx = {
        cwd: escenario.cwd,
        hasUI: escenario.hasUI ?? true,
        ui: { notify: (mensaje: string, tipo?: string) => avisos.push({ mensaje, tipo }) },
    };
    const resultados: unknown[] = [];
    for (const manejador of manejadores.get('tool_result') ?? []) {
        resultados.push((await manejador(escenario.evento, ctx)) ?? null);
    }
    process.stdout.write(JSON.stringify({ eventos: [...manejadores.keys()], resultados, avisos }));
}

principal().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
});
