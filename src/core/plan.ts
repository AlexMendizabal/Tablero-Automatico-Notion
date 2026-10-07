/**
 * Plan de sincronización: huella de tareas, upsert por Slug y resolución de
 * slugs duplicados.
 */
import * as crypto from 'node:crypto';

import type { DuplicadoSlug, FilaTablero, PaginaExistente, PlanSync, TareaDocumento } from './types';

// ---------------------------------------------------------------------------
// calcularHuella
// ---------------------------------------------------------------------------

/** sha256 de la lista normalizada de tareas `id|hecha|nombre|descripción`.
 *  Alternar un solo checkbox cambia la huella; el mismo listado la conserva. */
export function calcularHuella(tareas: TareaDocumento[]): string {
    const normalizado = tareas.map((t) => `${t.id}|${t.hecha}|${t.nombre}|${t.descripcion}`).join('\n');
    return crypto.createHash('sha256').update(normalizado, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// planificarSync
// ---------------------------------------------------------------------------

/** Upsert por Slug: nunca borra. Una página existente sin fila correspondiente
 *  se reporta en `huerfanas`, no se elimina (decisión del usuario). */
export function planificarSync<F extends { slug: string; huella: string } = FilaTablero>(
    filas: F[],
    paginasExistentes: PaginaExistente[],
): PlanSync<F> {
    const porSlug = new Map(paginasExistentes.map((p) => [p.slug, p]));
    const slugsDeFilas = new Set(filas.map((f) => f.slug));

    const crear: F[] = [];
    const actualizar: PlanSync<F>['actualizar'] = [];

    for (const fila of filas) {
        const existente = porSlug.get(fila.slug);
        if (!existente) {
            crear.push(fila);
        } else {
            actualizar.push({
                pageId: existente.pageId,
                fila,
                reescribirCuerpo: existente.huella !== fila.huella,
            });
        }
    }

    const huerfanas = paginasExistentes.filter((p) => !slugsDeFilas.has(p.slug));

    return { crear, actualizar, huerfanas };
}

/** Instante de creación de la página en ms, para ordenar duplicados. Un
 *  `createdTime` ausente o que no se puede interpretar como fecha (NaN) se
 *  trata igual: va al final (`POSITIVE_INFINITY`). Sin esto, un NaN en la
 *  comparación hacía que el orden dependiera de la posición en la consulta. */
function instanteDeCreacion(pagina: PaginaExistente): number {
    if (!pagina.createdTime) return Number.POSITIVE_INFINITY;
    const ms = new Date(pagina.createdTime).getTime();
    return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/**
 * Cuando el mismo Slug aparece en más de una página de Notion (el bug ya
 * visto con `module-auth` en la base de fichas: un `Map` clave-única se
 * queda con la última y la otra envejece en silencio), se elige UNA página
 * de forma determinística para actualizar — la de `createdTime` más
 * antiguo; si falta (o es inválido) o hay empate, la primera en el orden de la consulta
 * (`Array.prototype.sort` es estable) — y el resto queda listado como
 * "duplicadas". Ninguna se borra nunca: eso es decisión del usuario.
 */
export function resolverDuplicadosPorSlug(paginasExistentes: PaginaExistente[]): {
    unicas: PaginaExistente[];
    duplicadas: DuplicadoSlug[];
} {
    const porSlug = new Map<string, PaginaExistente[]>();
    for (const pagina of paginasExistentes) {
        const lista = porSlug.get(pagina.slug);
        if (lista) lista.push(pagina);
        else porSlug.set(pagina.slug, [pagina]);
    }

    const unicas: PaginaExistente[] = [];
    const duplicadas: DuplicadoSlug[] = [];

    for (const [slug, paginas] of porSlug) {
        if (paginas.length === 1) {
            unicas.push(paginas[0]);
            continue;
        }
        const ordenadas = [...paginas].sort((a, b) => {
            const fechaA = instanteDeCreacion(a);
            const fechaB = instanteDeCreacion(b);
            // Comparación explícita (no `fechaA - fechaB`): Infinity - Infinity
            // es NaN, y un comparador que devuelve NaN deja el orden librado
            // a la implementación de `sort`.
            if (fechaA === fechaB) return 0;
            return fechaA < fechaB ? -1 : 1;
        });
        unicas.push(ordenadas[0]);
        duplicadas.push({ slug, pageIds: ordenadas.slice(1).map((p) => p.pageId) });
    }

    return { unicas, duplicadas };
}
