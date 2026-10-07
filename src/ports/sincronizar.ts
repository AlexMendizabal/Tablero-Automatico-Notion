/**
 * Puertos de la orquestación: el comando (git/gh) inyectable y las
 * dependencias de `sincronizar`.
 */
import type { Idioma } from '../core/i18n';
import type { Credenciales, Dormir, FetchInyectado } from './notion';

export type EjecutarComando = (comando: string, argumentos: string[]) => string;

export interface DependenciasSincronizar {
    raizRepo: string;
    ejecutar: EjecutarComando;
    fetchInyectado: FetchInyectado;
    listarDocumentos: () => Array<{ slug: string; contenido: string }>;
    dormir?: Dormir;
    hoy?: Date;
    /** `undefined` → se cargan desde el entorno (uso real, `principal()`).
     *  `null` → sin credenciales (tests). Objeto → credenciales explícitas. */
    credenciales?: Credenciales | null;
    log?: (linea: string) => void;
    /** `undefined` → se resuelve de `BOARD_LANGUAGE` (después de cargar el
     *  `.env`, ver `resolverIdiomaTablero`). Valor → idioma explícito (tests). */
    idioma?: Idioma;
}
