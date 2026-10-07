/**
 * Tipos compartidos del núcleo puro.
 */
import type { ClavePropiedad, TEXTOS_POR_IDIOMA } from './entities/feature';
import type { AutorCommit } from './contribuyentes';
import type { Idioma } from './i18n';

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
    /** Login de GitHub del autor del PR (ausente si es un bot o `gh` no lo
     *  informa). Fuente de los contribuyentes del documento. */
    autor?: string;
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
    /** Contribuyentes (logins de GitHub o nombres), ya normalizados y
     *  ordenados (ver `calcularContribuyentes`). */
    contribuyentes: string[];
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
    contribuyentes: { multi_select: Array<{ name: string }> };
    huella: { rich_text: RichTextArray };
}

/** Propiedades tal como viajan a Notion, con los nombres visibles del idioma
 *  dado (ej. `Estado` en español, `Status` en inglés). */
export type PropiedadesNotion<I extends Idioma = 'es'> = {
    [K in ClavePropiedad as (typeof TEXTOS_POR_IDIOMA)[I]['propiedades'][K]]: ValoresPropiedades[K];
};

/** Una propiedad del esquema de una base de Notion, tal como la devuelve
 *  "retrieve a data source" (Notion-Version 2025-09-03): su tipo y, si es una
 *  relación, la base a la que apunta (`relation.data_source_id`). */
export interface PropiedadEsquemaNotion {
    type: string;
    relation?: { data_source_id?: string; database_id?: string };
}

export interface PropiedadInvalida {
    nombre: string;
    /** `relacion-incorrecta`: el tipo es `relation`, pero apunta a otra base
     *  (ver `destinoEsperado`/`destinoActual`). */
    motivo: 'faltante' | 'tipo-incorrecto' | 'relacion-incorrecta';
    tipoEsperado: string;
    tipoActual?: string;
    /** Data source esperado y real de una relación (`relacion-incorrecta`). */
    destinoEsperado?: string;
    destinoActual?: string;
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

/** Plan de escritura de una entidad; `F` es el tipo de su fila (por defecto,
 *  la de Feature). */
export interface PlanSync<F extends { slug: string; huella: string } = FilaTablero> {
    crear: F[];
    actualizar: Array<{ pageId: string; fila: F; reescribirCuerpo: boolean }>;
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
    /** Autores de los commits del documento (los de sus ramas que no están
     *  en la rama base y los de sus anclas de `commits`), ya leídos de git. */
    autoresCommits?: AutorCommit[];
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
