/**
 * Adaptador de gh (vía el comando inyectable): pull requests (con el login
 * de su autor) y owner/repo.
 */
import type { AutorCommit, Identidad } from '../core/contribuyentes';
import type { PullRequestInfo } from '../core/types';
import type { EjecutarComando } from '../ports/sincronizar';

export function obtenerPRs(ejecutar: EjecutarComando): PullRequestInfo[] {
    // Deliberadamente NO se pide "updatedAt" (ver PullRequestInfo.updatedAt).
    const salida = ejecutar('gh', [
        'pr',
        'list',
        '--state',
        'all',
        '--limit',
        '1000',
        '--json',
        'number,headRefName,state,createdAt,mergedAt,closedAt,author',
    ]);
    const datos = JSON.parse(salida || '[]') as Array<{
        number: number;
        headRefName: string;
        state: string;
        createdAt: string;
        mergedAt: string | null;
        closedAt: string | null;
        author?: { login?: string; is_bot?: boolean } | null;
    }>;
    return datos.map((d) => ({
        number: d.number,
        headRefName: d.headRefName,
        state: d.state as PullRequestInfo['state'],
        createdAt: d.createdAt,
        mergedAt: d.mergedAt,
        closedAt: d.closedAt,
        // El autor de un PR de un bot (ej. dependabot) no es un contribuyente.
        ...(d.author?.login && !d.author.is_bot ? { autor: d.author.login } : {}),
    }));
}

interface AutorGitHub {
    login?: string;
    name?: string;
    email?: string;
}

/** Un autor de GitHub como identidad de commit: el login si lo hay (así lo
 *  usa la normalización tal cual), si no su nombre y email. */
function identidadDeAutorGitHub(autor: AutorGitHub): Identidad {
    const texto = (valor: unknown): string => (typeof valor === 'string' ? valor : '');
    const login = texto(autor.login).trim();
    return login ? { nombre: login, email: '' } : { nombre: texto(autor.name), email: texto(autor.email) };
}

/** Autores de los commits de un PR (`gh pr view <n> --json commits`): por
 *  commit, su primer autor y, como coautores, los demás (GitHub ya resuelve
 *  ahí los trailers `Co-authored-by`). Sirve para los PRs mergeados, cuyos
 *  commits ya no se ven como "rama fuera de la base". Si gh falla o su
 *  salida no se puede leer, `null` ("no se sabe", distinto de "sin autores"). */
export function obtenerAutoresDePR(ejecutar: EjecutarComando, numero: number): AutorCommit[] | null {
    let datos: unknown;
    try {
        datos = JSON.parse(ejecutar('gh', ['pr', 'view', String(numero), '--json', 'commits']));
    } catch {
        return null;
    }
    if (!esSalidaDeCommits(datos)) return null;
    return datos.commits.flatMap((commit) => {
        const [autor, ...coautores] = commit.authors.map(identidadDeAutorGitHub);
        return autor ? [{ ...autor, coautores }] : [];
    });
}

const esObjeto = (valor: unknown): valor is Record<string, unknown> =>
    typeof valor === 'object' && valor !== null && !Array.isArray(valor);

/** La forma que se lee de `gh pr view --json commits`: un objeto con un
 *  array `commits`, cada uno con un array `authors` de objetos. Cualquier
 *  otra cosa (ej. `null`) es una salida ilegible, no "sin autores". */
function esSalidaDeCommits(datos: unknown): datos is { commits: Array<{ authors: AutorGitHub[] }> } {
    return (
        esObjeto(datos) &&
        Array.isArray(datos.commits) &&
        datos.commits.every(
            (commit) => esObjeto(commit) && Array.isArray(commit.authors) && commit.authors.every(esObjeto),
        )
    );
}

export function obtenerOwnerRepo(ejecutar: EjecutarComando): string {
    const desdeEnv = process.env.GITHUB_REPOSITORY;
    if (desdeEnv && desdeEnv.trim() !== '') return desdeEnv.trim();
    const salida = ejecutar('gh', ['repo', 'view', '--json', 'nameWithOwner']);
    const datos = JSON.parse(salida) as { nameWithOwner: string };
    return datos.nameWithOwner;
}
