/**
 * Tests de la elección de la versión de cada documento ODD: entre la del
 * checkout y las de las ramas vivas, gana la editada más recientemente.
 */
import { elegirVersionesMasRecientes, type ParametrosElegirVersiones } from '../../src/core/versiones';
import type { VersionEnRama } from '../../src/core/types';

/** Contenido mínimo: la primera línea declara sus ramas (`null` = inválido). */
const contenido = (ramas: string[] | null, cuerpo = '') => `${ramas === null ? 'INVALIDO' : JSON.stringify(ramas)}\n${cuerpo}`;
const ramasDeclaradas = (_slug: string, texto: string) => {
    const linea = texto.split('\n')[0];
    return linea === 'INVALIDO' ? null : (JSON.parse(linea) as string[]);
};

function elegir(parametros: Partial<ParametrosElegirVersiones> & { deRamas: VersionEnRama[] }) {
    return elegirVersionesMasRecientes({
        delCheckout: [{ slug: 'x', contenido: contenido(['feat/x*'], 'checkout') }],
        fechaDelCheckout: () => '2026-10-10T00:00:00Z',
        ramasDeclaradas,
        ramaBase: 'main',
        ...parametros,
    });
}

const version = (rama: string, fecha: string, slug = 'x', ramas: string[] | null = ['feat/x*']): VersionEnRama => ({
    rama,
    slug,
    contenido: contenido(ramas, rama),
    fecha,
});

describe('elegirVersionesMasRecientes', () => {
    test('gana la versión de una rama editada después que la del checkout, con su rama y su fecha', () => {
        const { documentos } = elegir({ deRamas: [version('feat/x-1', '2026-10-12T00:00:00Z')] });
        expect(documentos).toEqual([
            { slug: 'x', contenido: contenido(['feat/x*'], 'feat/x-1'), rama: 'feat/x-1', fecha: '2026-10-12T00:00:00Z' },
        ]);
    });

    test('si el checkout es más reciente, o empata, gana el checkout (sin rama)', () => {
        for (const fecha of ['2026-10-01T00:00:00Z', '2026-10-10T00:00:00Z']) {
            const { documentos } = elegir({ deRamas: [version('feat/x-1', fecha)] });
            expect(documentos).toEqual([{ slug: 'x', contenido: contenido(['feat/x*'], 'checkout') }]);
        }
    });

    test('un documento del checkout sin historia (sin commitear) le gana a cualquier rama', () => {
        const { documentos } = elegir({
            fechaDelCheckout: () => null,
            deRamas: [version('feat/x-1', '2030-01-01T00:00:00Z')],
        });
        expect(documentos[0].rama).toBeUndefined();
    });

    test('entre varias ramas gana la más reciente; si empatan, la primera por nombre', () => {
        const masReciente = elegir({
            deRamas: [version('feat/x-a', '2026-10-11T00:00:00Z'), version('feat/x-b', '2026-10-13T00:00:00Z')],
        });
        expect(masReciente.documentos[0].rama).toBe('feat/x-b');
        const empate = elegir({
            deRamas: [version('feat/x-b', '2026-10-13T00:00:00Z'), version('feat/x-a', '2026-10-13T00:00:00Z')],
        });
        expect(empate.documentos[0].rama).toBe('feat/x-a');
    });

    test('la misma rama local y en origin (mismo nombre) no duplica el documento', () => {
        const { documentos } = elegir({
            deRamas: [version('feat/x-1', '2026-10-12T00:00:00Z'), version('feat/x-1', '2026-10-14T00:00:00Z')],
        });
        expect(documentos).toHaveLength(1);
        expect(documentos[0].fecha).toBe('2026-10-14T00:00:00Z');
    });

    test('un documento que solo existe en una rama aparece, después de los del checkout y ordenado por slug', () => {
        const { documentos } = elegir({
            deRamas: [
                version('feat/z', '2026-10-12T00:00:00Z', 'z', ['feat/z']),
                version('feat/y', '2026-10-12T00:00:00Z', 'y', ['feat/y']),
            ],
        });
        expect(documentos.map((d) => [d.slug, d.rama])).toEqual([
            ['x', undefined],
            ['y', 'feat/y'],
            ['z', 'feat/z'],
        ]);
    });

    test('una rama que la versión no declara se ignora; la rama base no necesita declararse', () => {
        const ajena = elegir({ deRamas: [version('dependabot/npm/x', '2026-10-12T00:00:00Z')] });
        expect(ajena.documentos[0].rama).toBeUndefined();
        expect(ajena.invalidas).toEqual([]);
        const base = elegir({ deRamas: [version('main', '2026-10-12T00:00:00Z')] });
        expect(base.documentos[0].rama).toBe('main');
    });

    test('una versión de rama con errores de formato se ignora y se informa', () => {
        const { documentos, invalidas } = elegir({
            deRamas: [version('feat/x-1', '2026-10-12T00:00:00Z', 'x', null)],
        });
        expect(documentos[0].rama).toBeUndefined();
        expect(invalidas).toEqual([{ slug: 'x', rama: 'feat/x-1' }]);
    });

    test('sin versiones de ramas devuelve el checkout tal cual, sin consultar fechas', () => {
        const fechaDelCheckout = jest.fn(() => '2026-10-10T00:00:00Z');
        const { documentos } = elegir({ deRamas: [], fechaDelCheckout });
        expect(documentos).toEqual([{ slug: 'x', contenido: contenido(['feat/x*'], 'checkout') }]);
        expect(fechaDelCheckout).not.toHaveBeenCalled();
    });
});
