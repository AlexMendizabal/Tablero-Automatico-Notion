/**
 * Esquema de una base de Notion, genérico por entidad (ver
 * `core/entities/tipos.ts`): propiedades esperadas, validación contra el
 * esquema real, traducción de claves internas a nombres visibles y lectura de
 * las páginas existentes. Nada de este módulo conoce una entidad concreta.
 */
import type { EsquemaEntidad } from './entities/tipos';
import type { Idioma } from './i18n';
import type { PaginaExistente, PropiedadesNotionBrutas, PropiedadInvalida, RichTextArray } from './types';

/** Claves internas de la entidad, en el orden de `tiposPropiedad`. */
export function clavesPropiedad<C extends string, E extends string>(esquema: EsquemaEntidad<C, E>): C[] {
    return Object.keys(esquema.tiposPropiedad) as C[];
}

/** Propiedades (nombre visible + tipo) que la base de Notion debe tener en el
 *  idioma dado, en el orden de `tiposPropiedad`. Incluye las propiedades de
 *  Notion (`propiedadesDeNotion`): se validan aunque nunca se escriban. */
export function esquemaEsperadoEntidad<C extends string, E extends string>(
    esquema: EsquemaEntidad<C, E>,
    idioma: Idioma = 'es',
): Array<{ nombre: string; tipo: string }> {
    return clavesPropiedad(esquema).map((clave) => ({
        nombre: esquema.textos[idioma].propiedades[clave],
        tipo: esquema.tiposPropiedad[clave],
    }));
}

// ---------------------------------------------------------------------------
// Traducción a propiedades de Notion
// ---------------------------------------------------------------------------

export function textoRico(contenido: string): RichTextArray {
    return contenido === '' ? [] : [{ type: 'text', text: { content: contenido } }];
}

/** Claves que la sincronización puede escribir: todas menos las propiedades
 *  de Notion (`propiedadesDeNotion`). */
export function clavesEscribibles<C extends string, E extends string>(esquema: EsquemaEntidad<C, E>): C[] {
    return clavesPropiedad(esquema).filter((clave) => !esquema.propiedadesDeNotion.includes(clave));
}

/** Frontera con Notion: pasa de claves internas a los nombres visibles del
 *  idioma, en el orden de `tiposPropiedad`. Las claves ausentes se omiten
 *  (ej. la huella, que se escribe aparte al final), y las propiedades de
 *  Notion se descartan SIEMPRE, aunque vengan en `valores`: esta es la única
 *  puerta por la que pasan las propiedades que se escriben. */
export function traducirPropiedadesEntidad<C extends string, E extends string>(
    esquema: EsquemaEntidad<C, E>,
    valores: Partial<Record<C, unknown>>,
    idioma: Idioma,
): PropiedadesNotionBrutas {
    const traducidas: PropiedadesNotionBrutas = {};
    for (const clave of clavesEscribibles(esquema)) {
        if (valores[clave] !== undefined) traducidas[esquema.textos[idioma].propiedades[clave]] = valores[clave];
    }
    return traducidas;
}

// ---------------------------------------------------------------------------
// validarEsquema
// ---------------------------------------------------------------------------

export function validarEsquemaEntidad<C extends string, E extends string>(
    esquema: EsquemaEntidad<C, E>,
    propiedadesDeLaBase: Record<string, { type: string }>,
    idioma: Idioma = 'es',
): PropiedadInvalida[] {
    const problemas: PropiedadInvalida[] = [];
    for (const esperada of esquemaEsperadoEntidad(esquema, idioma)) {
        const actual = propiedadesDeLaBase[esperada.nombre];
        if (!actual) {
            problemas.push({ nombre: esperada.nombre, motivo: 'faltante', tipoEsperado: esperada.tipo });
        } else if (actual.type !== esperada.tipo) {
            problemas.push({
                nombre: esperada.nombre,
                motivo: 'tipo-incorrecto',
                tipoEsperado: esperada.tipo,
                tipoActual: actual.type,
            });
        }
    }
    return problemas;
}

// ---------------------------------------------------------------------------
// Páginas existentes
// ---------------------------------------------------------------------------

function extraerRichTextPlano(propiedad: unknown): string {
    if (propiedad === null || typeof propiedad !== 'object') return '';
    const richText = (propiedad as { rich_text?: unknown }).rich_text;
    if (!Array.isArray(richText)) return '';
    return richText
        .map((item: unknown) => {
            if (item === null || typeof item !== 'object') return '';
            const conocido = item as { plain_text?: string; text?: { content?: string } };
            return conocido.plain_text ?? conocido.text?.content ?? '';
        })
        .join('');
}

/** Lee de una página de Notion lo que necesita el plan: su id, su Slug, su
 *  Huella (por los nombres visibles del idioma) y su `created_time`. */
export function extraerPaginaExistente<C extends string, E extends string>(
    esquema: EsquemaEntidad<C, E>,
    pagina: {
        id: string;
        properties: PropiedadesNotionBrutas;
        createdTime: string;
    },
    idioma: Idioma,
): PaginaExistente {
    const nombres = esquema.textos[idioma].propiedades;
    return {
        pageId: pagina.id,
        slug: extraerRichTextPlano(pagina.properties?.[nombres[esquema.claveSlug]]),
        huella: extraerRichTextPlano(pagina.properties?.[nombres[esquema.claveHuella]]),
        createdTime: pagina.createdTime,
    };
}
