/**
 * Adaptador de gh (vía el comando inyectable): pull requests (con el login
 * de su autor) y owner/repo.
 */
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

export function obtenerOwnerRepo(ejecutar: EjecutarComando): string {
    const desdeEnv = process.env.GITHUB_REPOSITORY;
    if (desdeEnv && desdeEnv.trim() !== '') return desdeEnv.trim();
    const salida = ejecutar('gh', ['repo', 'view', '--json', 'nameWithOwner']);
    const datos = JSON.parse(salida) as { nameWithOwner: string };
    return datos.nameWithOwner;
}
