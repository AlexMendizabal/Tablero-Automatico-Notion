/**
 * Normalización del ID de la base de Notion (ID pelado o URL completa).
 */

// ---------------------------------------------------------------------------
// normalizarIdBaseNotion
// ---------------------------------------------------------------------------

export type ResultadoNormalizacionId = { ok: true; id: string } | { ok: false; error: string };

const REGEX_ID_32_HEX = /^[0-9a-f]{32}$/i;
const REGEX_UUID_CON_GUIONES = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Un segmento de URL termina en una corrida de 32 hex, sola o precedida por
 *  "-" (el título de la página, ej. "Tablero-de-features-<32hex>"). */
const REGEX_ID_AL_FINAL_DE_SEGMENTO = /(?:^|-)([0-9a-f]{32})$/i;

const MENSAJE_ID_BASE_INVALIDO =
    'NOTION_TABLERO_DB_ID no contiene un ID de base de Notion: se espera el ID de 32 caracteres ' +
    'hexadecimales, o la URL completa de la base de Notion. El "?v=..." al final de una URL de Notion ' +
    'identifica la VISTA, no la base, y se ignora.';

function extraerIdDeSegmento(segmento: string): string | null {
    if (REGEX_ID_32_HEX.test(segmento)) return segmento.toLowerCase();
    if (REGEX_UUID_CON_GUIONES.test(segmento)) return segmento.toLowerCase().replace(/-/g, '');
    const coincidencia = REGEX_ID_AL_FINAL_DE_SEGMENTO.exec(segmento);
    return coincidencia ? coincidencia[1].toLowerCase() : null;
}

/**
 * Acepta el ID de base de Notion en cualquiera de sus formas usuales: el ID
 * "pelado" (32 hex, con o sin guiones tipo UUID) o la URL completa de la
 * base tal como se copia del navegador, con o sin "?v=<id-de-vista>" — el
 * query string (y cualquier hash) se descarta ANTES que cualquier otra
 * cosa, porque pegar la URL con el parámetro de vista es el error real que
 * motivó esta función: produce un 400 críptico de Notion, porque ese "v" es
 * el ID de la VISTA, no el de la base. El resultado se normaliza siempre a
 * 32 hex en minúscula sin guiones: la API de Notion acepta las dos formas,
 * pero un único formato interno simplifica los logs y los tests.
 */
export function normalizarIdBaseNotion(valor: string): ResultadoNormalizacionId {
    const sinQueryNiHash = valor.trim().split('?')[0].split('#')[0].trim();
    if (sinQueryNiHash === '') return { ok: false, error: MENSAJE_ID_BASE_INVALIDO };

    const segmentos = sinQueryNiHash.split('/').filter((s) => s.trim() !== '');
    const ultimoSegmento = segmentos.length > 0 ? segmentos[segmentos.length - 1] : sinQueryNiHash;

    const id = extraerIdDeSegmento(ultimoSegmento);
    if (id === null) return { ok: false, error: MENSAJE_ID_BASE_INVALIDO };
    return { ok: true, id };
}
