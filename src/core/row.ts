/**
 * Utilidades compartidas por el armado de filas de cualquier entidad (el
 * armado de cada una vive en su descriptor, ver `core/entities/`).
 */

// ---------------------------------------------------------------------------
// recortarParaNotion
// ---------------------------------------------------------------------------

/** Notion limita cada objeto de texto a 2000 caracteres; se deja margen y se
 *  recorta a 1900 con "…" para señalar visualmente el corte. */
const LIMITE_TEXTO_NOTION = 1900;

export function recortarParaNotion(texto: string): string {
    if (texto.length <= LIMITE_TEXTO_NOTION) return texto;
    return texto.slice(0, LIMITE_TEXTO_NOTION - 1) + '…';
}
