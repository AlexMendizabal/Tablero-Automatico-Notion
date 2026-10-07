/**
 * Adaptador de configuración: `.env` y variables de entorno.
 */
import * as path from 'node:path';

import dotenv from 'dotenv';

import type { Credenciales } from '../ports/notion';

// ---------------------------------------------------------------------------
// Capa de E/S — credenciales
// ---------------------------------------------------------------------------

export function cargarCredenciales(raizRepo: string): Credenciales | null {
    dotenv.config({ path: path.resolve(raizRepo, '.env') });
    const token = process.env.NOTION_TOKEN;
    const databaseId = process.env.NOTION_TABLERO_DB_ID;
    if (!token || !databaseId) return null;
    return { token, databaseId };
}

/** Valor crudo de `BOARD_LANGUAGE`. Se lee en el momento de la llamada (en
 *  `sincronizar`, DESPUÉS de `cargarCredenciales`), para que pueda venir
 *  del `.env`; lo interpreta `resolverIdiomaTablero`. */
export function leerBoardLanguage(): string | undefined {
    return process.env.BOARD_LANGUAGE;
}
