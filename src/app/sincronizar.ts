/**
 * Orquestación del sync: lee documentos, calcula filas, valida contra Notion
 * y escribe (o solo informa, con "--dry-run").
 */
import { mensajeDeError } from '../core/errores';
import { type ResultadoIdioma, resolverIdiomaTablero } from '../core/i18n';
import { normalizarIdBaseNotion } from '../core/id-notion';
import { parsearDocumento } from '../core/parse';
import { planificarSync, resolverDuplicadosPorSlug } from '../core/plan';
import { construirFila, formatearFilaLegible } from '../core/row';
import { construirValoresPropiedades, traducirPropiedades, validarEsquema } from '../core/schema';
import type { DocumentoODD, DuplicadoSlug } from '../core/types';
import { cargarCredenciales, leerBoardLanguage } from '../adapters/config';
import { obtenerOwnerRepo, obtenerPRs } from '../adapters/gh-cli';
import {
    obtenerEsRepoSuperficial,
    obtenerFechaCommit,
    obtenerFechaDocumento,
    obtenerRamasConFecha,
} from '../adapters/git-cli';
import { crearClienteNotion, dormirPorDefecto, extraerPaginaExistente } from '../adapters/notion-http';
import type { DependenciasSincronizar } from '../ports/sincronizar';

export interface OpcionesCLI {
    dryRun: boolean;
}

export interface ResumenSincronizacion {
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
    log(`Errores de formato: ${resumen.erroresDeFormato.length}`);
    for (const error of resumen.erroresDeFormato) {
        log(`  ${error.slug}:`);
        for (const mensaje of error.errores) log(`    - ${mensaje}`);
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

/** Construye y loguea el resumen de un fallo de entorno (carpeta faltante,
 *  git no disponible, clon superficial con anclas declaradas): código 1,
 *  nunca se llegó a consultar Notion. Distinto de un error de formato — no
 *  es culpa de ningún documento en particular. */
function resumenDeErrorEntorno(log: (linea: string) => void, mensaje: string): ResumenSincronizacion {
    log(`Error de entorno: ${mensaje}`);
    return {
        codigo: 1,
        creadas: 0,
        actualizadas: 0,
        cuerposReescritos: 0,
        huerfanas: [],
        erroresDeFormato: [],
        consultoNotion: false,
    };
}

export async function sincronizar(
    opciones: OpcionesCLI,
    dependencias: DependenciasSincronizar,
): Promise<ResumenSincronizacion> {
    const log = dependencias.log ?? (() => {});
    const hoy = dependencias.hoy ?? new Date();

    // Una revisión anterior detectó que una carpeta "odd/tasks" faltante o
    // ilegible ya no se traga en silencio (antes devolvía [] y todo terminaba en "0 filas,
    // código 0, todo huérfano"). "listarDocumentos" ahora lanza en ese caso.
    let documentosLeidos: Array<{ slug: string; contenido: string }>;
    try {
        documentosLeidos = dependencias.listarDocumentos();
    } catch (error) {
        return resumenDeErrorEntorno(log, mensajeDeError(error));
    }

    const documentosParseados: DocumentoODD[] = [];
    const erroresDeFormato: Array<{ slug: string; errores: string[] }> = [];

    for (const { slug, contenido } of documentosLeidos) {
        const resultado = parsearDocumento(slug, contenido);
        if (resultado.ok) documentosParseados.push(resultado.documento);
        else erroresDeFormato.push({ slug, errores: resultado.errores });
    }

    let credenciales =
        dependencias.credenciales !== undefined
            ? dependencias.credenciales
            : cargarCredenciales(dependencias.raizRepo);

    // El idioma se resuelve DESPUÉS de cargar el ".env" (lo hace
    // "cargarCredenciales"), para que BOARD_LANGUAGE pueda vivir ahí también.
    // Un valor inválido es un error de configuración, igual que un ID de base
    // mal formado: se informa antes de cualquier llamada a git/gh o Notion.
    const resultadoIdioma: ResultadoIdioma =
        dependencias.idioma !== undefined
            ? { ok: true, idioma: dependencias.idioma }
            : resolverIdiomaTablero(leerBoardLanguage());
    if (!resultadoIdioma.ok) {
        log(resultadoIdioma.error);
        const resumen: ResumenSincronizacion = {
            codigo: 1,
            creadas: 0,
            actualizadas: 0,
            cuerposReescritos: 0,
            huerfanas: [],
            erroresDeFormato,
            consultoNotion: false,
            razonNoCalculado: RAZON_IDIOMA_INVALIDO,
        };
        imprimirResumenFinal(log, resumen);
        return resumen;
    }
    const idioma = resultadoIdioma.idioma;

    // Una corrección posterior valida el ID de la base ANTES de cualquier
    // llamada de red — ni siquiera a git/gh — para no gastar tiempo si va a fallar igual. Se
    // aplica tanto si las credenciales vinieron inyectadas como si salieron
    // de "cargarCredenciales", y tanto en "--dry-run" como en corrida real.
    if (credenciales) {
        const resultadoId = normalizarIdBaseNotion(credenciales.databaseId);
        if (!resultadoId.ok) {
            log(resultadoId.error);
            const resumen: ResumenSincronizacion = {
                codigo: 1,
                creadas: 0,
                actualizadas: 0,
                cuerposReescritos: 0,
                huerfanas: [],
                erroresDeFormato,
                consultoNotion: false,
                razonNoCalculado: RAZON_ID_INVALIDO,
            };
            imprimirResumenFinal(log, resumen);
            return resumen;
        }
        credenciales = { ...credenciales, databaseId: resultadoId.id };
    }

    if (!credenciales && !opciones.dryRun) {
        log(
            'Faltan NOTION_TOKEN y/o NOTION_TABLERO_DB_ID. No se realizó ninguna llamada de red ni de Notion.',
        );
        const resumen: ResumenSincronizacion = {
            codigo: 1,
            creadas: 0,
            actualizadas: 0,
            cuerposReescritos: 0,
            huerfanas: [],
            erroresDeFormato,
            consultoNotion: false,
        };
        imprimirResumenFinal(log, resumen);
        return resumen;
    }

    // A partir de acá está autorizado tocar git/gh (dry-run con o sin
    // credenciales, o escritura real).
    //
    // Una revisión anterior detectó lo siguiente: antes de resolver anclas
    // de "commits", si algún documento las declara, hay que descartar dos problemas de ENTORNO que
    // NO son "el commit no existe" (error de formato de un documento
    // puntual): que el repo sea un clon superficial (las anclas requieren
    // fetch-depth: 0) o que git directamente no pueda correr (ENOENT). En
    // ambos casos la excepción de "obtenerEsRepoSuperficial" se deja
    // propagar a propósito (no tiene su propio try/catch) para distinguirlos
    // de "obtenerFechaCommit", que sí atrapa el fallo puntual de un hash.
    const algunDocumentoDeclaraCommits = documentosParseados.some((d) => d.commits.length > 0);
    if (algunDocumentoDeclaraCommits) {
        let esSuperficial: boolean;
        try {
            esSuperficial = obtenerEsRepoSuperficial(dependencias.ejecutar);
        } catch (error) {
            return resumenDeErrorEntorno(
                log,
                `No se pudo determinar si el repositorio es superficial (¿git no está disponible?): ${mensajeDeError(error)}`,
            );
        }
        if (esSuperficial) {
            return resumenDeErrorEntorno(
                log,
                'Repositorio superficial: las anclas de "commits" requieren un clon completo (fetch-depth: 0).',
            );
        }
    }

    // Ahora sí: un hash que no existe en un repo completo, con git
    // funcionando, es un error de formato del documento — se saltea como
    // cualquier otro, nunca en silencio.
    const documentosValidos: DocumentoODD[] = [];
    const fechasCommitsPorSlug = new Map<string, string[]>();
    for (const documento of documentosParseados) {
        const fechasCommits: string[] = [];
        let commitInexistente: string | null = null;
        for (const sha of documento.commits) {
            const fecha = obtenerFechaCommit(dependencias.ejecutar, sha);
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

    const todasLasRamas = obtenerRamasConFecha(dependencias.ejecutar);
    const todosLosPRs = obtenerPRs(dependencias.ejecutar);
    const ownerRepo = obtenerOwnerRepo(dependencias.ejecutar);

    const filas = documentosValidos.map((documento) =>
        construirFila({
            documento,
            todasLasRamas,
            todosLosPRs,
            fechasCommits: fechasCommitsPorSlug.get(documento.slug) ?? [],
            fechaDocumento: obtenerFechaDocumento(dependencias.ejecutar, documento.slug),
            hoy,
            ownerRepo,
            idioma,
        }),
    );

    if (!credenciales) {
        log('--dry-run sin credenciales: NO se consultó Notion. Filas calculadas desde el repositorio:');
        log('slug | estado | progreso | PRs abiertos | días | actualizado');
        for (const fila of filas) log(formatearFilaLegible(fila));
        const resumen: ResumenSincronizacion = {
            codigo: erroresDeFormato.length > 0 ? 1 : 0,
            creadas: 0,
            actualizadas: 0,
            cuerposReescritos: 0,
            huerfanas: [],
            erroresDeFormato,
            consultoNotion: false,
        };
        imprimirResumenFinal(log, resumen);
        return resumen;
    }

    const dormir = dependencias.dormir ?? dormirPorDefecto;
    const cliente = crearClienteNotion(dependencias.fetchInyectado, credenciales.token, dormir);

    const dataSourceId = await cliente.obtenerDataSourceId(credenciales.databaseId);
    const esquemaActual = await cliente.obtenerEsquema(dataSourceId);
    const problemasEsquema = validarEsquema(esquemaActual, idioma);

    if (problemasEsquema.length > 0) {
        for (const problema of problemasEsquema) {
            log(
                problema.motivo === 'faltante'
                    ? `Falta la propiedad "${problema.nombre}" (tipo ${problema.tipoEsperado}) en la base de Notion.`
                    : `La propiedad "${problema.nombre}" es de tipo "${problema.tipoActual}", debería ser "${problema.tipoEsperado}".`,
            );
        }
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
            codigo: 1,
            creadas: 0,
            actualizadas: 0,
            cuerposReescritos: 0,
            huerfanas: [],
            erroresDeFormato,
            consultoNotion: true,
            razonNoCalculado: RAZON_ESQUEMA_INVALIDO,
        };
        imprimirResumenFinal(log, resumen);
        return resumen;
    }

    const paginasNotion = await cliente.listarTodasLasPaginas(dataSourceId);
    const paginasExistentesCrudas = paginasNotion.map((pagina) => extraerPaginaExistente(pagina, idioma));
    // Una revisión anterior detectó esto: los slugs duplicados en Notion se
    // informan (nunca se borran, nunca se sobrescriben en silencio como hacía el Map anterior).
    const { unicas: paginasExistentes, duplicadas } = resolverDuplicadosPorSlug(paginasExistentesCrudas);
    const plan = planificarSync(filas, paginasExistentes);
    const hayProblemasNoFormato = duplicadas.length > 0;

    if (opciones.dryRun) {
        log('--dry-run con credenciales: se consultó Notion en modo lectura; no se escribió nada.');
        const cuerposNuevos = plan.actualizar.filter((a) => a.reescribirCuerpo).length;
        const resumen: ResumenSincronizacion = {
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
        };
        imprimirResumenFinal(log, resumen);
        return resumen;
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
        const { huella, ...valoresSinHuella } = construirValoresPropiedades(fila, idioma);
        const pageId = await cliente.crearPagina(
            dataSourceId,
            traducirPropiedades(valoresSinHuella, idioma),
            documento.tareas,
        );
        await cliente.actualizarPropiedades(pageId, traducirPropiedades({ huella }, idioma));
    }

    let cuerposReescritos = 0;
    for (const item of plan.actualizar) {
        const valores = construirValoresPropiedades(item.fila, idioma);
        if (!item.reescribirCuerpo) {
            // Sin reescritura de cuerpo no hay ventana de inconsistencia:
            // todas las propiedades (Huella incluida, que no cambió) se
            // mandan juntas, como antes.
            await cliente.actualizarPropiedades(item.pageId, traducirPropiedades(valores, idioma));
            continue;
        }
        const documento = documentosValidos.find((d) => d.slug === item.fila.slug);
        if (!documento) continue;
        const { huella, ...valoresSinHuella } = valores;
        await cliente.actualizarPropiedades(item.pageId, traducirPropiedades(valoresSinHuella, idioma));
        await cliente.reescribirCuerpo(item.pageId, documento.tareas);
        await cliente.actualizarPropiedades(item.pageId, traducirPropiedades({ huella }, idioma));
        cuerposReescritos++;
    }

    const resumen: ResumenSincronizacion = {
        codigo: erroresDeFormato.length > 0 || hayProblemasNoFormato ? 1 : 0,
        creadas: plan.crear.length,
        actualizadas: plan.actualizar.length,
        cuerposReescritos,
        huerfanas: plan.huerfanas.map((h) => h.slug),
        erroresDeFormato,
        consultoNotion: true,
        duplicadas,
    };
    imprimirResumenFinal(log, resumen);
    return resumen;
}
