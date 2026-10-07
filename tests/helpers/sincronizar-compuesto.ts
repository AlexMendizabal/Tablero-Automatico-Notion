/**
 * `sincronizar`/`sincronizarEntidad` con las dependencias reales compuestas
 * por la raíz de composición (`componerDependencias`), a partir de los falsos
 * de siempre (`ejecutar`, `fetchInyectado`, `listarDocumentos`, ...). Así los
 * tests de la orquestación ejercitan también los adaptadores git/gh/Notion,
 * igual que antes de que la app dejara de importarlos.
 */
import * as app from '../../src/app/sincronizar';
import type { DescriptorEntidad, FilaEntidad } from '../../src/core/entities/tipos';
import type { DocumentoODD } from '../../src/core/types';
import { AJUSTES_PROYECTO } from '../../src/adapters/config';
import { componerDependencias, type EntradaComposicion } from '../../src/entrypoints/cli';

/** Entrada de los tests: la de la raíz de composición más, opcionalmente,
 *  los documentos de Tareas. Los `listarDocumentos` falsos de los tests de
 *  Features devuelven sus documentos para CUALQUIER carpeta, así que la
 *  carpeta de Tareas (`ajustes.carpetaTareas`) se responde aparte: sin
 *  `listarDocumentosTareas`, no hay Tareas (carpeta inexistente → `[]`). */
export type EntradaPrueba = EntradaComposicion & {
    listarDocumentosTareas?: (carpeta: string) => Array<{ slug: string; contenido: string }>;
};

function componerParaPrueba(entrada: EntradaPrueba) {
    const { listarDocumentosTareas, ...resto } = entrada;
    const carpetaTareas = (entrada.ajustes ?? AJUSTES_PROYECTO).carpetaTareas;
    return componerDependencias({
        ...resto,
        listarDocumentos: (carpeta, opciones) =>
            carpeta === carpetaTareas
                ? (listarDocumentosTareas?.(carpeta) ?? [])
                : entrada.listarDocumentos(carpeta, opciones),
    });
}

export function sincronizar(opciones: app.OpcionesCLI, entrada: EntradaPrueba): Promise<app.ResumenGeneral> {
    return app.sincronizar(opciones, componerParaPrueba(entrada));
}

export function sincronizarEntidad<C extends string, E extends string, D extends DocumentoODD, F extends FilaEntidad>(
    descriptor: DescriptorEntidad<C, E, D, F>,
    opciones: app.OpcionesCLI,
    entrada: EntradaComposicion,
): Promise<app.ResumenSincronizacion> {
    return app.sincronizarEntidad(descriptor, opciones, componerDependencias(entrada));
}
