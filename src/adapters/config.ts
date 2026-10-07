/**
 * Adaptador de configuración: `.env` y variables de entorno.
 */
import * as path from 'node:path';

import dotenv from 'dotenv';

import { type AjustesProyecto, resolverAjustesProyecto } from '../core/ajustes';
import type { Credenciales } from '../ports/notion';

// ---------------------------------------------------------------------------
// Ajustes por proyecto (TABLERO_CARPETA / TABLERO_RAMA_BASE)
// ---------------------------------------------------------------------------

/** Ajustes por proyecto leídos de `process.env` UNA vez, al cargar este
 *  módulo, igual que antes de la separación en módulos (cuando vivían en
 *  `core/ajustes.ts`). Consecuencia observable que se conserva a propósito:
 *  un `TABLERO_CARPETA`/`TABLERO_RAMA_BASE` que solo viva en el `.env` NO los
 *  afecta, porque el `.env` se carga recién en `cargarCredenciales`, después
 *  de que este módulo ya se evaluó. */
export const AJUSTES_PROYECTO: AjustesProyecto = resolverAjustesProyecto(process.env);

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
