/**
 * Estado y actividad de una feature: patrones de rama, estado derivado,
 * fecha de última actividad y días sin actividad.
 */
import type { Estado, EstadoTarea, ParametrosActualizado, TareaDocumento } from './types';

// ---------------------------------------------------------------------------
// coincideRama
// ---------------------------------------------------------------------------

const CARACTERES_REGEX_ESPECIALES = new Set('.*+?^${}()|[]\\'.split(''));

function escaparCaracterRegex(caracter: string): string {
    return CARACTERES_REGEX_ESPECIALES.has(caracter) ? '\\' + caracter : caracter;
}

/** Traduce un patrón glob simple (solo "*" como comodín, que matchea
 *  cualquier secuencia incluida "/") a una regex anclada por completo. Todo
 *  otro carácter especial de regex se escapa como literal. */
export function coincideRama(patron: string, rama: string): boolean {
    let cuerpo = '';
    for (const caracter of patron) {
        cuerpo += caracter === '*' ? '.*' : escaparCaracterRegex(caracter);
    }
    return new RegExp(`^${cuerpo}$`).test(rama);
}

// ---------------------------------------------------------------------------
// derivarEstado
// ---------------------------------------------------------------------------

/** Estado del marcador de una tarea; sin `estado` (tareas armadas a mano),
 *  se deduce de `hecha`. */
export function estadoDeTarea(tarea: TareaDocumento): EstadoTarea {
    return tarea.estado ?? (tarea.hecha ? 'hecha' : 'pendiente');
}

/** Tareas que cuentan (las descartadas quedan fuera del total y del estado). */
export function tareasActivas(tareas: TareaDocumento[]): TareaDocumento[] {
    return tareas.filter((t) => estadoDeTarea(t) !== 'descartada');
}

/** Precedencia: Terminada (todas las no descartadas hechas, aunque no quede
 *  ninguna, y 0 PRs abiertos) > Bloqueada (alguna no descartada `[!]`) > QA
 *  pendiente > Sin empezar (ninguna hecha ni en curso) > En curso. */
export function derivarEstado(tareas: TareaDocumento[], cantidadPrsAbiertos: number): Estado {
    const activas = tareasActivas(tareas);
    const hechas = activas.filter((t) => t.hecha).length;
    const pendientes = activas.filter((t) => !t.hecha);

    if (tareas.length > 0 && hechas === activas.length && cantidadPrsAbiertos === 0) return 'Terminada';
    if (activas.some((t) => estadoDeTarea(t) === 'bloqueada')) return 'Bloqueada';
    if (pendientes.length > 0 && pendientes.every((t) => t.esQA)) return 'QA pendiente';
    if (hechas === 0 && !activas.some((t) => estadoDeTarea(t) === 'en_curso')) return 'Sin empezar';
    return 'En curso';
}

// ---------------------------------------------------------------------------
// calcularActualizado / diasSinActividad
// ---------------------------------------------------------------------------

/**
 * La fecha más reciente entre: el commit de cada rama viva que matchea, el
 * `mergedAt` de cada PR mergeado, el `closedAt` de cada PR cerrado sin merge y
 * el `createdAt` de cada PR abierto. Fallback a la fecha del documento y,
 * si tampoco hay, a `hoy`. NUNCA lee `updatedAt` (ver el comentario del campo
 * en `PullRequestInfo`): ese campo se mueve con eventos que no son trabajo
 * (ej. borrado de rama), y usarlo escondería features realmente estancadas.
 */
export function calcularActualizado(parametros: ParametrosActualizado): string {
    const fechas: string[] = [];
    for (const rama of parametros.ramasVivas) fechas.push(rama.fecha);
    for (const pr of parametros.prs) {
        if (pr.state === 'MERGED' && pr.mergedAt) fechas.push(pr.mergedAt);
        else if (pr.state === 'CLOSED' && pr.closedAt) fechas.push(pr.closedAt);
        else if (pr.state === 'OPEN') fechas.push(pr.createdAt);
    }
    for (const fecha of parametros.fechasCommits ?? []) fechas.push(fecha);

    if (fechas.length > 0) {
        const maximo = Math.max(...fechas.map((f) => new Date(f).getTime()));
        return new Date(maximo).toISOString();
    }
    if (parametros.fechaDocumento) return new Date(parametros.fechaDocumento).toISOString();
    return parametros.hoy.toISOString();
}

export function diasSinActividad(actualizado: string, hoy: Date): number {
    const ms = hoy.getTime() - new Date(actualizado).getTime();
    return Math.floor(ms / (1000 * 60 * 60 * 24));
}
