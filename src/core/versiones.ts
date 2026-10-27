/**
 * Elección de la versión de cada documento ODD que publica el tablero: entre
 * la del checkout y las de las ramas vivas, gana la editada más
 * recientemente (fecha del último commit que tocó el archivo). Así el avance
 * de una rama se ve antes del merge.
 */
import { coincideRama } from './status';
import type { VersionEnRama } from './types';

/** Un documento listo para parsear, con el origen de su versión. */
export interface DocumentoLeido {
    slug: string;
    contenido: string;
    /** Rama de la versión elegida cuando no es la del checkout. */
    rama?: string;
    /** Fecha ISO del último commit que la tocó, cuando viene de una rama. */
    fecha?: string;
}

export interface ParametrosElegirVersiones {
    delCheckout: Array<{ slug: string; contenido: string }>;
    /** Fecha ISO del último commit que tocó el documento en el checkout;
     *  `null` si no tiene historia (un archivo sin commitear, que se está
     *  escribiendo ahora: cuenta como el más reciente). */
    fechaDelCheckout: (slug: string) => string | null;
    deRamas: VersionEnRama[];
    /** Patrones de `ramas` que declara una versión; `null` si tiene errores
     *  de formato. */
    ramasDeclaradas: (slug: string, contenido: string) => string[] | null;
    ramaBase: string;
}

export interface ResultadoElegirVersiones {
    /** Primero los del checkout (en su orden), después los que solo existen
     *  en ramas, ordenados por slug. */
    documentos: DocumentoLeido[];
    /** Versiones de ramas ignoradas por errores de formato. */
    invalidas: Array<{ slug: string; rama: string }>;
}

/**
 * Una versión de una rama cuenta solo si esa rama coincide con las `ramas`
 * que declara esa misma versión, o si es la rama base: una rama ajena (ej.
 * de dependabot, con una copia vieja) nunca pisa el documento. Ante un
 * empate gana el checkout y, entre ramas, la primera por nombre.
 */
export function elegirVersionesMasRecientes(parametros: ParametrosElegirVersiones): ResultadoElegirVersiones {
    const invalidas: ResultadoElegirVersiones['invalidas'] = [];
    const candidatasPorSlug = new Map<string, VersionEnRama>();
    const ordenadas = [...parametros.deRamas].sort((a, b) => (a.rama < b.rama ? -1 : a.rama > b.rama ? 1 : 0));
    for (const version of ordenadas) {
        if (version.rama !== parametros.ramaBase) {
            const ramas = parametros.ramasDeclaradas(version.slug, version.contenido);
            if (ramas === null) {
                invalidas.push({ slug: version.slug, rama: version.rama });
                continue;
            }
            if (!ramas.some((patron) => coincideRama(patron, version.rama))) continue;
        }
        const actual = candidatasPorSlug.get(version.slug);
        if (!actual || milisegundos(version.fecha) > milisegundos(actual.fecha)) {
            candidatasPorSlug.set(version.slug, version);
        }
    }

    const deRama = (version: VersionEnRama): DocumentoLeido => ({
        slug: version.slug,
        contenido: version.contenido,
        rama: version.rama,
        fecha: version.fecha,
    });
    const documentos = parametros.delCheckout.map((documento): DocumentoLeido => {
        const candidata = candidatasPorSlug.get(documento.slug);
        if (!candidata) return { ...documento };
        candidatasPorSlug.delete(documento.slug);
        const fechaCheckout = parametros.fechaDelCheckout(documento.slug);
        const ganaLaRama = fechaCheckout !== null && milisegundos(candidata.fecha) > milisegundos(fechaCheckout);
        return ganaLaRama ? deRama(candidata) : { ...documento };
    });
    const soloEnRamas = [...candidatasPorSlug.values()].sort((a, b) => (a.slug < b.slug ? -1 : 1)).map(deRama);
    return { documentos: [...documentos, ...soloEnRamas], invalidas };
}

function milisegundos(fecha: string): number {
    return new Date(fecha).getTime();
}
