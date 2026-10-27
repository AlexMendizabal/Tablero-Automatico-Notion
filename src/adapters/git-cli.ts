/**
 * Adaptador de git (vía el comando inyectable): ramas, fechas de documentos
 * y de commits, y clon superficial.
 */
import type { AutorCommit, Identidad } from '../core/contribuyentes';
import type { RamaConFecha, VersionEnRama } from '../core/types';
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

/** Prefijos de las refs de ramas que se leen, en el orden en que se quitan
 *  para obtener el nombre de la rama. */
const PREFIJOS_RAMA = ['refs/heads/', 'refs/remotes/origin/'];

/** Ruta → blob de los `.md` que están directamente en `carpeta` dentro de
 *  `ref` (`git ls-tree -z`: sin comillas en rutas con caracteres raros). */
function blobsDeDocumentos(ejecutar: EjecutarComando, ref: string, carpeta: string): Map<string, string> {
    const blobs = new Map<string, string>();
    for (const entrada of ejecutar('git', ['ls-tree', '-z', ref, '--', `${carpeta}/`]).split('\0')) {
        const tab = entrada.indexOf('\t');
        if (tab === -1) continue;
        const [, tipo, objeto] = entrada.slice(0, tab).split(' ');
        const ruta = entrada.slice(tab + 1);
        if (tipo === 'blob' && ruta.toLowerCase().endsWith('.md')) blobs.set(ruta, objeto);
    }
    return blobs;
}

/**
 * Versiones de los documentos de `carpeta` en cada rama viva (local y
 * `origin/`) que difieren de las del checkout (`HEAD`): los documentos que
 * esa rama cambió y los que solo existen en ella. Un blob idéntico al del
 * checkout no se lee (no aporta nada). LANZA si git falla: el llamador
 * avisa y sigue solo con el checkout.
 */
export function obtenerVersionesEnRamas(ejecutar: EjecutarComando, carpeta: string): VersionEnRama[] {
    const refs = ejecutar('git', ['for-each-ref', '--format=%(refname)', ...PREFIJOS_RAMA.map((p) => p.slice(0, -1))])
        .split(/\r?\n/)
        .map((ref) => ref.trim())
        .filter((ref) => ref !== '' && ref !== 'refs/remotes/origin/HEAD');
    if (refs.length === 0) return [];
    const delCheckout = blobsDeDocumentos(ejecutar, 'HEAD', carpeta);
    const versiones: VersionEnRama[] = [];
    for (const ref of refs) {
        const prefijo = PREFIJOS_RAMA.find((p) => ref.startsWith(p));
        if (!prefijo) continue;
        for (const [ruta, blob] of blobsDeDocumentos(ejecutar, ref, carpeta)) {
            if (delCheckout.get(ruta) === blob) continue;
            const fecha = ejecutar('git', ['log', '-1', '--format=%cI', ref, '--', ruta]).trim();
            if (fecha === '') continue;
            versiones.push({
                rama: ref.slice(prefijo.length),
                slug: ruta.slice(ruta.lastIndexOf('/') + 1).replace(/\.md$/i, ''),
                contenido: ejecutar('git', ['cat-file', 'blob', blob]),
                fecha,
            });
        }
    }
    return versiones;
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

// ---------------------------------------------------------------------------
// Autores (contribuyentes)
// ---------------------------------------------------------------------------

/** Formato de `git log`/`git show` para los autores: nombre y email con
 *  `.mailmap` aplicado (`%aN`, `%aE`) y los valores de los trailers
 *  `Co-authored-by` (git compara la clave sin distinguir mayúsculas).
 *  Separadores de control que no aparecen en nombres ni emails: 0x1f entre
 *  campos, 0x1d entre coautores y 0x1e al final de cada commit. */
export const FORMATO_AUTORES = '%aN%x1f%aE%x1f%(trailers:key=Co-authored-by,valueonly,separator=%x1d)%x1e';

const SEPARADOR_CAMPOS = '\x1f';
const SEPARADOR_COAUTORES = '\x1d';
const FIN_DE_REGISTRO = '\x1e';

/** `Nombre <email>` de un trailer; sin `<...>`, todo es el nombre. */
function parsearIdentidadTrailer(valor: string): Identidad | null {
    const limpio = valor.trim();
    if (limpio === '') return null;
    const coincidencia = /^(.*?)\s*<([^<>]*)>$/.exec(limpio);
    if (!coincidencia) return { nombre: limpio, email: '' };
    return { nombre: coincidencia[1].trim(), email: coincidencia[2].trim() };
}

/** Lee la salida de `FORMATO_AUTORES`. Defensivo: ignora registros vacíos o
 *  sin los campos esperados (en vez de inventar un autor). */
export function parsearAutoresGit(salida: string): AutorCommit[] {
    const autores: AutorCommit[] = [];
    for (const registro of salida.split(FIN_DE_REGISTRO)) {
        const campos = registro.replace(/^[\r\n]+/, '').split(SEPARADOR_CAMPOS);
        if (campos.length < 2) continue;
        const [nombre, email, trailers = ''] = campos;
        const coautores = trailers
            .split(SEPARADOR_COAUTORES)
            .map(parsearIdentidadTrailer)
            .filter((identidad): identidad is Identidad => identidad !== null);
        autores.push({ nombre: nombre.trim(), email: email.trim(), coautores });
    }
    return autores;
}

function existeRef(ejecutar: EjecutarComando, ref: string): boolean {
    try {
        return ejecutar('git', ['rev-parse', '--verify', '--quiet', ref]).trim() !== '';
    } catch {
        return false;
    }
}

/** Ref completa de la rama base contra la que se comparan las ramas:
 *  `origin/<base>` si existe (lo normal en CI), si no la rama local; `null`
 *  si no existe ninguna. */
export function obtenerRefRamaBase(ejecutar: EjecutarComando, ramaBase: string): string | null {
    for (const ref of [`refs/remotes/origin/${ramaBase}`, `refs/heads/${ramaBase}`]) {
        if (existeRef(ejecutar, ref)) return ref;
    }
    return null;
}

/** `null` si git falla: "no se sabe", que el llamador distingue de "sin
 *  autores" para no pisar en Notion los contribuyentes con una lista
 *  incompleta. */
function autoresDe(ejecutar: EjecutarComando, argumentos: string[]): AutorCommit[] | null {
    try {
        return parsearAutoresGit(ejecutar('git', argumentos));
    } catch {
        return null;
    }
}

/** Autores de los commits de `rama` (local y/o `origin/`, la que exista)
 *  que no están en `base` (una ref completa, ver `obtenerRefRamaBase`).
 *  `--ignore-missing` saltea la variante de la rama que no existe; si git
 *  falla, `null`. */
export function obtenerAutoresDeRango(ejecutar: EjecutarComando, base: string, rama: string): AutorCommit[] | null {
    return autoresDe(ejecutar, [
        'log',
        '--ignore-missing',
        `--format=${FORMATO_AUTORES}`,
        `refs/heads/${rama}`,
        `refs/remotes/origin/${rama}`,
        '--not',
        base,
        '--',
    ]);
}

/** Autor (y coautores) de un commit por hash; si git falla, `null`. */
export function obtenerAutoresDeCommit(ejecutar: EjecutarComando, sha: string): AutorCommit[] | null {
    return autoresDe(ejecutar, ['show', '-s', `--format=${FORMATO_AUTORES}`, sha]);
}
