/**
 * Idioma del tablero de Notion y la interpretación de `BOARD_LANGUAGE`. Los
 * textos visibles de cada idioma son de cada entidad (ver
 * `core/entities/feature.ts`, `TEXTOS_POR_IDIOMA`).
 */
/** Idioma del tablero de Notion: nombres de las propiedades, valores del
 *  select de estado y textos escritos en las filas. Variable de entorno:
 *  `BOARD_LANGUAGE` (`es` por defecto, o `en`; ver `resolverIdiomaTablero`).
 *  No afecta a los documentos ODD: el parser acepta siempre las palabras
 *  clave en los dos idiomas. */
export type Idioma = 'es' | 'en';

export type ResultadoIdioma = { ok: true; idioma: Idioma } | { ok: false; error: string };

/** Interpreta el valor de `BOARD_LANGUAGE`: ausente o vacío → `es`; se
 *  ignoran espacios y mayúsculas. Cualquier otro valor es un error de
 *  configuración, nunca un idioma por defecto silencioso. */
export function resolverIdiomaTablero(valor: string | undefined): ResultadoIdioma {
    const normalizado = (valor ?? '').trim().toLowerCase();
    if (normalizado === '') return { ok: true, idioma: 'es' };
    if (normalizado === 'es' || normalizado === 'en') return { ok: true, idioma: normalizado };
    return {
        ok: false,
        error: `BOARD_LANGUAGE tiene un valor inválido: "${valor}". Valores admitidos: "es" (español, por defecto) o "en" (inglés).`,
    };
}
