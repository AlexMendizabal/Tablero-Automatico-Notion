/**
 * Parser del documento ODD (frontmatter, título y sección de tareas).
 */
import type { ResultadoParseoDocumento, TareaDocumento } from './types';

// ---------------------------------------------------------------------------
// parsearDocumento
// ---------------------------------------------------------------------------

const REGEX_FRONTMATTER_DELIM = /^---\s*$/;
/** Clave + valor de una línea de frontmatter genérica ("ramas: [...]",
 *  "commits: [...]"), generalizado desde el "ramas:" original para admitir
 *  ambas claves en cualquier orden. */
const REGEX_CLAVE_FRONTMATTER = /^([A-Za-z_]+):\s*(.*)$/;
/** Clave de frontmatter tal como se escribe (español o inglés, se aceptan
 *  siempre las dos, sin importar `BOARD_LANGUAGE`) → clave canónica. Usar
 *  las dos grafías del mismo concepto en un documento es clave duplicada. */
const CLAVES_FRONTMATTER_VALIDAS = new Map<string, 'ramas' | 'commits'>([
    ['ramas', 'ramas'],
    ['branches', 'ramas'],
    ['commits', 'commits'],
]);
/** Hash de commit: hexadecimal en minúscula, EXACTAMENTE 40 caracteres (hash
 *  completo). El contrato lo exige completo a propósito: uno abreviado puede
 *  volverse ambiguo cuando el repo crece. */
const REGEX_COMMIT_HASH = /^[0-9a-f]{40}$/;
const REGEX_TITULO = /^#\s+(.+?)\s*$/;
/** "## Tareas" o "## Tasks" (los dos idiomas, siempre). */
const REGEX_SECCION_TAREAS = /^##\s+(Tareas|Tasks)\s*$/;
const NOMBRE_SECCION_TAREAS = "'## Tareas' (o '## Tasks')";
const REGEX_SECCION_NIVEL2 = /^##\s+/;
const REGEX_INICIO_TAREA = /^- \[([ xX])\]/;
// La descripción tras "**" es OPCIONAL: la regla normativa del contrato
// ("Formato del documento ODD") solo exige "un ID en negrita al principio";
// el ": descripción" es apenas el estilo del ejemplo. Documentos reales del
// repo (ej. odd/tasks/qa-venta-fraccionada.md) mezclan ambos estilos en el
// mismo archivo — algunas tareas con "**ID — Nombre**: descripción." y otras
// con "**ID — Nombre**." a secas. El grupo 3 captura todo lo que sigue al
// "**" de cierre, con o sin los dos puntos.
const REGEX_TAREA_COMPLETA = /^- \[([ xX])\]\s+\*\*(.+?)\*\*(.*)$/;
const REGEX_ID_TAREA = /^[A-Z]+\d+$/;
const SEPARADOR_RAYA = ' — '; // U+2014
const SEPARADOR_GUION = ' - ';
const REGEX_FENCE = /^\s*(`{3,}|~{3,})/;

/** Normaliza BOM y finales de línea (CRLF/CR/LF) antes de partir en líneas. */
function normalizarLineas(bruto: string): string[] {
    const sinBom = bruto.charCodeAt(0) === 0xfeff ? bruto.slice(1) : bruto;
    return sinBom.split(/\r\n|\r|\n/);
}

/**
 * Marca cada línea como "dentro de un bloque de código cercado" o no. Una
 * corrida de 3+ backticks o tildes abre el bloque; lo cierra la siguiente
 * línea que empiece con el MISMO carácter repetido AL MENOS la misma
 * cantidad de veces (por eso un bloque de 4 backticks no se cierra con una
 * línea de 3). Tanto la línea de apertura como la de cierre cuentan como
 * "dentro": ninguna de las dos puede matchear un título o un checkbox de
 * todos modos.
 */
function calcularLineasDentroDeBloqueCodigo(lineas: string[]): boolean[] {
    const dentro: boolean[] = new Array(lineas.length).fill(false);
    let abierto: { caracter: string; cantidad: number } | null = null;
    for (let i = 0; i < lineas.length; i++) {
        const linea = lineas[i];
        if (abierto === null) {
            const coincidencia = REGEX_FENCE.exec(linea);
            if (coincidencia) {
                abierto = { caracter: coincidencia[1][0], cantidad: coincidencia[1].length };
                dentro[i] = true;
            }
            continue;
        }
        dentro[i] = true;
        const coincidencia = REGEX_FENCE.exec(linea);
        if (coincidencia && coincidencia[1][0] === abierto.caracter && coincidencia[1].length >= abierto.cantidad) {
            abierto = null;
        }
    }
    return dentro;
}

export function parsearDocumento(slug: string, contenidoBruto: string): ResultadoParseoDocumento {
    const errores: string[] = [];
    const lineas = normalizarLineas(contenidoBruto);
    const dentroDeBloque = calcularLineasDentroDeBloqueCodigo(lineas);

    // --- Frontmatter: admite "ramas" o "branches" (obligatoria, una sola de
    // las dos) y "commits" (opcional), una por línea, en cualquier orden.
    // Cualquier otra clave, clave duplicada (incluidas las dos grafías de
    // "ramas") o "ramas" ausente es error de formato. ---
    let ramas: string[] | null = null;
    let commits: string[] = [];
    let indiceFinDeFrontmatter = -1;
    if (!REGEX_FRONTMATTER_DELIM.test(lineas[0] ?? '')) {
        errores.push("Frontmatter faltante o inválido: la línea 1 debe ser exactamente '---'.");
    } else {
        let indiceCierre = -1;
        for (let i = 1; i < lineas.length; i++) {
            if (REGEX_FRONTMATTER_DELIM.test(lineas[i])) {
                indiceCierre = i;
                break;
            }
        }
        if (indiceCierre === -1) {
            errores.push("Frontmatter faltante o inválido: falta la línea de cierre '---'.");
        } else {
            indiceFinDeFrontmatter = indiceCierre;
            const cuerpo = lineas.slice(1, indiceCierre).filter((l) => l.trim() !== '');
            // Por clave canónica: la grafía usada (para los mensajes) y su valor.
            const valoresPorClave = new Map<string, { clave: string; valor: string }>();

            for (const linea of cuerpo) {
                const coincidencia = REGEX_CLAVE_FRONTMATTER.exec(linea);
                if (!coincidencia) {
                    errores.push(
                        `Frontmatter faltante o inválido: línea sin formato "clave: valor": "${linea}".`,
                    );
                    continue;
                }
                const [, clave, valor] = coincidencia;
                const canonica = CLAVES_FRONTMATTER_VALIDAS.get(clave);
                if (canonica === undefined) {
                    errores.push(
                        `Frontmatter faltante o inválido: clave desconocida "${clave}" (solo se admiten 'ramas' (o 'branches') y 'commits').`,
                    );
                    continue;
                }
                const previa = valoresPorClave.get(canonica);
                if (previa) {
                    errores.push(
                        previa.clave === clave
                            ? `Frontmatter faltante o inválido: la clave "${clave}" está duplicada.`
                            : `Frontmatter faltante o inválido: la clave "${clave}" está duplicada ("${previa.clave}" y "${clave}" son la misma clave; usá una sola).`,
                    );
                    continue;
                }
                valoresPorClave.set(canonica, { clave, valor });
            }

            const entradaRamas = valoresPorClave.get('ramas');
            if (entradaRamas === undefined) {
                errores.push(
                    "Frontmatter faltante o inválido: falta la clave 'ramas' (o 'branches'): array JSON de strings.",
                );
            } else {
                try {
                    const valor = JSON.parse(entradaRamas.valor);
                    if (!Array.isArray(valor) || !valor.every((v) => typeof v === 'string')) {
                        errores.push(
                            `Frontmatter faltante o inválido: '${entradaRamas.clave}' debe ser un array de strings.`,
                        );
                    } else {
                        ramas = valor;
                    }
                } catch {
                    errores.push(
                        `Frontmatter faltante o inválido: '${entradaRamas.clave}' debe ser JSON válido con comillas dobles.`,
                    );
                }
            }

            const valorCommits = valoresPorClave.get('commits')?.valor;
            if (valorCommits !== undefined) {
                try {
                    const valor = JSON.parse(valorCommits);
                    if (
                        !Array.isArray(valor) ||
                        !valor.every((v) => typeof v === 'string' && REGEX_COMMIT_HASH.test(v))
                    ) {
                        errores.push(
                            "Frontmatter faltante o inválido: 'commits' debe ser un array de hashes hexadecimales COMPLETOS en minúscula (exactamente 40 caracteres); un hash abreviado no alcanza.",
                        );
                    } else {
                        commits = valor;
                    }
                } catch {
                    errores.push(
                        "Frontmatter faltante o inválido: 'commits' debe ser JSON válido con comillas dobles.",
                    );
                }
            }
        }
    }

    // --- Título: primer "# " fuera de bloques de código ---
    let titulo: string | null = null;
    const inicioBusquedaTitulo = indiceFinDeFrontmatter === -1 ? 0 : indiceFinDeFrontmatter + 1;
    for (let i = inicioBusquedaTitulo; i < lineas.length; i++) {
        if (dentroDeBloque[i]) continue;
        const coincidencia = REGEX_TITULO.exec(lineas[i]);
        if (coincidencia) {
            titulo = coincidencia[1].trim();
            break;
        }
    }
    if (titulo === null) {
        errores.push("Falta el título: no se encontró un '# ' fuera de bloques de código.");
    }

    // --- Sección única "## Tareas" (o "## Tasks"; tener las dos es tener
    // más de una sección de tareas) ---
    const indicesSeccionTareas: number[] = [];
    for (let i = 0; i < lineas.length; i++) {
        if (dentroDeBloque[i]) continue;
        if (REGEX_SECCION_TAREAS.test(lineas[i])) indicesSeccionTareas.push(i);
    }

    const tareas: TareaDocumento[] = [];
    if (indicesSeccionTareas.length === 0) {
        errores.push(`Falta la sección ${NOMBRE_SECCION_TAREAS}.`);
    } else if (indicesSeccionTareas.length > 1) {
        errores.push(
            `Debe haber exactamente una sección ${NOMBRE_SECCION_TAREAS} (se encontraron ${indicesSeccionTareas.length}, contando solo fuera de bloques de código).`,
        );
    } else {
        // El encabezado tal como lo escribió el documento, para los mensajes.
        const seccion = `## ${REGEX_SECCION_TAREAS.exec(lineas[indicesSeccionTareas[0]])?.[1] ?? 'Tareas'}`;
        const inicio = indicesSeccionTareas[0] + 1;
        let fin = lineas.length;
        for (let i = inicio; i < lineas.length; i++) {
            if (dentroDeBloque[i]) continue;
            if (REGEX_SECCION_NIVEL2.test(lineas[i])) {
                fin = i;
                break;
            }
        }

        let candidatos = 0;
        for (let i = inicio; i < fin; i++) {
            if (dentroDeBloque[i]) continue;
            const linea = lineas[i];
            if (!REGEX_INICIO_TAREA.test(linea)) continue;
            candidatos++;

            const completa = REGEX_TAREA_COMPLETA.exec(linea);
            if (!completa) {
                errores.push(`Checkbox bajo '${seccion}' sin ID válido (formato inválido): "${linea}".`);
                continue;
            }
            const [, checkbox, negrita, restoBruto] = completa;
            const hecha = checkbox === 'x' || checkbox === 'X';

            // El resto tras el "**" de cierre puede venir como ": descripción"
            // (se le saca el ":" inicial) o vacío/solo puntuación de cierre
            // (ej. "." a secas), que no cuenta como descripción real.
            let descripcion = restoBruto.trim();
            if (descripcion.startsWith(':')) descripcion = descripcion.slice(1).trim();
            if (/^[.\s]*$/.test(descripcion)) descripcion = '';

            if (negrita.includes(SEPARADOR_RAYA)) {
                const posicion = negrita.indexOf(SEPARADOR_RAYA);
                const idCrudo = negrita.slice(0, posicion).trim();
                const nombre = negrita.slice(posicion + SEPARADOR_RAYA.length).trim();
                if (!REGEX_ID_TAREA.test(idCrudo)) {
                    errores.push(`Checkbox bajo '${seccion}' sin ID válido: "${linea}".`);
                    continue;
                }
                tareas.push({
                    id: idCrudo,
                    nombre,
                    descripcion,
                    hecha,
                    esQA: idCrudo.startsWith('QA'),
                });
            } else if (negrita.includes(SEPARADOR_GUION)) {
                errores.push(
                    `Checkbox bajo '${seccion}' usa guion común en vez de — (raya): "${linea}".`,
                );
            } else {
                errores.push(`Checkbox bajo '${seccion}' sin ID válido: "${linea}".`);
            }
        }

        if (candidatos === 0) {
            errores.push(`La sección '${seccion}' no tiene ninguna tarea.`);
        }
    }

    if (errores.length > 0) {
        return { ok: false, errores };
    }

    return {
        ok: true,
        documento: { slug, ramas: ramas ?? [], commits, titulo: titulo ?? '', tareas },
    };
}
