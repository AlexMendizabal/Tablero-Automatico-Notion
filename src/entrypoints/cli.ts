#!/usr/bin/env node
/**
 * Sync del estado de cada feature hacia un tablero de Notion, a partir de los
 * documentos ODD en `odd/tasks/*.md` (ver el README de este repositorio para
 * el contrato completo del documento y el esquema de la base de Notion).
 *
 * Arquitectura: núcleo puro exportado + capa de E/S fina, autoejecución solo
 * cuando `process.argv[1]` termina en el nombre de este script (no
 * `import.meta`: Jest transpila a CommonJS).
 *
 * Uso:
 *   npx tsx src/entrypoints/cli.ts [--dry-run]
 *   tablero-notion [--dry-run]   (instalado desde npm; compilado en dist/)
 */
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

import { sincronizar } from '../app/sincronizar';
import type { AjustesProyecto } from '../core/ajustes';
import type { Idioma } from '../core/i18n';
import { AJUSTES_PROYECTO, cargarCredenciales, leerBoardLanguage } from '../adapters/config';
import { listarDocumentosODD } from '../adapters/fs-node';
import { obtenerAutoresDePR, obtenerOwnerRepo, obtenerPRs } from '../adapters/gh-cli';
import {
    obtenerAutoresDeCommit,
    obtenerAutoresDeRango,
    obtenerEsRepoSuperficial,
    obtenerFechaCommit,
    obtenerFechaDocumento,
    obtenerRamasConFecha,
    obtenerRefRamaBase,
} from '../adapters/git-cli';
import { crearClienteNotion, dormirPorDefecto } from '../adapters/notion-http';
import type { Credenciales, Dormir, FetchInyectado } from '../ports/notion';
import type { DependenciasSincronizar, EjecutarComando } from '../ports/sincronizar';

// ---------------------------------------------------------------------------
// Raíz de composición
// ---------------------------------------------------------------------------

/** Lo mínimo para componer las dependencias reales: el comando (git/gh) y el
 *  `fetch` inyectables, más los mismos ajustes opcionales que acepta
 *  `DependenciasSincronizar` (los tests inyectan falsos acá). */
export interface EntradaComposicion {
    raizRepo: string;
    ejecutar: EjecutarComando;
    fetchInyectado: FetchInyectado;
    listarDocumentos: DependenciasSincronizar['listarDocumentos'];
    /** Por defecto, `dormirPorDefecto` (espera real entre reintentos). */
    dormir?: Dormir;
    hoy?: Date;
    credenciales?: Credenciales | null;
    log?: (linea: string) => void;
    idioma?: Idioma;
    /** Por defecto, `AJUSTES_PROYECTO` (leídos del entorno al cargar
     *  `adapters/config.ts`). */
    ajustes?: AjustesProyecto;
}

/** Conecta los adaptadores reales (git/gh vía `ejecutar`, Notion vía
 *  `fetchInyectado`, configuración vía `.env`/entorno) con los puertos de la
 *  orquestación. Único lugar donde la app y los adaptadores se encuentran. */
export function componerDependencias(entrada: EntradaComposicion): DependenciasSincronizar {
    const { ejecutar, fetchInyectado } = entrada;
    const dormir = entrada.dormir ?? dormirPorDefecto;
    return {
        raizRepo: entrada.raizRepo,
        listarDocumentos: entrada.listarDocumentos,
        repositorio: {
            esRepoSuperficial: () => obtenerEsRepoSuperficial(ejecutar),
            fechaCommit: (sha) => obtenerFechaCommit(ejecutar, sha),
            fechaDocumento: (rutaRelativa) => obtenerFechaDocumento(ejecutar, rutaRelativa),
            ramasConFecha: () => obtenerRamasConFecha(ejecutar),
            prs: () => obtenerPRs(ejecutar),
            ownerRepo: () => obtenerOwnerRepo(ejecutar),
            refRamaBase: (ramaBase) => obtenerRefRamaBase(ejecutar, ramaBase),
            autoresDeRango: (base, rama) => obtenerAutoresDeRango(ejecutar, base, rama),
            autoresDeCommit: (sha) => obtenerAutoresDeCommit(ejecutar, sha),
            autoresDePR: (numero) => obtenerAutoresDePR(ejecutar, numero),
        },
        configuracion: { cargarCredenciales, leerBoardLanguage },
        crearClienteNotion: (token) => crearClienteNotion(fetchInyectado, token, dormir),
        ajustes: entrada.ajustes ?? AJUSTES_PROYECTO,
        hoy: entrada.hoy,
        credenciales: entrada.credenciales,
        log: entrada.log,
        idioma: entrada.idioma,
    };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export const AYUDA = `
Sync del estado de las features (odd/tasks/*.md) y, si las hay, de las
tareas (odd/tareas/*.md) hacia Notion.

Uso:
  npm run sync -- [--dry-run] [--ayuda]
  npx tsx src/entrypoints/cli.ts [--dry-run] [--ayuda]
  tablero-notion [--dry-run] [--ayuda]   (instalado desde npm)

  --dry-run   No escribe en Notion. Sin credenciales, imprime las filas
              calculadas desde el repositorio. Con credenciales, consulta
              Notion en modo lectura e imprime el plan (altas/actualizaciones/
              huérfanas) sin escribir nada.
  --ayuda     Muestra esta ayuda.

Variables de entorno requeridas (salvo con --dry-run):
  NOTION_TOKEN
  NOTION_TABLERO_DB_ID

Variables de entorno opcionales:
  BOARD_LANGUAGE           Idioma del tablero de Notion: "es" (por defecto) o "en".
  NOTION_TAREAS_DB_ID      Base de Notion de las Tareas. Sin ella, las Tareas no
                           se escriben en Notion.
  TABLERO_CARPETA          Carpeta de las Features (por defecto, odd/tasks).
  TABLERO_CARPETA_TAREAS   Carpeta de las Tareas (por defecto, odd/tareas).
`;

function principal(argumentos: string[]): void {
    if (argumentos.includes('--ayuda') || argumentos.includes('-h')) {
        console.log(AYUDA);
        process.exit(0);
    }

    const dryRun = argumentos.includes('--dry-run');
    const desconocidos = argumentos.filter((a) => !['--dry-run', '--ayuda', '-h'].includes(a));
    if (desconocidos.length > 0) {
        console.error(`Opción desconocida: ${desconocidos.join(', ')}`);
        console.error('Usá --ayuda para ver las opciones disponibles.');
        process.exit(1);
    }

    const raizRepo = process.cwd();
    const ejecutar: EjecutarComando = (comando, args) =>
        execFileSync(comando, args, { encoding: 'utf8', cwd: raizRepo, maxBuffer: 1024 * 1024 * 32 });
    const fetchInyectado: FetchInyectado = (url, init) => fetch(url, init as RequestInit);

    sincronizar(
        { dryRun },
        componerDependencias({
            raizRepo,
            ejecutar,
            fetchInyectado,
            listarDocumentos: (carpeta, opciones) => listarDocumentosODD(raizRepo, carpeta, opciones),
            log: (linea) => console.log(linea),
        }),
    )
        .then((resumen) => {
            // El resumen final (contadores o el aviso de "no calculado", más
            // los errores de formato) ya se imprimió dentro de "sincronizar"
            // vía el "log" inyectado — acá solo queda salir con su código.
            process.exit(resumen.codigo);
        })
        .catch((error: unknown) => {
            console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
            process.exit(1);
        });
}

/**
 * `true` si `rutaScript` (normalmente `process.argv[1]`) es este punto de
 * entrada: `src/entrypoints/cli.ts` vía tsx, o el `.js`/`.mjs`/`.cjs`
 * compilado, con separadores `/` o `\` (Windows). Instalado como paquete,
 * `process.argv[1]` puede ser el enlace del bin (`node_modules/.bin/
 * tablero-notion`, también vía npx), que no termina en ese nombre: con
 * `contexto`, además se lo reconoce si resuelve (realpath) al mismo archivo
 * que `archivoActual`. Cualquier otra ruta (el worker de Jest, otro módulo,
 * una ruta irresoluble) da `false`.
 */
export function esInvocacionDirecta(
    rutaScript: string | undefined,
    contexto?: { archivoActual: string; resolverRuta?: (ruta: string) => string },
): boolean {
    if (/(^|\/)entrypoints\/cli\.(ts|js|mjs|cjs)$/.test((rutaScript ?? '').replace(/\\/g, '/'))) return true;
    if (!rutaScript || !contexto) return false;
    const resolverRuta = contexto.resolverRuta ?? ((ruta: string) => realpathSync(ruta));
    try {
        return resolverRuta(rutaScript) === resolverRuta(contexto.archivoActual);
    } catch {
        return false;
    }
}

/**
 * Se ejecuta solo cuando el script se invoca directamente (tsx/node), nunca
 * cuando lo importa un test. Se compara contra `process.argv[1]` en vez de
 * `import.meta.url` porque Jest transpila este archivo a CommonJS.
 */
if (esInvocacionDirecta(process.argv[1], { archivoActual: __filename })) {
    principal(process.argv.slice(2));
}
