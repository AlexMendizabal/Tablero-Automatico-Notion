/**
 * Puertos de la orquestación: el comando (git/gh) inyectable y las
 * dependencias de `sincronizar`.
 */
import type { AjustesProyecto } from '../core/ajustes';
import type { Idioma } from '../core/i18n';
import type { Credenciales, Dormir, FetchInyectado } from './notion';

export type EjecutarComando = (comando: string, argumentos: string[]) => string;

export interface DependenciasSincronizar {
    raizRepo: string;
    ejecutar: EjecutarComando;
    fetchInyectado: FetchInyectado;
    /** Documentos de la carpeta de la entidad (`DescriptorEntidad.carpeta`,
     *  relativa a `raizRepo`). Lanza si la carpeta falta o está vacía. */
    listarDocumentos: (carpeta: string) => Array<{ slug: string; contenido: string }>;
    dormir?: Dormir;
    hoy?: Date;
    /** `undefined` → se cargan desde el entorno (uso real, `principal()`).
     *  `null` → sin credenciales (tests). Objeto → credenciales explícitas. */
    credenciales?: Credenciales | null;
    log?: (linea: string) => void;
    /** `undefined` → se resuelve de `BOARD_LANGUAGE` (después de cargar el
     *  `.env`, ver `resolverIdiomaTablero`). Valor → idioma explícito (tests). */
    idioma?: Idioma;
    /** `undefined` → los de `TABLERO_CARPETA`/`TABLERO_RAMA_BASE`, leídos al
     *  cargar `adapters/config.ts` (uso real). Valor → ajustes explícitos. */
    ajustes?: AjustesProyecto;
}
