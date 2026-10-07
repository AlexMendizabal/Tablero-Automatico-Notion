/**
 * Adaptador de sistema de archivos: lectura de los documentos ODD.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { CARPETA_TAREAS } from '../core/ajustes';

// ---------------------------------------------------------------------------
// Capa de E/S — documentos ODD
// ---------------------------------------------------------------------------

// "CARPETA_TAREAS" vive en el bloque "=== Ajustes por proyecto ===", en
// `core/ajustes.ts`.

/**
 * Lee `odd/tasks/*.md` (o la carpeta configurada en `CARPETA_TAREAS`). Lanza
 * (nunca devuelve `[]` en silencio) cuando la
 * carpeta no existe o no se puede leer, o cuando existe pero no tiene ningún
 * `.md`: un repo que usa este sync siempre tiene al menos un documento, así
 * que "cero filas" ahí es señal de que se corrió desde el lugar equivocado,
 * no de que no hay nada que sincronizar.
 */
export function listarDocumentosODD(raizRepo: string): Array<{ slug: string; contenido: string }> {
    const carpeta = path.join(raizRepo, CARPETA_TAREAS);
    let entradas: string[];
    try {
        entradas = fs.readdirSync(carpeta);
    } catch {
        throw new Error(
            `No se encontró "${CARPETA_TAREAS}" en "${raizRepo}". ¿Se corrió el comando desde la raíz del repositorio (o del worktree)?`,
        );
    }
    const archivos = entradas.filter((f) => f.toLowerCase().endsWith('.md'));
    if (archivos.length === 0) {
        throw new Error(`La carpeta "${CARPETA_TAREAS}" en "${raizRepo}" no tiene ningún documento ".md".`);
    }
    return archivos.sort().map((archivo) => ({
        slug: archivo.replace(/\.md$/i, ''),
        contenido: fs.readFileSync(path.join(carpeta, archivo), 'utf8'),
    }));
}
