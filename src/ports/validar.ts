/**
 * Puertos de "--validar": solo la lectura de los documentos y los ajustes de
 * carpetas. A propósito NO incluye git/gh, la configuración del entorno
 * (".env") ni Notion: la validación rápida nunca los toca.
 */
import type { AjustesProyecto } from '../core/ajustes';
import type { DependenciasSincronizar } from './sincronizar';

export interface DependenciasValidar {
    raizRepo: string;
    /** El mismo lector de documentos que usa el sync (ver
     *  `DependenciasSincronizar.listarDocumentos`). */
    listarDocumentos: DependenciasSincronizar['listarDocumentos'];
    ajustes: AjustesProyecto;
    log?: (linea: string) => void;
}
