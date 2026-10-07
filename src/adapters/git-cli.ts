/**
 * Adaptador de git (vía el comando inyectable): ramas, fechas de documentos
 * y de commits, y clon superficial.
 */
import type { RamaConFecha } from '../core/types';
import type { EjecutarComando } from '../ports/sincronizar';

// ---------------------------------------------------------------------------
// Capa de E/S — git / gh (comando inyectable)
// ---------------------------------------------------------------------------

export function obtenerRamasConFecha(ejecutar: EjecutarComando): RamaConFecha[] {
    const salida = ejecutar('git', [
        'for-each-ref',
        '--format=%(refname:short)%09%(committerdate:iso-strict)',
        'refs/heads',
        'refs/remotes/origin',
    ]);
    const porNombre = new Map<string, string>();
    for (const linea of salida.split(/\r?\n/)) {
        if (linea.trim() === '') continue;
        const [refCrudo, fecha] = linea.split('\t');
        if (!refCrudo || !fecha) continue;
        const nombre = refCrudo.startsWith('origin/') ? refCrudo.slice('origin/'.length) : refCrudo;
        if (nombre === 'HEAD' || nombre === 'origin') continue;
        const existente = porNombre.get(nombre);
        if (!existente || new Date(fecha).getTime() > new Date(existente).getTime()) {
            porNombre.set(nombre, fecha);
        }
    }
    return [...porNombre.entries()].map(([nombre, fecha]) => ({ nombre, fecha }));
}

/** Fecha (ISO) del último commit que tocó el documento en `rutaRelativa`
 *  (ej. `odd/tasks/<slug>.md`, relativa a la raíz del repositorio). `null`
 *  si git falla o el archivo no tiene historia. */
export function obtenerFechaDocumento(ejecutar: EjecutarComando, rutaRelativa: string): string | null {
    let salida: string;
    try {
        salida = ejecutar('git', ['log', '-1', '--format=%cI', '--', rutaRelativa]);
    } catch {
        return null;
    }
    const fecha = salida.trim();
    return fecha === '' ? null : fecha;
}

/** Resuelve la fecha (ISO, `committerdate`) de un commit por hash. `null` si
 *  el commit no existe en el repositorio (ej. `git show` sale con error) —
 *  eso lo trata el llamador como error de formato del documento, nunca en
 *  silencio (ver el frontmatter opcional `commits`). */
export function obtenerFechaCommit(ejecutar: EjecutarComando, sha: string): string | null {
    let salida: string;
    try {
        salida = ejecutar('git', ['show', '-s', '--format=%cI', sha]);
    } catch {
        return null;
    }
    const fecha = salida.trim();
    return fecha === '' ? null : fecha;
}

/**
 * `true` si el repositorio es un clon superficial (`--depth`). A propósito
 * NO atrapa el error de `ejecutar`: si git no puede correr (ENOENT o
 * similar), eso tiene que distinguirse de "el commit no existe" — es un
 * problema de ENTORNO, no de formato de un documento — y el llamador
 * (`sincronizar`) lo trata así dejando que la excepción se propague.
 */
export function obtenerEsRepoSuperficial(ejecutar: EjecutarComando): boolean {
    const salida = ejecutar('git', ['rev-parse', '--is-shallow-repository']);
    return salida.trim() === 'true';
}
