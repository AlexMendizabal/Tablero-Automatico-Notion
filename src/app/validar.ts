/**
 * Validación rápida ("--validar"): lee y parsea los documentos de Features y
 * de Tareas con los mismos parsers y avisos que el sync, sin cargar el
 * ".env", sin Notion y sin git/gh. Por eso no detecta los commits de
 * "commits" que no existen en el repositorio: eso queda para "--dry-run".
 */
import { validarAjustesProyecto } from '../core/ajustes';
import { crearDescriptorFeature } from '../core/entities/feature';
import { crearDescriptorTarea } from '../core/entities/tarea';
import type { AvisoDocumento, DescriptorEntidad, FilaEntidad } from '../core/entities/tipos';
import { mensajeDeError } from '../core/errores';
import type { DocumentoODD } from '../core/types';
import type { DependenciasValidar } from '../ports/validar';
import { imprimirAvisos, imprimirErroresDeFormato } from './sincronizar';

export const ENCABEZADO_VALIDAR =
    '--validar: solo se leyeron y parsearon los documentos (sin .env, sin Notion, sin git/gh).';

/** Resultado de validar los documentos de una entidad. */
export interface ValidacionEntidad {
    /** Slugs de todos los documentos leídos (válidos o no); ausente si la
     *  carpeta no se pudo leer. */
    slugsDocumentos?: string[];
    erroresDeFormato: Array<{ slug: string; errores: string[] }>;
    avisos: AvisoDocumento[];
    /** Carpeta faltante o ilegible (mismo mensaje que el sync). */
    errorEntorno?: string;
}

export interface ResumenValidacion {
    /** 1 si hubo errores de formato, de entorno o de ajustes; si no, 0. */
    codigo: number;
    /** Ajustes de carpetas inválidos: no se leyó ningún documento. */
    errorAjustes?: string;
    features: ValidacionEntidad;
    /** Solo si la carpeta de Tareas tiene documentos (o no se pudo leer). */
    tareas?: ValidacionEntidad;
}

/** Parsea `documentos` con el descriptor y calcula sus avisos, igual que
 *  `sincronizarEntidad` antes de tocar git/gh. */
function validarDocumentos<D extends DocumentoODD>(
    descriptor: Pick<DescriptorEntidad<string, string, D, FilaEntidad>, 'parsearDocumento' | 'avisosDocumentos'>,
    documentos: Array<{ slug: string; contenido: string }>,
): ValidacionEntidad {
    const validos: D[] = [];
    const erroresDeFormato: ValidacionEntidad['erroresDeFormato'] = [];
    for (const { slug, contenido } of documentos) {
        const resultado = descriptor.parsearDocumento(slug, contenido);
        if (resultado.ok) validos.push(resultado.documento);
        else erroresDeFormato.push({ slug, errores: resultado.errores });
    }
    return {
        slugsDocumentos: documentos.map((d) => d.slug),
        erroresDeFormato,
        avisos: descriptor.avisosDocumentos?.(validos) ?? [],
    };
}

/** Avisos y errores de una entidad, con el mismo formato que el sync. */
function imprimirValidacion(log: (linea: string) => void, validacion: ValidacionEntidad): void {
    if (validacion.errorEntorno !== undefined) {
        log(`Error de entorno: ${validacion.errorEntorno}`);
        return;
    }
    imprimirAvisos(log, validacion.avisos);
    imprimirErroresDeFormato(log, validacion.erroresDeFormato);
}

const fallo = (v: ValidacionEntidad | undefined) =>
    v !== undefined && (v.errorEntorno !== undefined || v.erroresDeFormato.length > 0);

/**
 * Valida los documentos de Features y, si los hay, los de Tareas (con el
 * aviso de feature padre inexistente). Mismas reglas de carpetas que
 * `sincronizar`: ajustes inválidos cortan antes de leer nada; la carpeta de
 * Features es obligatoria; la de Tareas es opcional y se omite si las
 * Tareas están deshabilitadas.
 */
export function validar(dependencias: DependenciasValidar): ResumenValidacion {
    const log = dependencias.log ?? (() => {});
    const { ajustes } = dependencias;
    log(ENCABEZADO_VALIDAR);

    const errorAjustes = validarAjustesProyecto(ajustes, dependencias.raizRepo);
    if (errorAjustes !== null) {
        log(errorAjustes);
        return { codigo: 1, errorAjustes, features: { erroresDeFormato: [], avisos: [] } };
    }

    const descriptorFeature = crearDescriptorFeature(ajustes);
    let features: ValidacionEntidad;
    try {
        features = validarDocumentos(descriptorFeature, dependencias.listarDocumentos(descriptorFeature.carpeta));
    } catch (error) {
        features = { erroresDeFormato: [], avisos: [], errorEntorno: mensajeDeError(error) };
    }
    imprimirValidacion(log, features);

    let tareas: ValidacionEntidad | undefined;
    if (!ajustes.tareasDeshabilitadas) {
        // Sin la lista de Features (carpeta ilegible) no se valida el padre.
        const slugsFeatures = features.slugsDocumentos ? new Set(features.slugsDocumentos) : undefined;
        const descriptorTarea = crearDescriptorTarea(ajustes, slugsFeatures);
        try {
            const documentos = dependencias.listarDocumentos(descriptorTarea.carpeta, { opcional: true });
            if (documentos.length > 0) tareas = validarDocumentos(descriptorTarea, documentos);
        } catch (error) {
            tareas = { erroresDeFormato: [], avisos: [], errorEntorno: mensajeDeError(error) };
        }
        if (tareas) {
            log('');
            log('Tareas:');
            imprimirValidacion(log, tareas);
        }
    }

    return {
        codigo: fallo(features) || fallo(tareas) ? 1 : 0,
        features,
        ...(tareas ? { tareas } : {}),
    };
}
