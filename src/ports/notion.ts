/**
 * Puerto hacia Notion: el `fetch` inyectable, el reloj de espera y el
 * cliente que usa la orquestación.
 */
import type { PropiedadEsquemaNotion, PropiedadesNotionBrutas, TareaDocumento } from '../core/types';

export type FetchInyectado = (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; headers: { get(nombre: string): string | null }; text(): Promise<string> }>;

export type Dormir = (ms: number) => Promise<void>;

export interface Credenciales {
    token: string;
    /** Base de Features (`NOTION_TABLERO_DB_ID`). */
    databaseId: string;
    /** Base de Tareas (`NOTION_TAREAS_DB_ID`), opcional: ausente → la
     *  entidad Tarea no se escribe en Notion. */
    databaseIdTareas?: string;
}

export interface ClienteNotion {
    obtenerDataSourceId(databaseId: string): Promise<string>;
    /** Propiedades del data source, por nombre visible (con el destino de
     *  cada relación, ver `PropiedadEsquemaNotion`). */
    obtenerEsquema(dataSourceId: string): Promise<Record<string, PropiedadEsquemaNotion>>;
    listarTodasLasPaginas(
        dataSourceId: string,
    ): Promise<Array<{ id: string; properties: PropiedadesNotionBrutas; createdTime: string }>>;
    /** `propiedades` (ya con los nombres visibles del idioma del tablero)
     *  puede venir SIN la huella: el llamador la escribe aparte, al final,
     *  una vez que el cuerpo quedó completo (ver "Orquestación"). */
    crearPagina(
        dataSourceId: string,
        propiedades: PropiedadesNotionBrutas,
        tareas: TareaDocumento[],
    ): Promise<string>;
    actualizarPropiedades(pageId: string, propiedades: PropiedadesNotionBrutas): Promise<void>;
    reescribirCuerpo(pageId: string, tareas: TareaDocumento[]): Promise<void>;
}
