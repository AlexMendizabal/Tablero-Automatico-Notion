/**
 * Entidad Feature: un documento ODD por feature (`odd/tasks/*.md`), una fila
 * por feature en la base de Notion del tablero.
 *
 * Acá viven el esquema de su base (`TIPOS_PROPIEDAD`), sus textos por idioma
 * (`TEXTOS_POR_IDIOMA`), su regla de estado, el armado de su fila y de los
 * valores de sus propiedades, y el descriptor que los reúne
 * (`crearDescriptorFeature`) para la orquestación genérica.
 */
import { AJUSTES_POR_DEFECTO, type AjustesProyecto } from '../ajustes';
import type { Idioma } from '../i18n';
import { parsearDocumento } from '../parse';
import { calcularHuella } from '../plan';
import { recortarParaNotion } from '../row';
import {
    esquemaEsperadoEntidad,
    textoRico,
    traducirPropiedadesEntidad,
    validarEsquemaEntidad,
} from '../schema';
import { calcularActualizado, coincideRama, derivarEstado, diasSinActividad } from '../status';
import type {
    DocumentoODD,
    Estado,
    FilaTablero,
    ParametrosConstruirFila,
    PropiedadesNotion,
    PropiedadesNotionBrutas,
    PropiedadInvalida,
    ValoresPropiedades,
} from '../types';
import type { DescriptorEntidad, EsquemaEntidad, TextosEntidad } from './tipos';

// ---------------------------------------------------------------------------
// Esquema y textos
// ---------------------------------------------------------------------------

/**
 * Tipo de Notion de cada propiedad del tablero, por clave interna (neutral,
 * la misma que el campo correspondiente de `FilaTablero`). El orden de esta
 * constante es el orden en que se validan y se escriben las propiedades.
 */
export const TIPOS_PROPIEDAD = {
    feature: 'title',
    slug: 'rich_text',
    estado: 'select',
    progreso: 'rich_text',
    pendiente: 'rich_text',
    prsAbiertos: 'rich_text',
    ramas: 'rich_text',
    diasSinActividad: 'number',
    actualizado: 'date',
    documento: 'url',
    huella: 'rich_text',
} as const;

export type ClavePropiedad = keyof typeof TIPOS_PROPIEDAD;

/**
 * Lo que el tablero de Notion muestra en cada idioma. Las propiedades
 * (nombre + `TIPOS_PROPIEDAD`) son las que este script espera encontrar,
 * exactas, en la base de Notion (`validarEsquema` las compara contra el
 * esquema real antes de escribir nada). Renombrar o retipar una columna en
 * Notion exige cambiar los dos lados del contrato: este diccionario Y la base
 * de Notion — ninguno de los dos se puede descubrir automáticamente del
 * otro. El `satisfies` obliga a que cada idioma defina todas las claves.
 */
export const TEXTOS_POR_IDIOMA = {
    es: {
        propiedades: {
            feature: 'Feature',
            slug: 'Slug',
            estado: 'Estado',
            progreso: 'Progreso',
            pendiente: 'Pendiente',
            prsAbiertos: 'PRs abiertos',
            ramas: 'Ramas',
            diasSinActividad: 'Días sin actividad',
            actualizado: 'Actualizado',
            documento: 'Documento',
            huella: 'Huella',
        },
        estados: {
            Terminada: 'Terminada',
            'QA pendiente': 'QA pendiente',
            'Sin empezar': 'Sin empezar',
            'En curso': 'En curso',
        },
        progreso: (hechas: number, total: number) => `${hechas}/${total} tareas`,
    },
    en: {
        propiedades: {
            feature: 'Feature',
            slug: 'Slug',
            estado: 'Status',
            progreso: 'Progress',
            pendiente: 'Pending',
            prsAbiertos: 'Open PRs',
            ramas: 'Branches',
            diasSinActividad: 'Days inactive',
            actualizado: 'Updated',
            documento: 'Document',
            huella: 'Fingerprint',
        },
        estados: {
            Terminada: 'Done',
            'QA pendiente': 'QA pending',
            'Sin empezar': 'Not started',
            'En curso': 'In progress',
        },
        progreso: (hechas: number, total: number) => `${hechas}/${total} tasks`,
    },
} as const satisfies Record<Idioma, TextosEntidad<ClavePropiedad, Estado>>;

/** Parte estática del descriptor de Feature (no depende de ajustes). */
export const ESQUEMA_FEATURE: EsquemaEntidad<ClavePropiedad, Estado> = {
    tiposPropiedad: TIPOS_PROPIEDAD,
    claveTitulo: 'feature',
    claveSlug: 'slug',
    claveHuella: 'huella',
    // Features no tiene propiedades de Notion: todo sale del repositorio.
    propiedadesDeNotion: [],
    textos: TEXTOS_POR_IDIOMA,
};

/** Propiedades (nombre visible + tipo) que la base de Notion debe tener en el
 *  idioma dado, en el orden de `TIPOS_PROPIEDAD`. */
export function esquemaEsperado(idioma: Idioma = 'es'): Array<{ nombre: string; tipo: string }> {
    return esquemaEsperadoEntidad(ESQUEMA_FEATURE, idioma);
}

export function validarEsquema(
    propiedadesDeLaBase: Record<string, { type: string }>,
    idioma: Idioma = 'es',
): PropiedadInvalida[] {
    return validarEsquemaEntidad(ESQUEMA_FEATURE, propiedadesDeLaBase, idioma);
}

// ---------------------------------------------------------------------------
// Valores de las propiedades
// ---------------------------------------------------------------------------

/** Valores de las propiedades de una fila, por clave interna. El estado ya
 *  sale con su nombre visible en el idioma dado. */
export function construirValoresPropiedades(fila: FilaTablero, idioma: Idioma = 'es'): ValoresPropiedades {
    return {
        feature: { title: textoRico(fila.feature) },
        slug: { rich_text: textoRico(fila.slug) },
        estado: { select: { name: TEXTOS_POR_IDIOMA[idioma].estados[fila.estado] } },
        progreso: { rich_text: textoRico(fila.progreso) },
        pendiente: { rich_text: textoRico(fila.pendiente) },
        prsAbiertos: { rich_text: textoRico(fila.prsAbiertos) },
        ramas: { rich_text: textoRico(fila.ramas) },
        diasSinActividad: { number: fila.diasSinActividad },
        actualizado: { date: { start: fila.actualizado } },
        documento: { url: fila.documento },
        huella: { rich_text: textoRico(fila.huella) },
    };
}

/** Frontera con Notion para Features (ver `traducirPropiedadesEntidad`). */
export function traducirPropiedades(valores: Partial<ValoresPropiedades>, idioma: Idioma): PropiedadesNotionBrutas {
    return traducirPropiedadesEntidad(ESQUEMA_FEATURE, valores, idioma);
}

export function construirPropiedadesNotion<I extends Idioma = 'es'>(fila: FilaTablero, idioma?: I): PropiedadesNotion<I> {
    const efectivo: Idioma = idioma ?? 'es';
    return traducirPropiedades(construirValoresPropiedades(fila, efectivo), efectivo) as PropiedadesNotion<I>;
}

// ---------------------------------------------------------------------------
// Fila
// ---------------------------------------------------------------------------

/** `ajustes` por defecto: los valores por defecto del proyecto (sin leer el
 *  entorno). La orquestación siempre pasa los del descriptor, que resolvió
 *  quien lo compuso (ver `adapters/config.ts`). */
export function construirFila(
    parametros: ParametrosConstruirFila,
    ajustes: AjustesProyecto = AJUSTES_POR_DEFECTO,
): FilaTablero {
    return construirFilaEnCarpeta(parametros, ajustes.carpetaFeatures, ajustes.ramaBaseDocumento);
}

/** Armado de la fila de un documento ODD de `carpeta` (relativa a la raíz
 *  del repositorio), con el enlace "Documento" sobre `ramaBaseDocumento`.
 *  Lo comparten Features y Tareas (ver `entities/tarea.ts`): mismas columnas,
 *  misma regla de estado. */
export function construirFilaEnCarpeta(
    parametros: ParametrosConstruirFila,
    carpeta: string,
    ramaBaseDocumento: string,
): FilaTablero {
    const { documento, todasLasRamas, todosLosPRs, fechasCommits, fechaDocumento, hoy, ownerRepo } = parametros;
    const idioma = parametros.idioma ?? 'es';

    const ramasQueMatchean = todasLasRamas.filter((r) =>
        documento.ramas.some((patron) => coincideRama(patron, r.nombre)),
    );
    const prsQueMatchean = todosLosPRs.filter((pr) =>
        documento.ramas.some((patron) => coincideRama(patron, pr.headRefName)),
    );
    const prsAbiertos = prsQueMatchean.filter((pr) => pr.state === 'OPEN');

    const actualizado = calcularActualizado({
        ramasVivas: ramasQueMatchean,
        prs: prsQueMatchean,
        fechasCommits,
        fechaDocumento,
        hoy,
    });

    const total = documento.tareas.length;
    const hechas = documento.tareas.filter((t) => t.hecha).length;
    const primeraPendiente = documento.tareas.find((t) => !t.hecha);
    const estado = derivarEstado(documento.tareas, prsAbiertos.length);

    return {
        feature: recortarParaNotion(documento.titulo),
        slug: documento.slug,
        estado,
        progreso: TEXTOS_POR_IDIOMA[idioma].progreso(hechas, total),
        pendiente: primeraPendiente
            ? recortarParaNotion(`${primeraPendiente.id} — ${primeraPendiente.nombre}`)
            : '',
        prsAbiertos: recortarParaNotion(
            prsAbiertos
                .map((pr) => pr.number)
                .sort((a, b) => a - b)
                .map((n) => `#${n}`)
                .join(', '),
        ),
        ramas: recortarParaNotion([...ramasQueMatchean.map((r) => r.nombre)].sort().join(', ')),
        diasSinActividad: diasSinActividad(actualizado, hoy),
        actualizado,
        documento: `https://github.com/${ownerRepo}/blob/${ramaBaseDocumento}/${carpeta}/${documento.slug}.md`,
        huella: calcularHuella(documento.tareas),
    };
}

/** Encabezado de `formatearFilaLegible` ("--dry-run" sin credenciales). */
export const ENCABEZADO_FILA_LEGIBLE = 'slug | estado | progreso | PRs abiertos | días | actualizado';

export function formatearFilaLegible(fila: FilaTablero): string {
    return [
        fila.slug.padEnd(28),
        fila.estado.padEnd(14),
        fila.progreso.padEnd(12),
        (fila.prsAbiertos || '—').padEnd(16),
        `${fila.diasSinActividad}d`.padEnd(6),
        fila.actualizado,
    ].join(' | ');
}

// ---------------------------------------------------------------------------
// Descriptor
// ---------------------------------------------------------------------------

export type DescriptorFeature = DescriptorEntidad<ClavePropiedad, Estado, DocumentoODD, FilaTablero>;

/** Descriptor de Feature con los ajustes del proyecto (carpeta de documentos
 *  y rama base del enlace "Documento") ya resueltos por quien lo compone. */
export function crearDescriptorFeature(ajustes: AjustesProyecto = AJUSTES_POR_DEFECTO): DescriptorFeature {
    return {
        ...ESQUEMA_FEATURE,
        clave: 'feature',
        carpeta: ajustes.carpetaFeatures,
        parsearDocumento,
        derivarEstado,
        construirFila: (parametros) => construirFila(parametros, ajustes),
        construirValoresPropiedades,
        formatearFilaLegible,
        encabezadoFilaLegible: ENCABEZADO_FILA_LEGIBLE,
    };
}
