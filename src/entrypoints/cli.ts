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
 */
import { execFileSync } from 'node:child_process';

import { sincronizar } from '../app/sincronizar';
import { listarDocumentosODD } from '../adapters/fs-node';
import type { FetchInyectado } from '../ports/notion';
import type { EjecutarComando } from '../ports/sincronizar';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const AYUDA = `
Sync del estado de las features (odd/tasks/*.md) hacia un tablero de Notion.

Uso:
  npx tsx src/sync-tablero-features.ts [--dry-run] [--ayuda]

  --dry-run   No escribe en Notion. Sin credenciales, imprime las filas
              calculadas desde el repositorio. Con credenciales, consulta
              Notion en modo lectura e imprime el plan (altas/actualizaciones/
              huérfanas) sin escribir nada.
  --ayuda     Muestra esta ayuda.

Variables de entorno requeridas (salvo con --dry-run):
  NOTION_TOKEN
  NOTION_TABLERO_DB_ID

Variables de entorno opcionales:
  BOARD_LANGUAGE   Idioma del tablero de Notion: "es" (por defecto) o "en".
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
        {
            raizRepo,
            ejecutar,
            fetchInyectado,
            listarDocumentos: () => listarDocumentosODD(raizRepo),
            log: (linea) => console.log(linea),
        },
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
 * Se ejecuta solo cuando el script se invoca directamente (tsx/node), nunca
 * cuando lo importa un test. Se compara contra `process.argv[1]` en vez de
 * `import.meta.url` porque Jest transpila este archivo a CommonJS.
 */
const invocadoDirectamente = /entrypoints\/cli\.(ts|js|mjs|cjs)$/.test(
    (process.argv[1] ?? '').replace(/\\/g, '/'),
);
if (invocadoDirectamente) {
    principal(process.argv.slice(2));
}
