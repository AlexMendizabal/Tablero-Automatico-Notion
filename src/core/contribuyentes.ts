/**
 * Contribuyentes de un documento (Feature o Tarea): normalización de las
 * identidades que salen de git (autores de commits y trailers
 * `Co-authored-by`) y de GitHub (autores de PRs) a los valores de la
 * propiedad multi-select "Contribuyentes" de Notion.
 *
 * Reglas:
 * - Un email noreply de GitHub (`123+login@users.noreply.github.com` o
 *   `login@users.noreply.github.com`) identifica al login: se usa el login.
 * - Un login de autor de PR se usa tal cual.
 * - Si no, el nombre del autor (git ya le aplicó `.mailmap` con `%aN`).
 * - Se excluyen los bots: logins o nombres con sufijo `[bot]`, apps de
 *   GitHub (`app/...`, como las devuelve `gh`), `dependabot` y el email de
 *   GitHub web-flow (`noreply@github.com`).
 * - Deduplicación sin distinguir mayúsculas (queda la primera grafía vista:
 *   primero los autores de PRs, después los commits) y orden alfabético
 *   determinístico.
 */

export interface Identidad {
    nombre: string;
    email: string;
}

/** Autor de un commit (nombre y email con `.mailmap` aplicado) y los
 *  coautores de sus trailers `Co-authored-by`. */
export interface AutorCommit extends Identidad {
    coautores: Identidad[];
}

/** Largo máximo del nombre de una opción de multi-select de Notion. */
const LARGO_MAXIMO_OPCION = 100;

const EMAIL_NOREPLY_GITHUB = /^(?:\d+\+)?([^\s@+]+)@users\.noreply\.github\.com$/i;

/** Email del committer de GitHub web-flow (commits hechos desde la web). */
const EMAIL_WEB_FLOW = 'noreply@github.com';

/** Login de GitHub de un email noreply de usuario; `null` si no lo es. */
export function loginDeEmailNoreply(email: string): string | null {
    const coincidencia = EMAIL_NOREPLY_GITHUB.exec(email.trim());
    return coincidencia ? coincidencia[1] : null;
}

/** `true` si el login o nombre es de un bot o de una app de GitHub. */
export function esBot(valor: string): boolean {
    const limpio = valor.trim();
    return /\[bot\]$/i.test(limpio) || /^app\//i.test(limpio) || /^dependabot(?:$|[^a-z0-9])/i.test(limpio);
}

/** Nombre válido para una opción de multi-select de Notion: sin comas (las
 *  separan opciones), sin espacios repetidos ni en los extremos y con a lo
 *  sumo 100 caracteres (contados por punto de código, sin partir uno). */
export function normalizarNombreOpcion(valor: string): string {
    const limpio = valor.normalize('NFC').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    const caracteres = Array.from(limpio);
    return caracteres.length <= LARGO_MAXIMO_OPCION ? limpio : caracteres.slice(0, LARGO_MAXIMO_OPCION).join('').trim();
}

/** Valor de contribuyente de una identidad de git, o `null` si es un bot o
 *  no queda nada que mostrar. */
export function identidadContribuyente(identidad: Identidad): string | null {
    const email = identidad.email.trim();
    if (email.toLowerCase() === EMAIL_WEB_FLOW) return null;
    const login = loginDeEmailNoreply(email);
    const valor = normalizarNombreOpcion(login ?? identidad.nombre);
    if (valor === '' || esBot(valor) || esBot(identidad.nombre)) return null;
    return valor;
}

function compararContribuyentes(a: string, b: string): number {
    const porIdioma = a.localeCompare(b, 'en', { sensitivity: 'base' });
    if (porIdioma !== 0) return porIdioma;
    return a < b ? -1 : a > b ? 1 : 0;
}

/** Contribuyentes de un documento: los logins de los autores de sus PRs y
 *  los autores (y coautores) de sus commits, normalizados, sin bots, sin
 *  repetir (sin distinguir mayúsculas) y en orden alfabético. */
export function calcularContribuyentes(entrada: { loginsPrs: string[]; commits: AutorCommit[] }): string[] {
    const candidatos: Array<string | null> = [
        ...entrada.loginsPrs.map((login) => {
            const valor = normalizarNombreOpcion(login);
            return valor === '' || esBot(valor) ? null : valor;
        }),
        ...entrada.commits.flatMap((commit) => [commit, ...commit.coautores].map(identidadContribuyente)),
    ];
    const porClave = new Map<string, string>();
    for (const valor of candidatos) {
        if (valor === null) continue;
        const clave = valor.toLowerCase();
        if (!porClave.has(clave)) porClave.set(clave, valor);
    }
    return [...porClave.values()].sort(compararContribuyentes);
}
