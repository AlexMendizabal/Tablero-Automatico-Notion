/**
 * @jest-environment node
 *
 * Tests de los ajustes por proyecto: su resolución pura (núcleo) y la lectura
 * del entorno al cargar `adapters/config.ts`, y las credenciales de Notion.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { cargarCredenciales } from '../../src/adapters/config';
import { AJUSTES_POR_DEFECTO, resolverAjustesProyecto, validarAjustesProyecto } from '../../src/core/ajustes';

describe('resolverAjustesProyecto', () => {
    test('sin variables, los valores por defecto', () => {
        expect(resolverAjustesProyecto({})).toEqual({
            carpetaFeatures: 'odd/tasks',
            carpetaTareas: 'odd/tareas',
            ramaBaseDocumento: 'main',
        });
        expect(resolverAjustesProyecto({})).toEqual(AJUSTES_POR_DEFECTO);
    });

    test('TABLERO_CARPETA, TABLERO_CARPETA_TAREAS y TABLERO_RAMA_BASE se respetan tal cual, aun vacías', () => {
        expect(
            resolverAjustesProyecto({
                TABLERO_CARPETA: 'docs/odd',
                TABLERO_CARPETA_TAREAS: 'docs/tareas',
                TABLERO_RAMA_BASE: 'develop',
            }),
        ).toEqual({
            carpetaFeatures: 'docs/odd',
            carpetaTareas: 'docs/tareas',
            ramaBaseDocumento: 'develop',
        });
        expect(resolverAjustesProyecto({ TABLERO_CARPETA: '' }).carpetaFeatures).toBe('');
        expect(resolverAjustesProyecto({ TABLERO_CARPETA_TAREAS: '' }).carpetaTareas).toBe('');
    });
});

describe('validarAjustesProyecto', () => {
    test('los valores por defecto y carpetas distintas son válidos', () => {
        expect(validarAjustesProyecto(AJUSTES_POR_DEFECTO)).toBeNull();
        expect(validarAjustesProyecto({ ...AJUSTES_POR_DEFECTO, carpetaTareas: 'odd/tasks/tareas' })).toBeNull();
    });

    test.each(['', '   ', '.', './'])('TABLERO_CARPETA_TAREAS vacía ("%s") es un error de configuración', (carpetaTareas) => {
        expect(validarAjustesProyecto({ ...AJUSTES_POR_DEFECTO, carpetaTareas })).toBe(
            'TABLERO_CARPETA_TAREAS está vacía: indicá la carpeta de los documentos de Tareas (por defecto, odd/tareas).',
        );
    });

    test.each(['odd/tasks', './odd/tasks/', 'odd//tasks', 'odd\\tasks', ' odd/tasks '])(
        'TABLERO_CARPETA_TAREAS igual a la carpeta de Features ("%s") es un error de configuración',
        (carpetaTareas) => {
            expect(validarAjustesProyecto({ ...AJUSTES_POR_DEFECTO, carpetaTareas })).toBe(
                'TABLERO_CARPETA_TAREAS ("' +
                    carpetaTareas +
                    '") es la misma carpeta que TABLERO_CARPETA ("odd/tasks"): las Tareas necesitan su propia carpeta.',
            );
        },
    );
});

describe('AJUSTES_PROYECTO (adapters/config.ts)', () => {
    const previos = {
        carpeta: process.env.TABLERO_CARPETA,
        carpetaTareas: process.env.TABLERO_CARPETA_TAREAS,
        rama: process.env.TABLERO_RAMA_BASE,
    };
    afterEach(() => {
        if (previos.carpeta === undefined) delete process.env.TABLERO_CARPETA;
        else process.env.TABLERO_CARPETA = previos.carpeta;
        if (previos.carpetaTareas === undefined) delete process.env.TABLERO_CARPETA_TAREAS;
        else process.env.TABLERO_CARPETA_TAREAS = previos.carpetaTareas;
        if (previos.rama === undefined) delete process.env.TABLERO_RAMA_BASE;
        else process.env.TABLERO_RAMA_BASE = previos.rama;
    });

    test('se leen UNA vez, al cargar el módulo: un cambio posterior del entorno (ej. el .env) no los afecta', () => {
        process.env.TABLERO_CARPETA = 'carpeta/al-cargar';
        process.env.TABLERO_CARPETA_TAREAS = 'tareas/al-cargar';
        delete process.env.TABLERO_RAMA_BASE;
        jest.isolateModules(() => {
            const config = require('../../src/adapters/config') as typeof import('../../src/adapters/config');
            process.env.TABLERO_CARPETA = 'carpeta/despues';
            process.env.TABLERO_CARPETA_TAREAS = 'tareas/despues';
            expect(config.AJUSTES_PROYECTO).toEqual({
                carpetaFeatures: 'carpeta/al-cargar',
                carpetaTareas: 'tareas/al-cargar',
                ramaBaseDocumento: 'main',
            });
        });
    });
});

describe('cargarCredenciales (adapters/config.ts)', () => {
    const NOMBRES = ['NOTION_TOKEN', 'NOTION_TABLERO_DB_ID', 'NOTION_TAREAS_DB_ID'] as const;
    const previos = Object.fromEntries(NOMBRES.map((n) => [n, process.env[n]]));
    // Raíz sin ".env": solo cuenta lo que ya está en el entorno del proceso.
    let raizSinEnv: string;
    beforeAll(() => {
        raizSinEnv = fs.mkdtempSync(path.join(os.tmpdir(), 'tablero-config-'));
    });
    afterAll(() => fs.rmSync(raizSinEnv, { recursive: true, force: true }));
    afterEach(() => {
        for (const nombre of NOMBRES) {
            if (previos[nombre] === undefined) delete process.env[nombre];
            else process.env[nombre] = previos[nombre];
        }
    });

    test('NOTION_TAREAS_DB_ID es opcional: si falta, las credenciales de Features no cambian', () => {
        process.env.NOTION_TOKEN = 'tok';
        process.env.NOTION_TABLERO_DB_ID = 'base-features';
        delete process.env.NOTION_TAREAS_DB_ID;

        expect(cargarCredenciales(raizSinEnv)).toEqual({ token: 'tok', databaseId: 'base-features' });
    });

    test('si está definido, viaja junto a las credenciales como "databaseIdTareas" (sin normalizar)', () => {
        process.env.NOTION_TOKEN = 'tok';
        process.env.NOTION_TABLERO_DB_ID = 'base-features';
        process.env.NOTION_TAREAS_DB_ID = 'https://www.notion.so/Tareas-0123456789abcdef0123456789abcdef?v=1';

        expect(cargarCredenciales(raizSinEnv)).toEqual({
            token: 'tok',
            databaseId: 'base-features',
            databaseIdTareas: 'https://www.notion.so/Tareas-0123456789abcdef0123456789abcdef?v=1',
        });
    });

    test('un NOTION_TAREAS_DB_ID vacío cuenta como ausente', () => {
        process.env.NOTION_TOKEN = 'tok';
        process.env.NOTION_TABLERO_DB_ID = 'base-features';
        process.env.NOTION_TAREAS_DB_ID = '';

        expect(cargarCredenciales(raizSinEnv)).toEqual({ token: 'tok', databaseId: 'base-features' });
    });

    test('sin NOTION_TOKEN no hay credenciales, aunque NOTION_TAREAS_DB_ID esté definido', () => {
        delete process.env.NOTION_TOKEN;
        process.env.NOTION_TABLERO_DB_ID = 'base-features';
        process.env.NOTION_TAREAS_DB_ID = 'base-tareas';

        expect(cargarCredenciales(raizSinEnv)).toBeNull();
    });
});
