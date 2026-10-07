/**
 * Tipos compartidos del núcleo puro.
 */
import type { Idioma, TEXTOS_POR_IDIOMA } from './i18n';
import type { ClavePropiedad } from './schema';

// ---------------------------------------------------------------------------
// Tipos del núcleo puro
// ---------------------------------------------------------------------------

export interface TareaDocumento {
    id: string;
    nombre: string;
    descripcion: string;
    hecha: boolean;
    esQA: boolean;
}

export interface DocumentoODD {
    slug: string;
    ramas: string[];
    /** Hashes completos de commits hechos directo a la rama base, sin rama
     *  propia ni PR (frontmatter opcional `commits`). Ancla de actividad para trabajo
     *  histórico que ninguna rama viva ni PR puede fechar. Vacío si el
     *  documento no declara la clave. */
    commits: string[];
    titulo: string;
    tareas: TareaDocumento[];
}

export type ResultadoParseoDocumento =
    | { ok: true; documento: DocumentoODD }
    | { ok: false; errores: string[] };

/** Estado interno de una feature. Sus valores coinciden con los nombres en
 *  español por compatibilidad hacia atrás; lo que se escribe en Notion sale
 *  siempre de `TEXTOS_POR_IDIOMA[idioma].estados`. */
export type Estado = 'Terminada' | 'QA pendiente' | 'Sin empezar' | 'En curso';

export interface RamaConFecha {
    nombre: string;
    fecha: string; // ISO
}

export interface PullRequestInfo {
    number: number;
    headRefName: string;
    state: 'OPEN' | 'CLOSED' | 'MERGED';
    createdAt: string;
    mergedAt: string | null;
    closedAt: string | null;
    /** Deliberadamente NUNCA se pide a `gh pr list` (ver `obtenerPRs`) ni se lee
     *  acá: la limpieza de ramas mueve este campo con eventos que no son
     *  trabajo real (ver `calcularActualizado`). Queda opcional en el tipo
     *  solo para poder demostrar en los tests que se ignora aunque llegue. */
    updatedAt?: string;
}

export interface FilaTablero {
    feature: string;
    slug: string;
    estado: Estado;
    progreso: string;
    pendiente: string;
    prsAbiertos: string;
    ramas: string;
    diasSinActividad: number;
    actualizado: string; // ISO
    documento: string; // URL
    huella: string;
}

export type RichTextArray = Array<{ type: 'text'; text: { content: string } }>;

/** Valor de cada propiedad de Notion, por clave interna (sin traducir). */
export interface ValoresPropiedades {
    feature: { title: RichTextArray };
    slug: { rich_text: RichTextArray };
    estado: { select: { name: string } };
    progreso: { rich_text: RichTextArray };
    pendiente: { rich_text: RichTextArray };
    prsAbiertos: { rich_text: RichTextArray };
    ramas: { rich_text: RichTextArray };
    diasSinActividad: { number: number };
    actualizado: { date: { start: string } };
    documento: { url: string };
    huella: { rich_text: RichTextArray };
}

/** Propiedades tal como viajan a Notion, con los nombres visibles del idioma
 *  dado (ej. `Estado` en español, `Status` en inglés). */
export type PropiedadesNotion<I extends Idioma = 'es'> = {
    [K in ClavePropiedad as (typeof TEXTOS_POR_IDIOMA)[I]['propiedades'][K]]: ValoresPropiedades[K];
};

export interface PropiedadInvalida {
    nombre: string;
    motivo: 'faltante' | 'tipo-incorrecto';
    tipoEsperado: string;
    tipoActual?: string;
}

export interface PaginaExistente {
    pageId: string;
    slug: string;
    huella: string;
    /** `created_time` de Notion (ISO), cuando se conoce. Se usa solo para
     *  elegir determinísticamente cuál página se actualiza si el mismo Slug
     *  aparece repetido (ver `resolverDuplicadosPorSlug`); opcional porque
     *  la mayoría de los tests no necesitan declararlo. */
    createdTime?: string;
}

export interface DuplicadoSlug {
    slug: string;
    /** IDs de las páginas duplicadas que NO se actualizan. Nunca se borran. */
    pageIds: string[];
}

export interface PlanSync {
    crear: FilaTablero[];
    actualizar: Array<{ pageId: string; fila: FilaTablero; reescribirCuerpo: boolean }>;
    huerfanas: PaginaExistente[];
}

export interface ParametrosActualizado {
    ramasVivas: RamaConFecha[];
    prs: PullRequestInfo[];
    /** Fechas ISO YA resueltas de cada hash en `DocumentoODD.commits` (la
     *  resolución de hash → fecha es E/S y vive fuera del núcleo puro). */
    fechasCommits?: string[];
    fechaDocumento: string | null;
    hoy: Date;
}

export interface ParametrosConstruirFila {
    documento: DocumentoODD;
    todasLasRamas: RamaConFecha[];
    todosLosPRs: PullRequestInfo[];
    /** Fechas ISO ya resueltas de `documento.commits` (ver `ParametrosActualizado`). */
    fechasCommits?: string[];
    fechaDocumento: string | null;
    hoy: Date;
    ownerRepo: string;
    /** Idioma de los textos de la fila (ej. "2/3 tareas"). Por defecto `es`. */
    idioma?: Idioma;
}

/** Forma laxa de un objeto "properties" de una página de Notion: alcanza para
 *  leer los campos rich_text que este script necesita (Slug, Huella), sin
 *  tipar el esquema completo de la API. */
export type PropiedadesNotionBrutas = Record<string, unknown>;
