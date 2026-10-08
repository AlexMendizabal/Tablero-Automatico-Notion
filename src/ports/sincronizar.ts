/**
 * Puertos de la orquestación: lo que `sincronizar`/`sincronizarEntidad`
 * necesitan del mundo exterior (documentos, git/gh, configuración y Notion).
 * La orquestación nunca importa adaptadores: los recibe ya compuestos (ver
 * `componerDependencias` en `entrypoints/cli.ts`, la raíz de composición).
 */
import type { AjustesProyecto } from '../core/ajustes';
import type { AutorCommit } from '../core/contribuyentes';
import type { Idioma } from '../core/i18n';
import type { PullRequestInfo, RamaConFecha } from '../core/types';
import type { ClienteNotion, Credenciales } from './notion';

export type EjecutarComando = (comando: string, argumentos: string[]) => string;

/** Lo que la orquestación consulta del repositorio (git) y de GitHub (gh). */
export interface RepositorioGit {
    /** `true` si el clon es superficial. LANZA si git no puede correr: la
     *  orquestación lo distingue de un commit inexistente. */
    esRepoSuperficial(): boolean;
    /** Fecha ISO de un commit por hash; `null` si no existe. */
    fechaCommit(sha: string): string | null;
    /** Fecha ISO del último commit que tocó `rutaRelativa`; `null` si no hay. */
    fechaDocumento(rutaRelativa: string): string | null;
    ramasConFecha(): RamaConFecha[];
    /** PRs del repositorio, con el login de su autor cuando se conoce. */
    prs(): PullRequestInfo[];
    ownerRepo(): string;
    /** Ref completa de la rama base contra la que se comparan las ramas de
     *  un documento: `origin/<ramaBase>` si existe, si no la rama local;
     *  `null` si no existe ninguna. */
    refRamaBase(ramaBase: string): string | null;
    /** Autores (y coautores) de los commits de `rama` (local u `origin/`)
     *  que no están en `base` (una ref de `refRamaBase`). En los tres
     *  métodos de autores, `null` = no se pudieron leer (git o gh fallaron),
     *  distinto de `[]` (no hay ninguno). */
    autoresDeRango(base: string, rama: string): AutorCommit[] | null;
    /** Autor (y coautores) de un commit por hash. */
    autoresDeCommit(sha: string): AutorCommit[] | null;
    /** Autores (y coautores) de los commits de un PR, según GitHub. */
    autoresDePR(numero: number): AutorCommit[] | null;
}

/** Lectura de la configuración del entorno, en el momento de la llamada. */
export interface ConfiguracionEntorno {
    /** Carga el `.env` de `raizRepo` y devuelve las credenciales de Notion,
     *  o `null` si falta alguna. */
    cargarCredenciales(raizRepo: string): Credenciales | null;
    /** Valor crudo de `BOARD_LANGUAGE` (se lee DESPUÉS de cargar el `.env`). */
    leerBoardLanguage(): string | undefined;
}

export interface DependenciasSincronizar {
    raizRepo: string;
    /** Documentos de la carpeta de la entidad (`DescriptorEntidad.carpeta`,
     *  relativa a `raizRepo`). Lanza si la carpeta falta o está vacía; con
     *  `opcional` (Tareas), en esos dos casos devuelve `[]`. */
    listarDocumentos: (
        carpeta: string,
        opciones?: { opcional?: boolean },
    ) => Array<{ slug: string; contenido: string }>;
    repositorio: RepositorioGit;
    configuracion: ConfiguracionEntorno;
    /** Cliente de Notion autenticado con `token`. */
    crearClienteNotion: (token: string) => ClienteNotion;
    /** Ajustes por proyecto ya resueltos (carpetas de Features y Tareas,
     *  rama base). */
    ajustes: AjustesProyecto;
    hoy?: Date;
    /** `undefined` → se cargan con `configuracion.cargarCredenciales` (uso
     *  real). `null` → sin credenciales (tests). Objeto → explícitas. */
    credenciales?: Credenciales | null;
    log?: (linea: string) => void;
    /** `undefined` → se resuelve de `BOARD_LANGUAGE` (después de cargar el
     *  `.env`, ver `resolverIdiomaTablero`). Valor → idioma explícito (tests). */
    idioma?: Idioma;
}
