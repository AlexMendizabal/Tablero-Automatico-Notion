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
    /** `false` si el sistema de archivos no distingue mayúsculas (Windows,
     *  macOS): dos carpetas que solo difieren en mayúsculas son la misma.
     *  Ausente → se distinguen (POSIX). Lo resuelve `adapters/config.ts`
     *  según la plataforma. */
    rutasSensiblesAMayusculas?: boolean;
}

/** Cómo comparar dos carpetas (ver `normalizarCarpeta`). */
export interface OpcionesRutas {
    /** `false` → se comparan sin distinguir mayúsculas. Por defecto, `true`. */
    sensibleAMayusculas?: boolean;
    /** Raíz del repositorio: una carpeta absoluta dentro de ella se compara
     *  como relativa a la raíz. */
    raizRepo?: string;
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
 *  (`tareasDeshabilitadas`) en vez de chocar con las Features. Con
 *  `sensibleAMayusculas` (lo pasa `adapters/config.ts` según la
 *  plataforma), esa comparación y la de `validarAjustesProyecto` siguen la
 *  regla del sistema de archivos (ver `rutasSensiblesAMayusculas`). */
export function resolverAjustesProyecto(
    entorno: Readonly<Record<string, string | undefined>>,
    opciones: { sensibleAMayusculas?: boolean } = {},
): AjustesProyecto {
    const ajustes: AjustesProyecto = {
        carpetaFeatures: entorno.TABLERO_CARPETA ?? AJUSTES_POR_DEFECTO.carpetaFeatures,
        carpetaTareas: entorno.TABLERO_CARPETA_TAREAS ?? AJUSTES_POR_DEFECTO.carpetaTareas,
        ramaBaseDocumento: entorno.TABLERO_RAMA_BASE ?? AJUSTES_POR_DEFECTO.ramaBaseDocumento,
        ...(opciones.sensibleAMayusculas === undefined
            ? {}
            : { rutasSensiblesAMayusculas: opciones.sensibleAMayusculas }),
    };
    const comparables = { sensibleAMayusculas: opciones.sensibleAMayusculas };
    const choqueImplicito =
        entorno.TABLERO_CARPETA_TAREAS === undefined &&
        normalizarCarpeta(ajustes.carpetaTareas, comparables) === normalizarCarpeta(ajustes.carpetaFeatures, comparables);
    return choqueImplicito ? { ...ajustes, tareasDeshabilitadas: true } : ajustes;
}

/** Una ruta partida en su prefijo absoluto (`''` si es relativa, `'/'` o
 *  una unidad de Windows como `'c:/'`) y sus segmentos ya resueltos. */
interface RutaSegmentada {
    prefijo: string;
    segmentos: string[];
}

/** Reglas POSIX sobre el texto (el núcleo no toca el sistema de archivos):
 *  `\` como `/`, sin segmentos vacíos ni `.`, y cada `..` se come el
 *  segmento anterior (en una ruta absoluta, no sube más allá de la raíz). */
function segmentarRuta(ruta: string, sensibleAMayusculas: boolean): RutaSegmentada {
    let texto = ruta.trim().replace(/\\/g, '/');
    if (!sensibleAMayusculas) texto = texto.toLowerCase();
    const unidad = /^([a-z]):(\/|$)/i.exec(texto);
    const prefijo = unidad ? `${unidad[1].toLowerCase()}:/` : texto.startsWith('/') ? '/' : '';
    const segmentos: string[] = [];
    for (const segmento of texto.slice(unidad ? unidad[0].length : 0).split('/')) {
        if (segmento === '' || segmento === '.') continue;
        if (segmento !== '..') segmentos.push(segmento);
        else if (segmentos.length > 0 && segmentos[segmentos.length - 1] !== '..') segmentos.pop();
        else if (prefijo === '') segmentos.push('..');
    }
    return { prefijo, segmentos };
}

/** Forma canónica de una carpeta, para comparar dos carpetas: sin espacios
 *  en los extremos, con `/` como separador, sin segmentos vacíos ni `.` y
 *  con los `..` resueltos. Sin distinguir mayúsculas si
 *  `sensibleAMayusculas` es `false`. Una ruta absoluta dentro de `raizRepo`
 *  queda relativa a la raíz. `''` si no queda nada (ej. `'./'`). */
export function normalizarCarpeta(carpeta: string, opciones: OpcionesRutas = {}): string {
    const sensible = opciones.sensibleAMayusculas !== false;
    const ruta = segmentarRuta(carpeta, sensible);
    if (ruta.prefijo !== '' && opciones.raizRepo !== undefined) {
        const raiz = segmentarRuta(opciones.raizRepo, sensible);
        const dentroDeLaRaiz =
            raiz.prefijo === ruta.prefijo &&
            raiz.segmentos.length <= ruta.segmentos.length &&
            raiz.segmentos.every((segmento, i) => ruta.segmentos[i] === segmento);
        if (dentroDeLaRaiz) return ruta.segmentos.slice(raiz.segmentos.length).join('/');
    }
    return ruta.prefijo + ruta.segmentos.join('/');
}

/** Error de configuración de los ajustes (o `null` si son válidos): la
 *  carpeta de Tareas no puede quedar vacía ni ser la misma que la de
 *  Features (sus documentos se leerían como Tareas y como Features). Solo
 *  aplica si las Tareas no están deshabilitadas (ver
 *  `resolverAjustesProyecto`). Con `raizRepo`, una carpeta absoluta dentro
 *  del repositorio se compara como relativa a él. */
export function validarAjustesProyecto(ajustes: AjustesProyecto, raizRepo?: string): string | null {
    // Deshabilitadas: su carpeta no se usa, así que no puede chocar.
    if (ajustes.tareasDeshabilitadas) return null;
    const opciones: OpcionesRutas = { sensibleAMayusculas: ajustes.rutasSensiblesAMayusculas, raizRepo };
    const carpetaTareas = normalizarCarpeta(ajustes.carpetaTareas, opciones);
    if (carpetaTareas === '') {
        return `TABLERO_CARPETA_TAREAS está vacía: indicá la carpeta de los documentos de Tareas (por defecto, ${AJUSTES_POR_DEFECTO.carpetaTareas}).`;
    }
    if (carpetaTareas === normalizarCarpeta(ajustes.carpetaFeatures, opciones)) {
        return `TABLERO_CARPETA_TAREAS ("${ajustes.carpetaTareas}") es la misma carpeta que TABLERO_CARPETA ("${ajustes.carpetaFeatures}"): las Tareas necesitan su propia carpeta.`;
    }
    return null;
}
