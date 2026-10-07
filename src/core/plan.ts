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
export function planificarSync(filas: FilaTablero[], paginasExistentes: PaginaExistente[]): PlanSync {
    const porSlug = new Map(paginasExistentes.map((p) => [p.slug, p]));
    const slugsDeFilas = new Set(filas.map((f) => f.slug));

    const crear: FilaTablero[] = [];
    const actualizar: PlanSync['actualizar'] = [];

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

/**
 * Cuando el mismo Slug aparece en más de una página de Notion (el bug ya
 * visto con `module-auth` en la base de fichas: un `Map` clave-única se
 * queda con la última y la otra envejece en silencio), se elige UNA página
 * de forma determinística para actualizar — la de `createdTime` más
 * antiguo; si falta o hay empate, la primera en el orden de la consulta
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
            const fechaA = a.createdTime ? new Date(a.createdTime).getTime() : Number.POSITIVE_INFINITY;
            const fechaB = b.createdTime ? new Date(b.createdTime).getTime() : Number.POSITIVE_INFINITY;
            return fechaA - fechaB;
        });
        unicas.push(ordenadas[0]);
        duplicadas.push({ slug, pageIds: ordenadas.slice(1).map((p) => p.pageId) });
    }

    return { unicas, duplicadas };
}
