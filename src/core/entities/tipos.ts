/**
 * Contrato de una entidad sincronizable (hoy Feature; más adelante Tarea).
 *
 * Un descriptor reúne TODO lo que cambia de una entidad a otra: la carpeta de
 * sus documentos, el esquema de su base de Notion (claves internas → tipo de
 * Notion), los textos visibles por idioma, la regla de estado y el armado de
 * su fila y de los valores de sus propiedades. La orquestación
 * (`sincronizarEntidad`) y las funciones genéricas de `core/schema.ts` solo
 * hablan con este contrato, nunca con una entidad concreta.
 */
import type { Idioma } from '../i18n';
import type { DocumentoODD, PullRequestInfo, RamaConFecha, TareaDocumento } from '../types';

/** Tipos de propiedad de Notion que alguna entidad usa o va a usar. */
export type TipoPropiedadNotion =
    | 'title'
    | 'rich_text'
    | 'select'
    | 'multi_select'
    | 'number'
    | 'date'
    | 'url'
    | 'people'
    | 'relation';

/** Lo que el tablero de Notion muestra de una entidad en un idioma. */
export interface TextosEntidad<C extends string, E extends string> {
    /** Nombre visible en Notion de cada propiedad. */
    propiedades: Readonly<Record<C, string>>;
    /** Valor visible en Notion de cada estado interno. */
    estados: Readonly<Record<E, string>>;
    /** Texto de la propiedad de progreso, ej. "2/3 tareas". */
    progreso: (hechas: number, total: number) => string;
}

/**
 * La parte estática de una entidad: su esquema de Notion y sus textos. Es lo
 * único que necesitan la validación del esquema, la traducción de claves
 * internas a nombres visibles y la lectura de páginas existentes.
 */
export interface EsquemaEntidad<C extends string = string, E extends string = string> {
    /** Tipo de Notion de cada propiedad, por clave interna. El orden de las
     *  claves es el orden en que se validan y se escriben. */
    tiposPropiedad: Readonly<Record<C, TipoPropiedadNotion>>;
    /** Clave de la propiedad `title` de la base. */
    claveTitulo: C;
    /** Clave de la propiedad que identifica la página (upsert por Slug). */
    claveSlug: C;
    /** Clave de la huella del cuerpo, que se escribe siempre al final. */
    claveHuella: C;
    /** Propiedades que son de Notion, no del repositorio (ej. un Responsable
     *  asignado a mano): se validan en el esquema, pero la sincronización
     *  NUNCA las escribe, aunque el armado de valores las incluyera. */
    propiedadesDeNotion: readonly C[];
    textos: Readonly<Record<Idioma, TextosEntidad<C, E>>>;
}

/** Lo mínimo que la orquestación lee de una fila calculada. */
export interface FilaEntidad {
    slug: string;
    huella: string;
}

/** Datos del repositorio que necesita el armado de una fila. */
export interface ParametrosFilaEntidad<D extends DocumentoODD = DocumentoODD> {
    documento: D;
    todasLasRamas: RamaConFecha[];
    todosLosPRs: PullRequestInfo[];
    /** Fechas ISO ya resueltas de `documento.commits`. */
    fechasCommits?: string[];
    fechaDocumento: string | null;
    hoy: Date;
    ownerRepo: string;
    /** Idioma de los textos de la fila. Por defecto `es`. */
    idioma?: Idioma;
}

export type ResultadoParseoEntidad<D extends DocumentoODD> =
    | { ok: true; documento: D }
    | { ok: false; errores: string[] };

/** Descriptor completo de una entidad: esquema + comportamiento. */
export interface DescriptorEntidad<
    C extends string = string,
    E extends string = string,
    D extends DocumentoODD = DocumentoODD,
    F extends FilaEntidad = FilaEntidad,
> extends EsquemaEntidad<C, E> {
    /** Identificador estable de la entidad (ej. `'feature'`). */
    clave: string;
    /** Carpeta de sus documentos, relativa a la raíz del repositorio. */
    carpeta: string;
    parsearDocumento(slug: string, contenido: string): ResultadoParseoEntidad<D>;
    /** Regla de estado a partir de las tareas del documento y la cantidad de
     *  PRs abiertos que matchean sus ramas. */
    derivarEstado(tareas: TareaDocumento[], cantidadPrsAbiertos: number): E;
    construirFila(parametros: ParametrosFilaEntidad<D>): F;
    /** Valores de las propiedades por clave interna (sin traducir). */
    construirValoresPropiedades(fila: F, idioma: Idioma): Partial<Record<C, unknown>>;
    /** Forma legible de la fila para "--dry-run" sin credenciales. */
    formatearFilaLegible(fila: F): string;
}
