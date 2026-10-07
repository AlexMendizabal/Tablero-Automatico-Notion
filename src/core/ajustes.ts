/**
 * Ajustes por proyecto (carpetas de documentos y rama base del enlace
 * "Documento"). El núcleo NO lee el entorno: recibe los valores ya resueltos
 * (`AjustesProyecto`). Quien los lee de las variables de entorno es
 * `adapters/config.ts` (`AJUSTES_PROYECTO`), con `resolverAjustesProyecto`.
 */

// ---------------------------------------------------------------------------
// === Ajustes por proyecto ===
//
// Estos valores son los únicos que hace falta tocar para adaptar este
// script a un repositorio distinto del que sirvió de plantilla. Cada uno se
// puede fijar por variable de entorno (documentada en el README y en
// `.env.example`) o dejar en su valor por defecto.
// ---------------------------------------------------------------------------

/** Ajustes por proyecto ya resueltos, tal como los recibe un descriptor de
 *  entidad (ver `crearDescriptorFeature`). */
export interface AjustesProyecto {
    /** Carpeta (relativa a la raíz del repositorio) donde viven los
     *  documentos ODD de Features (`<carpeta>/*.md`). Variable de entorno:
     *  `TABLERO_CARPETA`. */
    carpetaFeatures: string;
    /** Carpeta (relativa a la raíz del repositorio) donde viven los
     *  documentos de Tareas (`<carpeta>/*.md`). Opcional en el repositorio:
     *  si la carpeta no existe o no tiene documentos, la entidad Tarea no
     *  hace nada. Variable de entorno: `TABLERO_CARPETA_TAREAS`. */
    carpetaTareas: string;
    /** Rama base que arma el enlace "Documento" de cada fila del tablero:
     *  `https://github.com/<owner>/<repo>/blob/<esta rama>/<carpeta>/<slug>.md`.
     *  Normalmente es la rama por defecto del repositorio. Variable de
     *  entorno: `TABLERO_RAMA_BASE`. */
    ramaBaseDocumento: string;
    /** `true` si la entidad Tarea está deshabilitada: `TABLERO_CARPETA_TAREAS`
     *  no se definió y su carpeta por defecto es la misma que la de Features
     *  (un proyecto solo de Features que usa `odd/tareas`). Ausente → las
     *  Tareas se sincronizan si tienen documentos. */
    tareasDeshabilitadas?: boolean;
}

/** Valores cuando la variable de entorno correspondiente no está definida. */
export const AJUSTES_POR_DEFECTO: AjustesProyecto = {
    carpetaFeatures: 'odd/tasks',
    carpetaTareas: 'odd/tareas',
    ramaBaseDocumento: 'main',
};

/** Resuelve los ajustes a partir de un entorno dado (en uso real,
 *  el entorno del proceso, leído por `adapters/config.ts`). Una variable ausente toma
 *  el valor por defecto; una definida (aun vacía) se respeta tal cual. Si
 *  `TABLERO_CARPETA_TAREAS` no está definida y su valor por defecto es la
 *  carpeta de Features, las Tareas quedan deshabilitadas
 *  (`tareasDeshabilitadas`) en vez de chocar con las Features. */
export function resolverAjustesProyecto(entorno: Readonly<Record<string, string | undefined>>): AjustesProyecto {
    const ajustes: AjustesProyecto = {
        carpetaFeatures: entorno.TABLERO_CARPETA ?? AJUSTES_POR_DEFECTO.carpetaFeatures,
        carpetaTareas: entorno.TABLERO_CARPETA_TAREAS ?? AJUSTES_POR_DEFECTO.carpetaTareas,
        ramaBaseDocumento: entorno.TABLERO_RAMA_BASE ?? AJUSTES_POR_DEFECTO.ramaBaseDocumento,
    };
    const choqueImplicito =
        entorno.TABLERO_CARPETA_TAREAS === undefined &&
        normalizarCarpeta(ajustes.carpetaTareas) === normalizarCarpeta(ajustes.carpetaFeatures);
    return choqueImplicito ? { ...ajustes, tareasDeshabilitadas: true } : ajustes;
}

/** Forma canónica de una carpeta relativa, para comparar dos carpetas: sin
 *  espacios en los extremos, con `/` como separador, sin segmentos vacíos ni
 *  `.`. `''` si no queda nada (ej. `'./'`). */
export function normalizarCarpeta(carpeta: string): string {
    return carpeta
        .trim()
        .replace(/\\/g, '/')
        .split('/')
        .filter((segmento) => segmento !== '' && segmento !== '.')
        .join('/');
}

/** Error de configuración de los ajustes (o `null` si son válidos): la
 *  carpeta de Tareas no puede quedar vacía ni ser la misma que la de
 *  Features (sus documentos se leerían como Tareas y como Features). Solo
 *  aplica si las Tareas no están deshabilitadas (ver
 *  `resolverAjustesProyecto`). */
export function validarAjustesProyecto(ajustes: AjustesProyecto): string | null {
    // Deshabilitadas: su carpeta no se usa, así que no puede chocar.
    if (ajustes.tareasDeshabilitadas) return null;
    const carpetaTareas = normalizarCarpeta(ajustes.carpetaTareas);
    if (carpetaTareas === '') {
        return `TABLERO_CARPETA_TAREAS está vacía: indicá la carpeta de los documentos de Tareas (por defecto, ${AJUSTES_POR_DEFECTO.carpetaTareas}).`;
    }
    if (carpetaTareas === normalizarCarpeta(ajustes.carpetaFeatures)) {
        return `TABLERO_CARPETA_TAREAS ("${ajustes.carpetaTareas}") es la misma carpeta que TABLERO_CARPETA ("${ajustes.carpetaFeatures}"): las Tareas necesitan su propia carpeta.`;
    }
    return null;
}
