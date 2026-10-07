/**
 * Orquestación del sync: lee documentos, calcula filas, valida contra Notion
 * y escribe (o solo informa, con "--dry-run").
 */
import { validarAjustesProyecto } from '../core/ajustes';
import type { AutorCommit } from '../core/contribuyentes';
import { mensajeDeError } from '../core/errores';
import { type ResultadoIdioma, resolverIdiomaTablero } from '../core/i18n';
import { normalizarIdBaseNotion } from '../core/id-notion';
import { crearDescriptorFeature } from '../core/entities/feature';
import { crearDescriptorTarea, type RelacionFeatures } from '../core/entities/tarea';
import type { AvisoDocumento, DescriptorEntidad, FilaEntidad } from '../core/entities/tipos';
import { planificarSync, resolverDuplicadosPorSlug } from '../core/plan';
import { extraerPaginaExistente, traducirPropiedadesEntidad, validarEsquemaEntidad } from '../core/schema';
import { coincideRama } from '../core/status';
import type { DocumentoODD, DuplicadoSlug, PropiedadInvalida, RamaConFecha } from '../core/types';
import type { DependenciasSincronizar } from '../ports/sincronizar';

export interface OpcionesCLI {
    dryRun: boolean;
}

export interface ResumenSincronizacion {
    /** Entidad sincronizada (`DescriptorEntidad.clave`, ej. `'feature'`). No
     *  se imprime: el resumen visible es el mismo para cualquier entidad. */
    entidad: string;
    codigo: number;
    creadas: number;
    actualizadas: number;
    cuerposReescritos: number;
    huerfanas: string[];
    erroresDeFormato: Array<{ slug: string; errores: string[] }>;
    consultoNotion: boolean;
    /** Solo presente en "--dry-run" CON credenciales: el plan que se
     *  ejecutaría, sin haber escrito nada todavía. */
    plan?: {
        crearia: number;
        actualizaria: number;
        cuerposAReescribir: number;
    };
    /** Slugs duplicados entre las páginas existentes de Notion (ver
     *  `resolverDuplicadosPorSlug`). Presente (posiblemente vacío) toda vez
     *  que se consultó Notion. */
    duplicadas?: DuplicadoSlug[];
    /** Motivo por el que el plan de escritura NO se calculó, cuando la razón
     *  es DISTINTA de "no se consultó Notion" (esquema inválido, o
     *  `NOTION_TABLERO_DB_ID` mal formado): `imprimirResumenFinal` lo usa
     *  para la línea "Plan de escritura: no calculado (...)". Ausente en el
     *  resto de los casos, incluido el de sin credenciales, que conserva su
     *  texto fijo (una revisión anterior detectó que antes esos dos casos
     *  imprimían contadores de escritura en cero, indistinguibles de un plan
     *  real sin altas, y se agregó este campo para distinguirlos). */
    razonNoCalculado?: string;
    /** Avisos sobre documentos que se sincronizan igual (ver
     *  `DescriptorEntidad.avisosDocumentos`). Solo presente si hay alguno;
     *  no cambian el código de salida. */
    avisos?: AvisoDocumento[];
    /** Slugs de TODOS los documentos leídos de la carpeta de la entidad
     *  (válidos o no). Ausente si la carpeta no se pudo leer. No se imprime:
     *  `sincronizar` lo usa para validar la feature padre de las Tareas. */
    slugsDocumentos?: string[];
    /** Data source de la base de Notion de la entidad, cuando se llegó a
     *  resolver. No se imprime: `sincronizar` lo usa para validar que la
     *  relación "Feature" de las Tareas apunte a la base de Features. */
    dataSourceId?: string;
    /** Slug → id de página de la base de la entidad, presente solo si se
     *  llegaron a listar sus páginas: las existentes (una por slug, ver
     *  `resolverDuplicadosPorSlug`) y, en una corrida real, también las
     *  recién creadas. No se imprime: las Tareas lo usan para resolver su
     *  relación "Feature". */
    paginasPorSlug?: ReadonlyMap<string, string>;
    /** Solo en "--dry-run" con credenciales: slugs de las páginas que se
     *  crearían (todavía sin id). */
    slugsPorCrear?: string[];
}

/** Resumen de `sincronizar`: el de Features (los mismos campos de siempre),
 *  con `codigo` agregado (distinto de 0 si CUALQUIER entidad falló) y, si
 *  se sincronizaron Tareas, su propio resumen en `tareas`. */
export interface ResumenGeneral extends ResumenSincronizacion {
    tareas?: ResumenSincronizacion;
}

// ---------------------------------------------------------------------------
// Orquestación
// ---------------------------------------------------------------------------

/**
 * Imprime el resumen final, en CUATRO formas mutuamente excluyentes:
 *
 * 1. `resumen.plan` presente ("--dry-run" CON credenciales, esquema válido):
 *    se consultó Notion en modo lectura, así que el plan SÍ se conoce, pero
 *    nada se escribió — se muestra "Crearía/Actualizaría/Cuerpos a
 *    reescribir/Huérfanas", cada número una sola vez, y nunca "Creadas:"
 *    (que implicaría una escritura que no ocurrió).
 * 2. `resumen.razonNoCalculado` presente (agregado en una corrección
 *    posterior): el plan NO se calculó por
 *    un motivo puntual — esquema inválido, o `NOTION_TABLERO_DB_ID` mal
 *    formado — así que se imprime esa razón en vez de contadores en cero,
 *    que antes eran indistinguibles de un plan real sin altas.
 * 3. `consultoNotion` true, sin `plan` ni `razonNoCalculado` (escritura
 *    real): se muestran los contadores reales de lo que se hizo.
 * 4. Ninguna de las anteriores (sin credenciales, con o sin "--dry-run"):
 *    esos datos no se calcularon — un "0" ahí sería indistinguible de un
 *    plan real con cero altas, el defecto documentado del `--dry-run` del
 *    sync viejo de fichas — así que se imprime un aviso explícito fijo.
 *
 * El conteo de errores de formato (y de slugs duplicados, si los hay) se
 * imprime siempre: no depende de haber consultado Notion.
 */
function imprimirResumenFinal(log: (linea: string) => void, resumen: ResumenSincronizacion): void {
    if (resumen.plan) {
        log(`Crearía: ${resumen.plan.crearia}`);
        log(`Actualizaría: ${resumen.plan.actualizaria}`);
        log(`Cuerpos a reescribir: ${resumen.plan.cuerposAReescribir}`);
        log(
            `Huérfanas: ${resumen.huerfanas.length}` +
                (resumen.huerfanas.length > 0 ? ` (${resumen.huerfanas.join(', ')})` : ''),
        );
    } else if (resumen.razonNoCalculado) {
        log(`Plan de escritura: no calculado (${resumen.razonNoCalculado}).`);
    } else if (resumen.consultoNotion) {
        log(`Creadas: ${resumen.creadas}`);
        log(`Actualizadas: ${resumen.actualizadas}`);
        log(`Cuerpos reescritos: ${resumen.cuerposReescritos}`);
        log(
            `Huérfanas: ${resumen.huerfanas.length}` +
                (resumen.huerfanas.length > 0 ? ` (${resumen.huerfanas.join(', ')})` : ''),
        );
    } else {
        log('Plan de escritura: no calculado (no se consultó Notion).');
    }
    if (resumen.duplicadas && resumen.duplicadas.length > 0) {
        log(`Slugs duplicados en Notion (no se borra ninguno): ${resumen.duplicadas.length}`);
        for (const duplicado of resumen.duplicadas) {
            log(`  ${duplicado.slug}: ${duplicado.pageIds.join(', ')}`);
        }
    }
    imprimirAvisos(log, resumen.avisos);
    log(`Errores de formato: ${resumen.erroresDeFormato.length}`);
    for (const error of resumen.erroresDeFormato) {
        log(`  ${error.slug}:`);
        for (const mensaje of error.errores) log(`    - ${mensaje}`);
    }
}

/** Bloque "Avisos: N" (nada si no hay avisos). Lo usan el resumen final y
 *  los retornos tempranos por error de entorno, para que el log diga lo mismo
 *  que el resumen devuelto. */
function imprimirAvisos(log: (linea: string) => void, avisos: AvisoDocumento[] | undefined): void {
    if (!avisos || avisos.length === 0) return;
    log(`Avisos: ${avisos.length}`);
    for (const aviso of avisos) {
        log(`  ${aviso.slug}:`);
        for (const mensaje of aviso.mensajes) log(`    - ${mensaje}`);
    }
}

/** Razones cortas para `ResumenSincronizacion.razonNoCalculado` (agregado en
 *  una corrección posterior): las
 *  usa `imprimirResumenFinal` en la línea "Plan de escritura: no calculado
 *  (...)". El mensaje detallado (con más contexto) ya se logueó aparte en el
 *  punto donde se detectó cada problema. */
const RAZON_ID_INVALIDO = 'el ID de la base de Notion no es válido';
const RAZON_ESQUEMA_INVALIDO = 'el esquema de la base de Notion no coincide';
const RAZON_IDIOMA_INVALIDO = 'el idioma del tablero (BOARD_LANGUAGE) no es válido';
const RAZON_AJUSTES_INVALIDOS = 'las carpetas de documentos no son válidas';

/** Construye y loguea el resumen de un fallo de entorno (carpeta faltante,
 *  git no disponible, clon superficial con anclas declaradas): código 1,
 *  nunca se llegó a consultar Notion. Distinto de un error de formato — no
 *  es culpa de ningún documento en particular. */
function resumenDeErrorEntorno(
    log: (linea: string) => void,
    entidad: string,
    mensaje: string,
): ResumenSincronizacion {
    log(`Error de entorno: ${mensaje}`);
    return {
        entidad,
        codigo: 1,
        creadas: 0,
        actualizadas: 0,
        cuerposReescritos: 0,
        huerfanas: [],
        erroresDeFormato: [],
        consultoNotion: false,
    };
}

/** Línea del log para un problema del esquema de la base de Notion. */
function mensajeProblemaEsquema(problema: PropiedadInvalida): string {
    switch (problema.motivo) {
        case 'faltante':
            return `Falta la propiedad "${problema.nombre}" (tipo ${problema.tipoEsperado}) en la base de Notion.`;
        case 'tipo-incorrecto':
            return `La propiedad "${problema.nombre}" es de tipo "${problema.tipoActual}", debería ser "${problema.tipoEsperado}".`;
        case 'relacion-incorrecta':
            return `La propiedad "${problema.nombre}" es una relación con otra base (data source "${problema.destinoActual ?? 'desconocido'}"): debería apuntar a la base de Features (data source "${problema.destinoEsperado}").`;
    }
}

/** Separa la huella del resto de los valores: la huella se escribe siempre
 *  al final, en su propio PATCH (ver "Huella al final" más abajo). */
function separarHuella<C extends string>(
    claveHuella: C,
    valores: Partial<Record<C, unknown>>,
): { huella: Partial<Record<C, unknown>>; resto: Partial<Record<C, unknown>> } {
    const resto: Partial<Record<C, unknown>> = { ...valores };
    delete resto[claveHuella];
    const huella: Partial<Record<C, unknown>> = {};
    huella[claveHuella] = valores[claveHuella];
    return { huella, resto };
}

/** Línea informativa (no es un error) cuando hay Tareas pero no base de
 *  Notion para ellas. */
const MENSAJE_SIN_BASE_TAREAS =
    'NOTION_TAREAS_DB_ID no está definido: se omite la sincronización de Tareas con Notion.';

/** Línea informativa cuando Features no terminó (error de entorno, de
 *  configuración o de esquema) y las Tareas no pueden escribir su relación. */
const MENSAJE_FEATURES_INCOMPLETA =
    'La sincronización de Features no terminó: se omite la sincronización de Tareas con Notion (su relación "Feature" quedaría incompleta).';

/**
 * Sincroniza las Features y, después, las Tareas, cada una con
 * `sincronizarEntidad` y su propia base de Notion. Reglas de las Tareas:
 *
 * - Sin documentos en su carpeta (no existe, o no tiene ningún `.md`): no
 *   hacen nada ni imprimen nada — la salida es la de solo Features.
 * - Con documentos, su salida va después de la de Features, bajo una línea
 *   "Tareas:".
 * - Con credenciales pero sin `NOTION_TAREAS_DB_ID`: se omite Notion con una
 *   línea informativa, pero sus documentos se validan igual (un error de
 *   formato da código 1; los avisos se imprimen).
 * - Sin credenciales y sin "--dry-run": se saltean en silencio (Features ya
 *   informó la falta de credenciales, con código 1).
 * - Si Features no llegó a listar sus páginas (error de entorno, de
 *   configuración o de esquema), las Tareas se validan pero no tocan Notion,
 *   con una línea informativa; el código de salida es el de Features.
 * - Cada Tarea escribe su relación "Feature" con la página de su feature
 *   padre (las de `paginasPorSlug` de Features que tienen documento: una
 *   página huérfana nunca se enlaza), o vacía si no tiene padre o su padre
 *   no tiene página (esto último, con un aviso).
 * - Una tarea cuya feature padre no existe genera un aviso, no un error.
 *
 * El código de salida es distinto de 0 si cualquiera de las dos falló.
 */
export async function sincronizar(
    opciones: OpcionesCLI,
    dependencias: DependenciasSincronizar,
): Promise<ResumenGeneral> {
    const log = dependencias.log ?? (() => {});
    // Carpetas mal configuradas: error de configuración antes de leer nada
    // o de llamar a Notion (ni siquiera se sincronizan las Features).
    const errorAjustes = validarAjustesProyecto(dependencias.ajustes);
    if (errorAjustes !== null) {
        log(errorAjustes);
        return {
            entidad: 'feature',
            codigo: 1,
            creadas: 0,
            actualizadas: 0,
            cuerposReescritos: 0,
            huerfanas: [],
            erroresDeFormato: [],
            consultoNotion: false,
            razonNoCalculado: RAZON_AJUSTES_INVALIDOS,
        };
    }
    // Se cargan una sola vez para las dos entidades.
    const credenciales =
        dependencias.credenciales !== undefined
            ? dependencias.credenciales
            : dependencias.configuracion.cargarCredenciales(dependencias.raizRepo);

    const features = await sincronizarEntidad(crearDescriptorFeature(dependencias.ajustes), opciones, {
        ...dependencias,
        credenciales,
    });
    // Tareas deshabilitadas (proyecto solo de Features cuya carpeta es la de
    // Tareas por defecto): ni se lista su carpeta; la salida es la de Features.
    if (dependencias.ajustes.tareasDeshabilitadas) return features;

    const conTareas = (tareas: ResumenSincronizacion): ResumenGeneral => ({
        ...features,
        codigo: Math.max(features.codigo, tareas.codigo),
        tareas,
    });

    // Sin la lista de documentos de Features (carpeta ilegible) no se puede
    // validar la feature padre: no se avisa nada en vez de avisar de todas.
    const slugsFeatures = features.slugsDocumentos ? new Set(features.slugsDocumentos) : undefined;

    // Las Tareas tocan Notion solo si tienen base y si Features terminó: sin
    // la lista de páginas de Features, su relación "Feature" se escribiría
    // vacía (o se borraría) con información incompleta.
    const sinBaseTareas = credenciales !== null && !credenciales.databaseIdTareas;
    const featuresIncompleta = credenciales !== null && !sinBaseTareas && !features.paginasPorSlug;
    // Solo páginas con documento de Features en el repo (válido o no): una
    // página huérfana (su documento se borró) nunca se enlaza, así la
    // relación coincide con el aviso de "no existe". Sin la lista de
    // documentos no se filtra: vaciar todas las relaciones con información
    // incompleta sería peor que enlazar una huérfana.
    const relacion: RelacionFeatures | undefined =
        features.paginasPorSlug && !sinBaseTareas
            ? {
                  paginas: new Map(
                      [...features.paginasPorSlug].filter(([slug]) => slugsFeatures?.has(slug) ?? true),
                  ),
                  porCrear: new Set(features.slugsPorCrear ?? []),
              }
            : undefined;
    const descriptorTarea = crearDescriptorTarea(dependencias.ajustes, slugsFeatures, relacion);

    let documentosTareas: Array<{ slug: string; contenido: string }>;
    try {
        documentosTareas = dependencias.listarDocumentos(descriptorTarea.carpeta, { opcional: true });
    } catch (error) {
        log('');
        log('Tareas:');
        return conTareas(resumenDeErrorEntorno(log, descriptorTarea.clave, mensajeDeError(error)));
    }
    if (documentosTareas.length === 0) return features;
    if (!credenciales && !opciones.dryRun) return features;

    log('');
    log('Tareas:');
    // En los dos casos, sus documentos se validan igual (errores de
    // formato, avisos de feature padre): solo se omite Notion.
    if (sinBaseTareas) log(MENSAJE_SIN_BASE_TAREAS);
    else if (featuresIncompleta) log(MENSAJE_FEATURES_INCOMPLETA);

    const tareas = await sincronizarEntidad(
        descriptorTarea,
        opciones,
        {
            ...dependencias,
            // Ya leídos (y no vacíos) más arriba.
            listarDocumentos: () => documentosTareas,
            credenciales:
                credenciales && credenciales.databaseIdTareas
                    ? { token: credenciales.token, databaseId: credenciales.databaseIdTareas }
                    : null,
        },
        {
            omitirNotion: sinBaseTareas || featuresIncompleta,
            ...(features.dataSourceId ? { destinosRelacion: { feature: features.dataSourceId } } : {}),
        },
    );
    return conTareas(tareas);
}

/**
 * Lector de los autores de commits de un documento (fuente de sus
 * contribuyentes): los de cada rama viva que matchea sus `ramas` (local u
 * `origin/`) que no están en la rama base, y los de sus anclas de
 * `commits`. La rama base (`origin/<base>` o, si no existe, la local) se
 * resuelve una sola vez y solo si algún documento tiene ramas vivas; si no
 * existe, los commits de ramas se saltean con un único aviso (no es un
 * error). Cada rama se consulta una sola vez por entidad.
 */
function crearLectorAutores(
    dependencias: DependenciasSincronizar,
    todasLasRamas: RamaConFecha[],
    log: (linea: string) => void,
): (documento: DocumentoODD) => AutorCommit[] {
    const { repositorio } = dependencias;
    const ramaBase = dependencias.ajustes.ramaBaseDocumento;
    let refBase: string | null | undefined;
    const porRama = new Map<string, AutorCommit[]>();
    const autoresDeRama = (base: string, rama: string): AutorCommit[] => {
        let autores = porRama.get(rama);
        if (autores === undefined) {
            autores = repositorio.autoresDeRango(base, rama);
            porRama.set(rama, autores);
        }
        return autores;
    };
    return (documento) => {
        const ramas = todasLasRamas.filter((r) => documento.ramas.some((patron) => coincideRama(patron, r.nombre)));
        const deRamas: AutorCommit[] = [];
        if (ramas.length > 0) {
            if (refBase === undefined) {
                refBase = repositorio.refRamaBase(ramaBase);
                if (refBase === null) {
                    log(
                        `Aviso: no existe la rama base "${ramaBase}" (ni "origin/${ramaBase}"): los contribuyentes no incluyen los commits de las ramas.`,
                    );
                }
            }
            const base = refBase;
            if (base !== null) for (const rama of ramas) deRamas.push(...autoresDeRama(base, rama.nombre));
        }
        return [...deRamas, ...documento.commits.flatMap((sha) => repositorio.autoresDeCommit(sha))];
    };
}

/** Lo que `sincronizar` le pasa a una entidad además de sus dependencias. */
export interface ContextoEntidad<C extends string = string> {
    /** Data source al que debe apuntar cada propiedad `relation`, por clave
     *  interna (ver `validarEsquemaEntidad`). */
    destinosRelacion?: Partial<Record<C, string>>;
    /** Valida los documentos (parseo, anclas de "commits", filas, avisos)
     *  sin consultar Notion ni exigir credenciales, y cierra con el resumen
     *  de "no se consultó Notion". Lo usan las Tareas cuando no se las puede
     *  escribir (ej. sin `NOTION_TAREAS_DB_ID`). */
    omitirNotion?: boolean;
}

/**
 * Pipeline completo de UNA entidad, guiado por su descriptor: lee y parsea
 * sus documentos, resuelve anclas y actividad en git/gh, arma las filas,
 * valida el esquema de su base de Notion y escribe (o solo informa, con
 * "--dry-run").
 */
export async function sincronizarEntidad<
    C extends string,
    E extends string,
    D extends DocumentoODD,
    F extends FilaEntidad,
>(
    descriptor: DescriptorEntidad<C, E, D, F>,
    opciones: OpcionesCLI,
    dependencias: DependenciasSincronizar,
    contexto: ContextoEntidad<C> = {},
): Promise<ResumenSincronizacion> {
    const entidad = descriptor.clave;
    const log = dependencias.log ?? (() => {});
    const hoy = dependencias.hoy ?? new Date();

    // Una revisión anterior detectó que una carpeta "odd/tasks" faltante o
    // ilegible ya no se traga en silencio (antes devolvía [] y todo terminaba en "0 filas,
    // código 0, todo huérfano"). "listarDocumentos" ahora lanza en ese caso.
    let documentosLeidos: Array<{ slug: string; contenido: string }>;
    try {
        documentosLeidos = dependencias.listarDocumentos(descriptor.carpeta);
    } catch (error) {
        return resumenDeErrorEntorno(log, entidad, mensajeDeError(error));
    }

    const documentosParseados: D[] = [];
    const erroresDeFormato: Array<{ slug: string; errores: string[] }> = [];

    for (const { slug, contenido } of documentosLeidos) {
        const resultado = descriptor.parsearDocumento(slug, contenido);
        if (resultado.ok) documentosParseados.push(resultado.documento);
        else erroresDeFormato.push({ slug, errores: resultado.errores });
    }

    // Lo que todo resumen lleva a partir de acá: los slugs leídos y, si hay,
    // los avisos (que no son errores de formato ni cambian el código).
    const slugsDocumentos = documentosLeidos.map((d) => d.slug);
    const avisos = descriptor.avisosDocumentos?.(documentosParseados) ?? [];
    const completar = (resumen: ResumenSincronizacion): ResumenSincronizacion => ({
        ...resumen,
        ...(avisos.length > 0 ? { avisos } : {}),
        slugsDocumentos,
    });
    const cerrar = (resumen: ResumenSincronizacion): ResumenSincronizacion => {
        const completo = completar(resumen);
        imprimirResumenFinal(log, completo);
        return completo;
    };
    // Error de entorno: su línea y, si hay, los avisos (para que el log
    // coincida con el resumen devuelto).
    const cerrarPorEntorno = (mensaje: string): ResumenSincronizacion => {
        const completo = completar(resumenDeErrorEntorno(log, entidad, mensaje));
        imprimirAvisos(log, completo.avisos);
        return completo;
    };

    let credenciales = contexto.omitirNotion
        ? null
        : dependencias.credenciales !== undefined
          ? dependencias.credenciales
          : dependencias.configuracion.cargarCredenciales(dependencias.raizRepo);

    // El idioma se resuelve DESPUÉS de cargar el ".env" (lo hace
    // "cargarCredenciales"), para que BOARD_LANGUAGE pueda vivir ahí también.
    // Un valor inválido es un error de configuración, igual que un ID de base
    // mal formado: se informa antes de cualquier llamada a git/gh o Notion.
    const resultadoIdioma: ResultadoIdioma =
        dependencias.idioma !== undefined
            ? { ok: true, idioma: dependencias.idioma }
            : resolverIdiomaTablero(dependencias.configuracion.leerBoardLanguage());
    if (!resultadoIdioma.ok) {
        log(resultadoIdioma.error);
        const resumen: ResumenSincronizacion = {
            entidad,
            codigo: 1,
            creadas: 0,
            actualizadas: 0,
            cuerposReescritos: 0,
            huerfanas: [],
            erroresDeFormato,
            consultoNotion: false,
            razonNoCalculado: RAZON_IDIOMA_INVALIDO,
        };
        return cerrar(resumen);
    }
    const idioma = resultadoIdioma.idioma;

    // Una corrección posterior valida el ID de la base ANTES de cualquier
    // llamada de red — ni siquiera a git/gh — para no gastar tiempo si va a fallar igual. Se
    // aplica tanto si las credenciales vinieron inyectadas como si salieron
    // de "cargarCredenciales", y tanto en "--dry-run" como en corrida real.
    if (credenciales) {
        const resultadoId = normalizarIdBaseNotion(credenciales.databaseId, descriptor.variableBaseNotion);
        if (!resultadoId.ok) {
            log(resultadoId.error);
            const resumen: ResumenSincronizacion = {
                entidad,
                codigo: 1,
                creadas: 0,
                actualizadas: 0,
                cuerposReescritos: 0,
                huerfanas: [],
                erroresDeFormato,
                consultoNotion: false,
                razonNoCalculado: RAZON_ID_INVALIDO,
            };
            return cerrar(resumen);
        }
        credenciales = { ...credenciales, databaseId: resultadoId.id };
    }

    if (!credenciales && !opciones.dryRun && !contexto.omitirNotion) {
        log(
            'Faltan NOTION_TOKEN y/o NOTION_TABLERO_DB_ID. No se realizó ninguna llamada de red ni de Notion.',
        );
        const resumen: ResumenSincronizacion = {
            entidad,
            codigo: 1,
            creadas: 0,
            actualizadas: 0,
            cuerposReescritos: 0,
            huerfanas: [],
            erroresDeFormato,
            consultoNotion: false,
        };
        return cerrar(resumen);
    }

    // A partir de acá está autorizado tocar git/gh (dry-run con o sin
    // credenciales, o escritura real).
    //
    // Una revisión anterior detectó lo siguiente: antes de resolver anclas
    // de "commits", si algún documento las declara, hay que descartar dos problemas de ENTORNO que
    // NO son "el commit no existe" (error de formato de un documento
    // puntual): que el repo sea un clon superficial (las anclas requieren
    // fetch-depth: 0) o que git directamente no pueda correr (ENOENT). En
    // ambos casos la excepción de "esRepoSuperficial" se deja
    // propagar a propósito (no tiene su propio try/catch) para distinguirlos
    // de "fechaCommit", que sí atrapa el fallo puntual de un hash.
    const algunDocumentoDeclaraCommits = documentosParseados.some((d) => d.commits.length > 0);
    if (algunDocumentoDeclaraCommits) {
        let esSuperficial: boolean;
        try {
            esSuperficial = dependencias.repositorio.esRepoSuperficial();
        } catch (error) {
            return cerrarPorEntorno(
                `No se pudo determinar si el repositorio es superficial (¿git no está disponible?): ${mensajeDeError(error)}`,
            );
        }
        if (esSuperficial) {
            return cerrarPorEntorno(
                'Repositorio superficial: las anclas de "commits" requieren un clon completo (fetch-depth: 0).',
            );
        }
    }

    // Ahora sí: un hash que no existe en un repo completo, con git
    // funcionando, es un error de formato del documento — se saltea como
    // cualquier otro, nunca en silencio.
    const documentosValidos: D[] = [];
    const fechasCommitsPorSlug = new Map<string, string[]>();
    for (const documento of documentosParseados) {
        const fechasCommits: string[] = [];
        let commitInexistente: string | null = null;
        for (const sha of documento.commits) {
            const fecha = dependencias.repositorio.fechaCommit(sha);
            if (fecha === null) {
                commitInexistente = sha;
                break;
            }
            fechasCommits.push(fecha);
        }
        if (commitInexistente !== null) {
            erroresDeFormato.push({
                slug: documento.slug,
                errores: [
                    `El commit "${commitInexistente}" listado en "commits" no existe en el repositorio.`,
                ],
            });
            continue;
        }
        documentosValidos.push(documento);
        fechasCommitsPorSlug.set(documento.slug, fechasCommits);
    }

    const todasLasRamas = dependencias.repositorio.ramasConFecha();
    const todosLosPRs = dependencias.repositorio.prs();
    const ownerRepo = dependencias.repositorio.ownerRepo();
    const autoresDeDocumento = crearLectorAutores(dependencias, todasLasRamas, log);

    const filas = documentosValidos.map((documento) =>
        descriptor.construirFila({
            documento,
            todasLasRamas,
            todosLosPRs,
            fechasCommits: fechasCommitsPorSlug.get(documento.slug) ?? [],
            autoresCommits: autoresDeDocumento(documento),
            fechaDocumento: dependencias.repositorio.fechaDocumento(`${descriptor.carpeta}/${documento.slug}.md`),
            hoy,
            ownerRepo,
            idioma,
        }),
    );

    const resumenSinNotion = (): ResumenSincronizacion => ({
        entidad,
        codigo: erroresDeFormato.length > 0 ? 1 : 0,
        creadas: 0,
        actualizadas: 0,
        cuerposReescritos: 0,
        huerfanas: [],
        erroresDeFormato,
        consultoNotion: false,
    });

    // Validado todo lo que no depende de Notion: sin escribir (ni leer) nada.
    if (contexto.omitirNotion) return cerrar(resumenSinNotion());

    if (!credenciales) {
        log('--dry-run sin credenciales: NO se consultó Notion. Filas calculadas desde el repositorio:');
        log(descriptor.encabezadoFilaLegible);
        for (const fila of filas) log(descriptor.formatearFilaLegible(fila));
        return cerrar(resumenSinNotion());
    }

    const cliente = dependencias.crearClienteNotion(credenciales.token);

    const dataSourceId = await cliente.obtenerDataSourceId(credenciales.databaseId);
    const esquemaActual = await cliente.obtenerEsquema(dataSourceId);
    const problemasEsquema = validarEsquemaEntidad(descriptor, esquemaActual, idioma, contexto.destinosRelacion);

    if (problemasEsquema.length > 0) {
        for (const problema of problemasEsquema) log(mensajeProblemaEsquema(problema));
        // Una corrección posterior sumó esto: además de decir qué falta,
        // decir qué SÍ hay — el usuario se encontró con 11 avisos de "Falta la propiedad ..." sin ninguna
        // pista de qué tenía la base en realidad (había creado FILAS en vez
        // de PROPIEDADES). El orden es el que devolvió Notion.
        const columnasEncontradas = Object.entries(esquemaActual);
        log(
            `Columnas encontradas en la base: ${
                columnasEncontradas.length > 0
                    ? columnasEncontradas.map(([nombre, propiedad]) => `${nombre} (${propiedad.type})`).join(', ')
                    : '(ninguna)'
            }`,
        );
        const resumen: ResumenSincronizacion = {
            entidad,
            codigo: 1,
            creadas: 0,
            actualizadas: 0,
            cuerposReescritos: 0,
            huerfanas: [],
            erroresDeFormato,
            consultoNotion: true,
            razonNoCalculado: RAZON_ESQUEMA_INVALIDO,
            dataSourceId,
        };
        return cerrar(resumen);
    }

    const paginasNotion = await cliente.listarTodasLasPaginas(dataSourceId);
    const paginasExistentesCrudas = paginasNotion.map((pagina) =>
        extraerPaginaExistente(descriptor, pagina, idioma),
    );
    // Una revisión anterior detectó esto: los slugs duplicados en Notion se
    // informan (nunca se borran, nunca se sobrescriben en silencio como hacía el Map anterior).
    const { unicas: paginasExistentes, duplicadas } = resolverDuplicadosPorSlug(paginasExistentesCrudas);
    const plan = planificarSync(filas, paginasExistentes);
    const hayProblemasNoFormato = duplicadas.length > 0;
    // Slug → página: las existentes ahora; las creadas se suman al crearlas.
    const paginasPorSlug = new Map(
        paginasExistentes.filter((p) => p.slug !== '').map((p) => [p.slug, p.pageId] as const),
    );

    if (opciones.dryRun) {
        log('--dry-run con credenciales: se consultó Notion en modo lectura; no se escribió nada.');
        for (const linea of descriptor.detallePlan?.(filas) ?? []) log(linea);
        const cuerposNuevos = plan.actualizar.filter((a) => a.reescribirCuerpo).length;
        const resumen: ResumenSincronizacion = {
            entidad,
            codigo: erroresDeFormato.length > 0 || hayProblemasNoFormato ? 1 : 0,
            creadas: 0,
            actualizadas: 0,
            cuerposReescritos: 0,
            huerfanas: plan.huerfanas.map((h) => h.slug),
            erroresDeFormato,
            consultoNotion: true,
            plan: {
                crearia: plan.crear.length,
                actualizaria: plan.actualizar.length,
                cuerposAReescribir: cuerposNuevos,
            },
            duplicadas,
            dataSourceId,
            paginasPorSlug,
            slugsPorCrear: plan.crear.map((fila) => fila.slug),
        };
        return cerrar(resumen);
    }

    // ("Huella al final"): la Huella se escribe SIEMPRE
    // en último lugar, en su propio PATCH, recién cuando el cuerpo quedó
    // completo. Si algo falla antes de esa última escritura, la Huella en
    // Notion sigue siendo la vieja — la corrida siguiente ve que no coincide
    // con la calculada y "planificarSync" vuelve a marcar el cuerpo para
    // reescribir, así que se autorepara solo.
    for (const fila of plan.crear) {
        const documento = documentosValidos.find((d) => d.slug === fila.slug);
        if (!documento) continue;
        const { huella, resto } = separarHuella(
            descriptor.claveHuella,
            descriptor.construirValoresPropiedades(fila, idioma),
        );
        const pageId = await cliente.crearPagina(
            dataSourceId,
            traducirPropiedadesEntidad(descriptor, resto, idioma),
            documento.tareas,
        );
        await cliente.actualizarPropiedades(pageId, traducirPropiedadesEntidad(descriptor, huella, idioma));
        paginasPorSlug.set(fila.slug, pageId);
    }

    let cuerposReescritos = 0;
    for (const item of plan.actualizar) {
        const valores = descriptor.construirValoresPropiedades(item.fila, idioma);
        if (!item.reescribirCuerpo) {
            // Sin reescritura de cuerpo no hay ventana de inconsistencia:
            // todas las propiedades (Huella incluida, que no cambió) se
            // mandan juntas, como antes.
            await cliente.actualizarPropiedades(item.pageId, traducirPropiedadesEntidad(descriptor, valores, idioma));
            continue;
        }
        const documento = documentosValidos.find((d) => d.slug === item.fila.slug);
        if (!documento) continue;
        const { huella, resto } = separarHuella(descriptor.claveHuella, valores);
        await cliente.actualizarPropiedades(item.pageId, traducirPropiedadesEntidad(descriptor, resto, idioma));
        await cliente.reescribirCuerpo(item.pageId, documento.tareas);
        await cliente.actualizarPropiedades(item.pageId, traducirPropiedadesEntidad(descriptor, huella, idioma));
        cuerposReescritos++;
    }

    const resumen: ResumenSincronizacion = {
        entidad,
        codigo: erroresDeFormato.length > 0 || hayProblemasNoFormato ? 1 : 0,
        creadas: plan.crear.length,
        actualizadas: plan.actualizar.length,
        cuerposReescritos,
        huerfanas: plan.huerfanas.map((h) => h.slug),
        erroresDeFormato,
        consultoNotion: true,
        duplicadas,
        dataSourceId,
        paginasPorSlug,
    };
    return cerrar(resumen);
}
