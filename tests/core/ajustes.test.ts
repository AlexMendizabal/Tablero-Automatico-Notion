/**
 * @jest-environment node
 *
 * Tests de los ajustes por proyecto: su resolución pura (núcleo) y la lectura
 * del entorno al cargar `adapters/config.ts`.
 */
import { AJUSTES_POR_DEFECTO, resolverAjustesProyecto } from '../../src/core/ajustes';

describe('resolverAjustesProyecto', () => {
    test('sin variables, los valores por defecto', () => {
        expect(resolverAjustesProyecto({})).toEqual({ carpetaFeatures: 'odd/tasks', ramaBaseDocumento: 'main' });
        expect(resolverAjustesProyecto({})).toEqual(AJUSTES_POR_DEFECTO);
    });

    test('TABLERO_CARPETA y TABLERO_RAMA_BASE se respetan tal cual, aun vacías', () => {
        expect(resolverAjustesProyecto({ TABLERO_CARPETA: 'docs/odd', TABLERO_RAMA_BASE: 'develop' })).toEqual({
            carpetaFeatures: 'docs/odd',
            ramaBaseDocumento: 'develop',
        });
        expect(resolverAjustesProyecto({ TABLERO_CARPETA: '' }).carpetaFeatures).toBe('');
    });
});

describe('AJUSTES_PROYECTO (adapters/config.ts)', () => {
    const previos = { carpeta: process.env.TABLERO_CARPETA, rama: process.env.TABLERO_RAMA_BASE };
    afterEach(() => {
        if (previos.carpeta === undefined) delete process.env.TABLERO_CARPETA;
        else process.env.TABLERO_CARPETA = previos.carpeta;
        if (previos.rama === undefined) delete process.env.TABLERO_RAMA_BASE;
        else process.env.TABLERO_RAMA_BASE = previos.rama;
    });

    test('se leen UNA vez, al cargar el módulo: un cambio posterior del entorno (ej. el .env) no los afecta', () => {
        process.env.TABLERO_CARPETA = 'carpeta/al-cargar';
        delete process.env.TABLERO_RAMA_BASE;
        jest.isolateModules(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const config = require('../../src/adapters/config') as typeof import('../../src/adapters/config');
            process.env.TABLERO_CARPETA = 'carpeta/despues';
            expect(config.AJUSTES_PROYECTO).toEqual({ carpetaFeatures: 'carpeta/al-cargar', ramaBaseDocumento: 'main' });
        });
    });
});
