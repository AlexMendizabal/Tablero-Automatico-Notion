/**
 * Esquema de la base de Notion: tipos de cada propiedad, valores que viajan
 * a Notion y validación contra el esquema real.
 */
import { type Idioma, TEXTOS_POR_IDIOMA } from './i18n';
import type {
    FilaTablero,
    PropiedadesNotion,
    PropiedadesNotionBrutas,
    PropiedadInvalida,
    RichTextArray,
    ValoresPropiedades,
} from './types';

/**
 * Tipo de Notion de cada propiedad del tablero, por clave interna (neutral,
 * la misma que el campo correspondiente de `FilaTablero`). El orden de esta
 * constante es el orden en que se validan y se escriben las propiedades.
 */
export const TIPOS_PROPIEDAD = {
    feature: 'title',
    slug: 'rich_text',
    estado: 'select',
    progreso: 'rich_text',
    pendiente: 'rich_text',
    prsAbiertos: 'rich_text',
    ramas: 'rich_text',
    diasSinActividad: 'number',
    actualizado: 'date',
    documento: 'url',
    huella: 'rich_text',
} as const;

export type ClavePropiedad = keyof typeof TIPOS_PROPIEDAD;

const CLAVES_PROPIEDAD = Object.keys(TIPOS_PROPIEDAD) as ClavePropiedad[];

/** Propiedades (nombre visible + tipo) que la base de Notion debe tener en el
 *  idioma dado, en el orden de `TIPOS_PROPIEDAD`. */
export function esquemaEsperado(idioma: Idioma = 'es'): Array<{ nombre: string; tipo: string }> {
    return CLAVES_PROPIEDAD.map((clave) => ({
        nombre: TEXTOS_POR_IDIOMA[idioma].propiedades[clave],
        tipo: TIPOS_PROPIEDAD[clave],
    }));
}

// ---------------------------------------------------------------------------
// construirPropiedadesNotion
// ---------------------------------------------------------------------------

function textoRico(contenido: string): RichTextArray {
    return contenido === '' ? [] : [{ type: 'text', text: { content: contenido } }];
}

/** Valores de las propiedades de una fila, por clave interna. El estado ya
 *  sale con su nombre visible en el idioma dado. */
export function construirValoresPropiedades(fila: FilaTablero, idioma: Idioma = 'es'): ValoresPropiedades {
    return {
        feature: { title: textoRico(fila.feature) },
        slug: { rich_text: textoRico(fila.slug) },
        estado: { select: { name: TEXTOS_POR_IDIOMA[idioma].estados[fila.estado] } },
        progreso: { rich_text: textoRico(fila.progreso) },
        pendiente: { rich_text: textoRico(fila.pendiente) },
        prsAbiertos: { rich_text: textoRico(fila.prsAbiertos) },
        ramas: { rich_text: textoRico(fila.ramas) },
        diasSinActividad: { number: fila.diasSinActividad },
        actualizado: { date: { start: fila.actualizado } },
        documento: { url: fila.documento },
        huella: { rich_text: textoRico(fila.huella) },
    };
}

/** Frontera con Notion: pasa de claves internas a los nombres visibles del
 *  idioma, en el orden de `TIPOS_PROPIEDAD`. Las claves ausentes se omiten
 *  (ej. la huella, que se escribe aparte al final). */
export function traducirPropiedades(valores: Partial<ValoresPropiedades>, idioma: Idioma): PropiedadesNotionBrutas {
    const traducidas: PropiedadesNotionBrutas = {};
    for (const clave of CLAVES_PROPIEDAD) {
        if (valores[clave] !== undefined) traducidas[TEXTOS_POR_IDIOMA[idioma].propiedades[clave]] = valores[clave];
    }
    return traducidas;
}

export function construirPropiedadesNotion<I extends Idioma = 'es'>(fila: FilaTablero, idioma?: I): PropiedadesNotion<I> {
    const efectivo: Idioma = idioma ?? 'es';
    return traducirPropiedades(construirValoresPropiedades(fila, efectivo), efectivo) as PropiedadesNotion<I>;
}

// ---------------------------------------------------------------------------
// validarEsquema
// ---------------------------------------------------------------------------

// Los nombres y tipos esperados ("TIPOS_PROPIEDAD", más arriba en este
// módulo, y "TEXTOS_POR_IDIOMA", en `core/i18n.ts`) son los valores que hay
// que tocar para adaptar este script a otro repositorio, junto a los de
// `core/ajustes.ts`.

export function validarEsquema(
    propiedadesDeLaBase: Record<string, { type: string }>,
    idioma: Idioma = 'es',
): PropiedadInvalida[] {
    const problemas: PropiedadInvalida[] = [];
    for (const esperada of esquemaEsperado(idioma)) {
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
