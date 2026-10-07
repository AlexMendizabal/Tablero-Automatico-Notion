/**
 * Armado de la fila del tablero a partir de un documento ODD, y su forma
 * legible para "--dry-run".
 */
import { CARPETA_TAREAS, RAMA_BASE_DOCUMENTO } from './ajustes';
import { TEXTOS_POR_IDIOMA } from './i18n';
import { calcularHuella } from './plan';
import { calcularActualizado, coincideRama, derivarEstado, diasSinActividad } from './status';
import type { FilaTablero, ParametrosConstruirFila } from './types';

// ---------------------------------------------------------------------------
// recortarParaNotion
// ---------------------------------------------------------------------------

/** Notion limita cada objeto de texto a 2000 caracteres; se deja margen y se
 *  recorta a 1900 con "…" para señalar visualmente el corte. */
const LIMITE_TEXTO_NOTION = 1900;

export function recortarParaNotion(texto: string): string {
    if (texto.length <= LIMITE_TEXTO_NOTION) return texto;
    return texto.slice(0, LIMITE_TEXTO_NOTION - 1) + '…';
}

// ---------------------------------------------------------------------------
// construirFila
// ---------------------------------------------------------------------------

export function construirFila(parametros: ParametrosConstruirFila): FilaTablero {
    const { documento, todasLasRamas, todosLosPRs, fechasCommits, fechaDocumento, hoy, ownerRepo } = parametros;
    const idioma = parametros.idioma ?? 'es';

    const ramasQueMatchean = todasLasRamas.filter((r) =>
        documento.ramas.some((patron) => coincideRama(patron, r.nombre)),
    );
    const prsQueMatchean = todosLosPRs.filter((pr) =>
        documento.ramas.some((patron) => coincideRama(patron, pr.headRefName)),
    );
    const prsAbiertos = prsQueMatchean.filter((pr) => pr.state === 'OPEN');

    const actualizado = calcularActualizado({
        ramasVivas: ramasQueMatchean,
        prs: prsQueMatchean,
        fechasCommits,
        fechaDocumento,
        hoy,
    });

    const total = documento.tareas.length;
    const hechas = documento.tareas.filter((t) => t.hecha).length;
    const primeraPendiente = documento.tareas.find((t) => !t.hecha);
    const estado = derivarEstado(documento.tareas, prsAbiertos.length);

    return {
        feature: recortarParaNotion(documento.titulo),
        slug: documento.slug,
        estado,
        progreso: TEXTOS_POR_IDIOMA[idioma].progreso(hechas, total),
        pendiente: primeraPendiente
            ? recortarParaNotion(`${primeraPendiente.id} — ${primeraPendiente.nombre}`)
            : '',
        prsAbiertos: recortarParaNotion(
            prsAbiertos
                .map((pr) => pr.number)
                .sort((a, b) => a - b)
                .map((n) => `#${n}`)
                .join(', '),
        ),
        ramas: recortarParaNotion([...ramasQueMatchean.map((r) => r.nombre)].sort().join(', ')),
        diasSinActividad: diasSinActividad(actualizado, hoy),
        actualizado,
        documento: `https://github.com/${ownerRepo}/blob/${RAMA_BASE_DOCUMENTO}/${CARPETA_TAREAS}/${documento.slug}.md`,
        huella: calcularHuella(documento.tareas),
    };
}

export function formatearFilaLegible(fila: FilaTablero): string {
    return [
        fila.slug.padEnd(28),
        fila.estado.padEnd(14),
        fila.progreso.padEnd(12),
        (fila.prsAbiertos || '—').padEnd(16),
        `${fila.diasSinActividad}d`.padEnd(6),
        fila.actualizado,
    ].join(' | ');
}
