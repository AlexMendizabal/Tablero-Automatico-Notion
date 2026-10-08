/**
 * Esquema de una base de Notion, genérico por entidad (ver
 * `core/entities/tipos.ts`): propiedades esperadas, validación contra el
 * esquema real, traducción de claves internas a nombres visibles y lectura de
 * las páginas existentes. Nada de este módulo conoce una entidad concreta.
 */
import type { EsquemaEntidad } from './entities/tipos';
import type { Idioma } from './i18n';
import type {
    PaginaExistente,
    PropiedadEsquemaNotion,
    PropiedadesNotionBrutas,
    PropiedadInvalida,
    RichTextArray,
} from './types';

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
 *  puerta por la que pasan las propiedades que se escriben. Las claves de
 *  `omitir` (ej. propiedades opcionales que la base no tiene, ver
 *  `propiedadesOpcionalesAusentes`) tampoco se traducen. */
export function traducirPropiedadesEntidad<C extends string, E extends string>(
    esquema: EsquemaEntidad<C, E>,
    valores: Partial<Record<C, unknown>>,
    idioma: Idioma,
    omitir: readonly C[] = [],
): PropiedadesNotionBrutas {
    const traducidas: PropiedadesNotionBrutas = {};
    for (const clave of clavesEscribibles(esquema)) {
        if (omitir.includes(clave)) continue;
        if (valores[clave] !== undefined) traducidas[esquema.textos[idioma].propiedades[clave]] = valores[clave];
    }
    return traducidas;
}

/** Claves de las propiedades opcionales (`propiedadesOpcionales`) que la
 *  base de Notion no tiene: no se escriben. */
export function propiedadesOpcionalesAusentes<C extends string, E extends string>(
    esquema: EsquemaEntidad<C, E>,
    propiedadesDeLaBase: Record<string, PropiedadEsquemaNotion>,
    idioma: Idioma,
): C[] {
    return esquema.propiedadesOpcionales.filter(
        (clave) => propiedadesDeLaBase[esquema.textos[idioma].propiedades[clave]] === undefined,
    );
}

// ---------------------------------------------------------------------------
// validarEsquema
// ---------------------------------------------------------------------------

/** Un ID de Notion en forma comparable: sin guiones y en minúscula (la API
 *  los devuelve con guiones; un ID copiado de la URL no los tiene). */
function idComparable(id: string): string {
    return id.replace(/-/g, '').toLowerCase();
}

/**
 * Compara el esquema esperado de la entidad con el de la base real (una
 * propiedad opcional puede faltar, pero si existe se valida igual). Además
 * del nombre y el tipo, una propiedad `relation` cuya clave figura en
 * `destinosRelacion` (clave → data source esperado) tiene que apuntar a ese
 * data source (`relation.data_source_id`, Notion-Version 2025-09-03); si
 * apunta a otro, o no dice a cuál, es `relacion-incorrecta`. Sin destino
 * esperado para esa clave, solo se valida el tipo.
 */
export function validarEsquemaEntidad<C extends string, E extends string>(
    esquema: EsquemaEntidad<C, E>,
    propiedadesDeLaBase: Record<string, PropiedadEsquemaNotion>,
    idioma: Idioma = 'es',
    destinosRelacion: Partial<Record<C, string>> = {},
): PropiedadInvalida[] {
    const problemas: PropiedadInvalida[] = [];
    for (const clave of clavesPropiedad(esquema)) {
        const nombre = esquema.textos[idioma].propiedades[clave];
        const tipoEsperado = esquema.tiposPropiedad[clave];
        const actual = propiedadesDeLaBase[nombre];
        if (!actual) {
            // Una propiedad opcional que falta no es un problema: no se escribe.
            if (!esquema.propiedadesOpcionales.includes(clave)) {
                problemas.push({ nombre, motivo: 'faltante', tipoEsperado });
            }
            continue;
        }
        if (actual.type !== tipoEsperado) {
            problemas.push({ nombre, motivo: 'tipo-incorrecto', tipoEsperado, tipoActual: actual.type });
            continue;
        }
        const destinoEsperado = destinosRelacion[clave];
        if (tipoEsperado !== 'relation' || destinoEsperado === undefined) continue;
        const destinoActual = actual.relation?.data_source_id;
        if (destinoActual === undefined || idComparable(destinoActual) !== idComparable(destinoEsperado)) {
            problemas.push({ nombre, motivo: 'relacion-incorrecta', tipoEsperado, destinoEsperado, destinoActual });
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
