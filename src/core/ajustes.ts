/**
 * Ajustes por proyecto (carpeta de documentos y rama base del enlace
 * "Documento"). Se evalúan UNA vez, al cargar el módulo, igual que antes de
 * la separación en módulos: un `TABLERO_CARPETA`/`TABLERO_RAMA_BASE` que
 * solo viva en el `.env` NO los afecta (el `.env` se carga recién en
 * `cargarCredenciales`).
 */

// ---------------------------------------------------------------------------
// === Ajustes por proyecto ===
//
// Estos dos valores son los únicos que hace falta tocar para adaptar este
// script a un repositorio distinto del que sirvió de plantilla. Cada uno se
// puede fijar por variable de entorno (documentada en el README y en
// `.env.example`) o dejar en su valor por defecto.
// ---------------------------------------------------------------------------

/** Carpeta (relativa a la raíz del repositorio) donde viven los documentos
 *  ODD (`<carpeta>/*.md`). Variable de entorno: `TABLERO_CARPETA`. */
export const CARPETA_TAREAS = process.env.TABLERO_CARPETA ?? 'odd/tasks';

/** Rama base que arma el enlace "Documento" de cada fila del tablero:
 *  `https://github.com/<owner>/<repo>/blob/<esta rama>/<CARPETA_TAREAS>/<slug>.md`.
 *  Normalmente es la rama por defecto del repositorio. Variable de entorno:
 *  `TABLERO_RAMA_BASE`. */
export const RAMA_BASE_DOCUMENTO = process.env.TABLERO_RAMA_BASE ?? 'main';
