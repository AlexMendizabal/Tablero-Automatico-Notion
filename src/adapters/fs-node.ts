/**
 * Adaptador de sistema de archivos: lectura de los documentos ODD.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Capa de E/S — documentos ODD
// ---------------------------------------------------------------------------

/**
 * Lee `<carpeta>/*.md` (`carpeta` relativa a `raizRepo`; para Features,
 * `odd/tasks` o lo que diga `TABLERO_CARPETA`, ver `adapters/config.ts`). Lanza
 * (nunca devuelve `[]` en silencio) cuando la
 * carpeta no existe o no se puede leer, o cuando existe pero no tiene ningún
 * `.md`: un repo que usa este sync siempre tiene al menos un documento, así
 * que "cero filas" ahí es señal de que se corrió desde el lugar equivocado,
 * no de que no hay nada que sincronizar.
 */
export function listarDocumentosODD(
    raizRepo: string,
    carpetaRelativa: string,
): Array<{ slug: string; contenido: string }> {
    const carpeta = path.join(raizRepo, carpetaRelativa);
    let entradas: string[];
    try {
        entradas = fs.readdirSync(carpeta);
    } catch {
        throw new Error(
            `No se encontró "${carpetaRelativa}" en "${raizRepo}". ¿Se corrió el comando desde la raíz del repositorio (o del worktree)?`,
        );
    }
    const archivos = entradas.filter((f) => f.toLowerCase().endsWith('.md'));
    if (archivos.length === 0) {
        throw new Error(`La carpeta "${carpetaRelativa}" en "${raizRepo}" no tiene ningún documento ".md".`);
    }
    return archivos.sort().map((archivo) => ({
        slug: archivo.replace(/\.md$/i, ''),
        contenido: fs.readFileSync(path.join(carpeta, archivo), 'utf8'),
    }));
}
