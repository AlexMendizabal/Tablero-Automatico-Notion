/**
 * Entidad Tarea ("tarea avanzada"): un documento por tarea
 * (`odd/tareas/*.md`), nacido en el repositorio y seguido igual que una
 * Feature, con una feature padre opcional (frontmatter `feature`). Una fila
 * por tarea en su propia base de Notion.
 *
 * La base de Tareas tiene las mismas columnas que el tablero de Features, con
 * "Tarea" ("Task" en inglés) como título, más dos: "Feature", una relación
 * con la base de Features (la feature padre, resuelta a su página con
 * `RelacionFeatures`), y "Responsable" ("Assignee"), una propiedad people
 * que se asigna a mano en Notion y la sincronización nunca escribe.
 */
import { AJUSTES_POR_DEFECTO, type AjustesProyecto } from '../ajustes';
import type { Idioma } from '../i18n';
import { FORMATO_FRONTMATTER_TAREA, parsearDocumentoConFormato } from '../parse';
import { derivarEstado } from '../status';
import type { DocumentoODD, Estado, FilaTablero } from '../types';
import {
    construirFilaEnCarpeta,
    contribuyentesLegibles,
    construirValoresPropiedades as construirValoresPropiedadesFeature,
    TEXTOS_POR_IDIOMA as TEXTOS_FEATURE,
    TIPOS_PROPIEDAD as TIPOS_PROPIEDAD_FEATURE,
} from './feature';
import type {
    AvisoDocumento,
    DescriptorEntidad,
    EsquemaEntidad,
    ResultadoParseoEntidad,
    TextosEntidad,
} from './tipos';

// ---------------------------------------------------------------------------
// Documento y fila
// ---------------------------------------------------------------------------

export interface DocumentoTarea extends DocumentoODD {
    /** Slug de la feature padre (frontmatter opcional `feature`); `null` si
     *  la tarea no declara padre. */
    feature: string | null;
}

/** Fila de una tarea: la de Features con `tarea` como título y el slug de
 *  la feature padre (que viaja a Notion como relación, ver
 *  `RelacionFeatures`). */
export type FilaTarea = Omit<FilaTablero, 'feature'> & {
    tarea: string;
    featurePadre: string | null;
};

// ---------------------------------------------------------------------------
// Esquema y textos
// ---------------------------------------------------------------------------

/** Las propiedades de Features, con `tarea` como título en vez de `feature`. */
const { feature: _tituloFeature, ...TIPOS_SIN_TITULO } = TIPOS_PROPIEDAD_FEATURE;
export const TIPOS_PROPIEDAD_TAREA = {
    tarea: 'title',
    ...TIPOS_SIN_TITULO,
    feature: 'relation',
    responsable: 'people',
} as const;

export type ClavePropiedadTarea = keyof typeof TIPOS_PROPIEDAD_TAREA;

/** Textos de Features con el título renombrado: los demás nombres visibles,
 *  los estados y el texto de progreso son idénticos. */
function textosTarea(
    idioma: Idioma,
    titulo: string,
    responsable: string,
): TextosEntidad<ClavePropiedadTarea, Estado> {
    const { feature: _titulo, ...propiedades } = TEXTOS_FEATURE[idioma].propiedades;
    return {
        propiedades: { tarea: titulo, ...propiedades, feature: 'Feature', responsable },
        estados: TEXTOS_FEATURE[idioma].estados,
        progreso: TEXTOS_FEATURE[idioma].progreso,
    };
}

export const TEXTOS_TAREA_POR_IDIOMA: Readonly<Record<Idioma, TextosEntidad<ClavePropiedadTarea, Estado>>> = {
    es: textosTarea('es', 'Tarea', 'Responsable'),
    en: textosTarea('en', 'Task', 'Assignee'),
};

/** Parte estática del descriptor de Tarea (no depende de ajustes). */
export const ESQUEMA_TAREA: EsquemaEntidad<ClavePropiedadTarea, Estado> = {
    tiposPropiedad: TIPOS_PROPIEDAD_TAREA,
    claveTitulo: 'tarea',
    claveSlug: 'slug',
    claveHuella: 'huella',
    // El Responsable se asigna a mano en Notion: se valida, nunca se escribe.
    propiedadesDeNotion: ['responsable'],
    // Como en Features: sin la columna en la base, no se escribe.
    propiedadesOpcionales: ['contribuyentes'],
    textos: TEXTOS_TAREA_POR_IDIOMA,
};

/** Páginas de la base de Features, para resolver la relación "Feature" de
 *  cada tarea: `paginas` (slug → id de página, lo que dejó la sincronización
 *  de Features) y, en "--dry-run", `porCrear` (slugs de las páginas que se
 *  crearían, todavía sin id). */
export interface RelacionFeatures {
    paginas: ReadonlyMap<string, string>;
    porCrear?: ReadonlySet<string>;
}

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

/** Valores de las propiedades de una tarea. Con `relacion`, también la de
 *  "Feature": la página de la feature padre, o vacía si no tiene padre o su
 *  padre no tiene página (sin `relacion` no se incluye y no se escribe).
 *  "Responsable" nunca se incluye (y, aunque se incluyera, no se escribiría:
 *  es una propiedad de Notion, ver `traducirPropiedadesEntidad`). */
export function construirValoresPropiedadesTarea(
    fila: FilaTarea,
    idioma: Idioma = 'es',
    relacion?: RelacionFeatures,
): Partial<Record<ClavePropiedadTarea, unknown>> {
    const { feature: titulo, ...resto } = construirValoresPropiedadesFeature(comoFilaFeature(fila), idioma);
    if (!relacion) return { tarea: titulo, ...resto };
    const pageId = fila.featurePadre === null ? undefined : relacion.paginas.get(fila.featurePadre);
    return { tarea: titulo, ...resto, feature: { relation: pageId === undefined ? [] : [{ id: pageId }] } };
}

/** Avisos de relación vacía: una tarea cuyo padre es un documento de
 *  Features (si no lo es, ya avisa `avisosFeaturePadre`) pero no tiene
 *  página en la base de Features ni se crearía. */
export function avisosRelacionFeature(
    documentos: DocumentoTarea[],
    relacion: RelacionFeatures,
    slugsFeatures?: ReadonlySet<string>,
): AvisoDocumento[] {
    return documentos
        .filter(
            (documento) =>
                documento.feature !== null &&
                (slugsFeatures === undefined || slugsFeatures.has(documento.feature)) &&
                !relacion.paginas.has(documento.feature) &&
                !relacion.porCrear?.has(documento.feature),
        )
        .map((documento) => ({
            slug: documento.slug,
            mensajes: [
                `La feature padre "${documento.feature}" no tiene página en la base de Features de Notion (¿su documento tiene errores de formato?): la relación "Feature" queda vacía.`,
            ],
        }));
}

/** Detalle del plan de "--dry-run" con credenciales: a qué página de
 *  Features apuntaría la relación de cada tarea. */
export function detallePlanRelacion(filas: FilaTarea[], relacion: RelacionFeatures): string[] {
    return [
        'Relación "Feature":',
        ...filas.map((fila) => {
            const padre = fila.featurePadre;
            if (padre === null) return `  ${fila.slug} → (sin feature padre: relación vacía)`;
            const pageId = relacion.paginas.get(padre);
            if (pageId !== undefined) return `  ${fila.slug} → ${padre} (página ${pageId})`;
            if (relacion.porCrear?.has(padre)) return `  ${fila.slug} → ${padre} (página nueva: se crea con la Feature)`;
            return `  ${fila.slug} → ${padre} (sin página en Notion: relación vacía)`;
        }),
    ];
}

export const ENCABEZADO_FILA_LEGIBLE_TAREA =
    'slug | feature | estado | progreso | PRs abiertos | días | actualizado | contribuyentes';

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
        contribuyentesLegibles(fila.contribuyentes),
    ].join(' | ');
}

// ---------------------------------------------------------------------------
// Descriptor
// ---------------------------------------------------------------------------

export type DescriptorTarea = DescriptorEntidad<ClavePropiedadTarea, Estado, DocumentoTarea, FilaTarea>;

/** Avisos de feature padre inexistente: una tarea cuyo `feature` no es el
 *  slug de ningún documento de `slugsFeatures` (la carpeta de Features). */
export function avisosFeaturePadre(
    documentos: DocumentoTarea[],
    slugsFeatures: ReadonlySet<string>,
    carpetaFeatures: string,
): AvisoDocumento[] {
    return documentos
        .filter((documento) => documento.feature !== null && !slugsFeatures.has(documento.feature))
        .map((documento) => ({
            slug: documento.slug,
            mensajes: [
                `La feature padre "${documento.feature}" no existe: no hay ningún documento "${documento.feature}.md" en "${carpetaFeatures}".`,
            ],
        }));
}

/** Descriptor de Tarea con los ajustes del proyecto (carpeta de Tareas y
 *  rama base del enlace "Documento") ya resueltos por quien lo compone.
 *  Con `slugsFeatures` (los slugs de los documentos de Features), avisa de
 *  las tareas cuya feature padre no existe; sin él, no valida el padre. Con
 *  `relacion` (las páginas de Features), escribe la relación "Feature",
 *  avisa de las que quedan vacías y la detalla en el plan de "--dry-run";
 *  sin ella, la relación no se escribe. */
export function crearDescriptorTarea(
    ajustes: AjustesProyecto = AJUSTES_POR_DEFECTO,
    slugsFeatures?: ReadonlySet<string>,
    relacion?: RelacionFeatures,
): DescriptorTarea {
    const avisos = (documentos: DocumentoTarea[]): AvisoDocumento[] => [
        ...(slugsFeatures ? avisosFeaturePadre(documentos, slugsFeatures, ajustes.carpetaFeatures) : []),
        ...(relacion ? avisosRelacionFeature(documentos, relacion, slugsFeatures) : []),
    ];
    return {
        ...ESQUEMA_TAREA,
        clave: 'tarea',
        carpeta: ajustes.carpetaTareas,
        variableBaseNotion: 'NOTION_TAREAS_DB_ID',
        nombreBase: 'Tareas',
        ...(slugsFeatures || relacion ? { avisosDocumentos: avisos } : {}),
        ...(relacion ? { detallePlan: (filas: FilaTarea[]) => detallePlanRelacion(filas, relacion) } : {}),
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
        construirValoresPropiedades: (fila, idioma) => construirValoresPropiedadesTarea(fila, idioma, relacion),
        formatearFilaLegible: formatearFilaLegibleTarea,
        encabezadoFilaLegible: ENCABEZADO_FILA_LEGIBLE_TAREA,
    };
}
