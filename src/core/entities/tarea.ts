/**
 * Entidad Tarea ("tarea avanzada"): un documento por tarea
 * (`odd/tareas/*.md`), nacido en el repositorio y seguido igual que una
 * Feature, con una feature padre opcional (frontmatter `feature`). Una fila
 * por tarea en su propia base de Notion.
 *
 * Por ahora la base de Tareas tiene las mismas columnas que el tablero de
 * Features, con "Tarea" ("Task" en inglés) como título. El slug de la feature
 * padre viaja en la fila (se muestra en "--dry-run"), pero todavía no es una
 * columna de Notion.
 */
import { AJUSTES_POR_DEFECTO, type AjustesProyecto } from '../ajustes';
import type { Idioma } from '../i18n';
import { FORMATO_FRONTMATTER_TAREA, parsearDocumentoConFormato } from '../parse';
import { derivarEstado } from '../status';
import type { DocumentoODD, Estado, FilaTablero } from '../types';
import {
    construirFilaEnCarpeta,
    construirValoresPropiedades as construirValoresPropiedadesFeature,
    TEXTOS_POR_IDIOMA as TEXTOS_FEATURE,
    TIPOS_PROPIEDAD as TIPOS_PROPIEDAD_FEATURE,
} from './feature';
import type { DescriptorEntidad, EsquemaEntidad, ResultadoParseoEntidad, TextosEntidad } from './tipos';

// ---------------------------------------------------------------------------
// Documento y fila
// ---------------------------------------------------------------------------

export interface DocumentoTarea extends DocumentoODD {
    /** Slug de la feature padre (frontmatter opcional `feature`); `null` si
     *  la tarea no declara padre. */
    feature: string | null;
}

/** Fila de una tarea: la de Features con `tarea` como título y el slug de
 *  la feature padre (que no se escribe en Notion). */
export type FilaTarea = Omit<FilaTablero, 'feature'> & {
    tarea: string;
    featurePadre: string | null;
};

// ---------------------------------------------------------------------------
// Esquema y textos
// ---------------------------------------------------------------------------

/** Las propiedades de Features, con `tarea` como título en vez de `feature`. */
const { feature: _tituloFeature, ...TIPOS_SIN_TITULO } = TIPOS_PROPIEDAD_FEATURE;
export const TIPOS_PROPIEDAD_TAREA = { tarea: 'title', ...TIPOS_SIN_TITULO } as const;

export type ClavePropiedadTarea = keyof typeof TIPOS_PROPIEDAD_TAREA;

/** Textos de Features con el título renombrado: los demás nombres visibles,
 *  los estados y el texto de progreso son idénticos. */
function textosTarea(idioma: Idioma, titulo: string): TextosEntidad<ClavePropiedadTarea, Estado> {
    const { feature: _titulo, ...propiedades } = TEXTOS_FEATURE[idioma].propiedades;
    return {
        propiedades: { tarea: titulo, ...propiedades },
        estados: TEXTOS_FEATURE[idioma].estados,
        progreso: TEXTOS_FEATURE[idioma].progreso,
    };
}

export const TEXTOS_TAREA_POR_IDIOMA: Readonly<Record<Idioma, TextosEntidad<ClavePropiedadTarea, Estado>>> = {
    es: textosTarea('es', 'Tarea'),
    en: textosTarea('en', 'Task'),
};

/** Parte estática del descriptor de Tarea (no depende de ajustes). */
export const ESQUEMA_TAREA: EsquemaEntidad<ClavePropiedadTarea, Estado> = {
    tiposPropiedad: TIPOS_PROPIEDAD_TAREA,
    claveTitulo: 'tarea',
    claveSlug: 'slug',
    claveHuella: 'huella',
    // Todavía sin propiedades de Notion (el Responsable llega más adelante).
    propiedadesDeNotion: [],
    textos: TEXTOS_TAREA_POR_IDIOMA,
};

// ---------------------------------------------------------------------------
// Comportamiento
// ---------------------------------------------------------------------------

export function parsearDocumentoTarea(slug: string, contenido: string): ResultadoParseoEntidad<DocumentoTarea> {
    const resultado = parsearDocumentoConFormato(slug, contenido, FORMATO_FRONTMATTER_TAREA);
    if (!resultado.ok) return resultado;
    return { ok: true, documento: { ...resultado.documento, feature: resultado.feature } };
}

/** La fila de Features equivalente (para reusar su armado de valores). */
function comoFilaFeature(fila: FilaTarea): FilaTablero {
    const { tarea, featurePadre: _padre, ...resto } = fila;
    return { feature: tarea, ...resto };
}

export function construirValoresPropiedadesTarea(
    fila: FilaTarea,
    idioma: Idioma = 'es',
): Partial<Record<ClavePropiedadTarea, unknown>> {
    const { feature: titulo, ...resto } = construirValoresPropiedadesFeature(comoFilaFeature(fila), idioma);
    return { tarea: titulo, ...resto };
}

export const ENCABEZADO_FILA_LEGIBLE_TAREA = 'slug | feature | estado | progreso | PRs abiertos | días | actualizado';

/** Como la forma legible de Features, con el slug de la feature padre (o
 *  "—") como segunda columna. */
export function formatearFilaLegibleTarea(fila: FilaTarea): string {
    return [
        fila.slug.padEnd(28),
        (fila.featurePadre ?? '—').padEnd(28),
        fila.estado.padEnd(14),
        fila.progreso.padEnd(12),
        (fila.prsAbiertos || '—').padEnd(16),
        `${fila.diasSinActividad}d`.padEnd(6),
        fila.actualizado,
    ].join(' | ');
}

// ---------------------------------------------------------------------------
// Descriptor
// ---------------------------------------------------------------------------

export type DescriptorTarea = DescriptorEntidad<ClavePropiedadTarea, Estado, DocumentoTarea, FilaTarea>;

/** Descriptor de Tarea con los ajustes del proyecto (carpeta de Tareas y
 *  rama base del enlace "Documento") ya resueltos por quien lo compone. */
export function crearDescriptorTarea(ajustes: AjustesProyecto = AJUSTES_POR_DEFECTO): DescriptorTarea {
    return {
        ...ESQUEMA_TAREA,
        clave: 'tarea',
        carpeta: ajustes.carpetaTareas,
        parsearDocumento: parsearDocumentoTarea,
        derivarEstado,
        construirFila: (parametros) => {
            const { feature: titulo, ...resto } = construirFilaEnCarpeta(
                parametros,
                ajustes.carpetaTareas,
                ajustes.ramaBaseDocumento,
            );
            return { tarea: titulo, ...resto, featurePadre: parametros.documento.feature };
        },
        construirValoresPropiedades: construirValoresPropiedadesTarea,
        formatearFilaLegible: formatearFilaLegibleTarea,
        encabezadoFilaLegible: ENCABEZADO_FILA_LEGIBLE_TAREA,
    };
}
