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
import { componerDependencias, type EntradaComposicion } from '../../src/entrypoints/cli';

export function sincronizar(
    opciones: app.OpcionesCLI,
    entrada: EntradaComposicion,
): Promise<app.ResumenSincronizacion> {
    return app.sincronizar(opciones, componerDependencias(entrada));
}

export function sincronizarEntidad<C extends string, E extends string, D extends DocumentoODD, F extends FilaEntidad>(
    descriptor: DescriptorEntidad<C, E, D, F>,
    opciones: app.OpcionesCLI,
    entrada: EntradaComposicion,
): Promise<app.ResumenSincronizacion> {
    return app.sincronizarEntidad(descriptor, opciones, componerDependencias(entrada));
}
