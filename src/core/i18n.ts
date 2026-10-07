/**
 * Idioma del tablero de Notion: textos visibles por idioma y la
 * interpretación de `BOARD_LANGUAGE`.
 */
import type { ClavePropiedad } from './schema';
import type { Estado } from './types';

/** Idioma del tablero de Notion: nombres de las propiedades, valores del
 *  select de estado y textos escritos en las filas. Variable de entorno:
 *  `BOARD_LANGUAGE` (`es` por defecto, o `en`; ver `resolverIdiomaTablero`).
 *  No afecta a los documentos ODD: el parser acepta siempre las palabras
 *  clave en los dos idiomas. */
export type Idioma = 'es' | 'en';

interface TextosIdioma {
    /** Nombre visible en Notion de cada propiedad. */
    propiedades: Record<ClavePropiedad, string>;
    /** Valor visible en Notion de cada estado interno (ver `Estado`). */
    estados: Record<Estado, string>;
    /** Texto de la propiedad de progreso, ej. "2/3 tareas". */
    progreso: (hechas: number, total: number) => string;
}

/**
 * Lo que el tablero de Notion muestra en cada idioma. Las propiedades
 * (nombre + `TIPOS_PROPIEDAD`) son las que este script espera encontrar,
 * exactas, en la base de Notion (`validarEsquema` las compara contra el
 * esquema real antes de escribir nada). Renombrar o retipar una columna en
 * Notion exige cambiar los dos lados del contrato: este diccionario Y la base
 * de Notion — ninguno de los dos se puede descubrir automáticamente del
 * otro. El `satisfies` obliga a que cada idioma defina todas las claves.
 */
export const TEXTOS_POR_IDIOMA = {
    es: {
        propiedades: {
            feature: 'Feature',
            slug: 'Slug',
            estado: 'Estado',
            progreso: 'Progreso',
            pendiente: 'Pendiente',
            prsAbiertos: 'PRs abiertos',
            ramas: 'Ramas',
            diasSinActividad: 'Días sin actividad',
            actualizado: 'Actualizado',
            documento: 'Documento',
            huella: 'Huella',
        },
        estados: {
            Terminada: 'Terminada',
            'QA pendiente': 'QA pendiente',
            'Sin empezar': 'Sin empezar',
            'En curso': 'En curso',
        },
        progreso: (hechas: number, total: number) => `${hechas}/${total} tareas`,
    },
    en: {
        propiedades: {
            feature: 'Feature',
            slug: 'Slug',
            estado: 'Status',
            progreso: 'Progress',
            pendiente: 'Pending',
            prsAbiertos: 'Open PRs',
            ramas: 'Branches',
            diasSinActividad: 'Days inactive',
            actualizado: 'Updated',
            documento: 'Document',
            huella: 'Fingerprint',
        },
        estados: {
            Terminada: 'Done',
            'QA pendiente': 'QA pending',
            'Sin empezar': 'Not started',
            'En curso': 'In progress',
        },
        progreso: (hechas: number, total: number) => `${hechas}/${total} tasks`,
    },
} as const satisfies Record<Idioma, TextosIdioma>;

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
