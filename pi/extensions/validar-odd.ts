/**
 * Pi extension of tablero-automatico-notion (Gentle Shell).
 *
 * After a successful `write` or `edit` of a `.md` under `odd/tasks/` or
 * `odd/tareas/` (any depth), runs `tablero-notion --validar` in the session
 * cwd with the same runner resolution and outcome rules as the Claude Code
 * hook (plugin/hooks/validar-odd.mjs, imported below):
 *   - format errors -> the validator output is appended to the tool result,
 *     so the model sees it and can fix the document;
 *   - valid -> the result is left unchanged;
 *   - runner missing/killed or a release older than --validar -> a short
 *     UI warning; the result is left unchanged (never blocks).
 *
 * Only Node built-ins and the shared hook module: no Pi imports, so the
 * package needs no new runtime dependencies. The types below are the minimal
 * subset of the documented `tool_result` contract this extension uses.
 */
import { validarDocumentoOdd } from '../../plugin/hooks/validar-odd.mjs';

interface ContenidoTexto {
    type: 'text';
    text: string;
}

interface EventoResultadoHerramienta {
    toolName: string;
    input?: { path?: unknown };
    content?: unknown[];
    isError?: boolean;
}

interface ContextoExtension {
    cwd: string;
    hasUI?: boolean;
    ui?: { notify(mensaje: string, tipo?: 'info' | 'warning' | 'error'): void };
}

interface ApiExtension {
    on(
        evento: 'tool_result',
        manejador: (
            evento: EventoResultadoHerramienta,
            ctx: ContextoExtension,
        ) => Promise<{ content: unknown[] } | undefined>,
    ): void;
}

/** Built-in Pi tools that write files (`input.path`). */
const HERRAMIENTAS_DE_ESCRITURA = new Set(['write', 'edit']);

export default function validarOdd(pi: ApiExtension): void {
    pi.on('tool_result', async (evento, ctx) => {
        if (!HERRAMIENTAS_DE_ESCRITURA.has(evento.toolName) || evento.isError) return undefined;
        const resultado = await validarDocumentoOdd(evento.input?.path, ctx.cwd);
        if (resultado === null || resultado.tipo === 'valido') return undefined;
        if (resultado.tipo === 'aviso') {
            if (ctx.hasUI && ctx.ui) ctx.ui.notify(resultado.mensaje, 'warning');
            return undefined;
        }
        const aviso: ContenidoTexto = { type: 'text', text: resultado.mensaje };
        return { content: [...(evento.content ?? []), aviso] };
    });
}
