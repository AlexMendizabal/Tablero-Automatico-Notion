/**
 * Utilidades de mensajes de error, compartidas por las capas.
 */

export function mensajeDeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
