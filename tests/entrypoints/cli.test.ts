/**
 * @jest-environment node
 *
 * Tests del punto de entrada de la CLI: la detección de ejecución directa y
 * el texto de "--ayuda". Importar el módulo NO debe ejecutar `principal()`
 * (Jest corre con su propio `process.argv[1]`).
 */
import { AYUDA, esInvocacionDirecta } from '../../src/entrypoints/cli';

describe('esInvocacionDirecta', () => {
    test.each([
        'src/entrypoints/cli.ts',
        '/home/alguien/repo/src/entrypoints/cli.ts',
        'C:\\Proyectos\\tablero\\src\\entrypoints\\cli.ts',
        'dist/entrypoints/cli.js',
        '/repo/dist/entrypoints/cli.mjs',
        '/repo/dist/entrypoints/cli.cjs',
    ])('reconoce "%s"', (ruta) => {
        expect(esInvocacionDirecta(ruta)).toBe(true);
    });

    test.each([
        '/repo/node_modules/jest-worker/build/workers/processChild.js',
        '/repo/node_modules/.bin/jest',
        'src/app/sincronizar.ts',
        'src/entrypoints/cli.test.ts',
        'src/entrypoints/otra-cli.ts',
        '',
        undefined,
    ])('NO reconoce "%s"', (ruta) => {
        expect(esInvocacionDirecta(ruta)).toBe(false);
    });
});

describe('AYUDA', () => {
    test('muestra el comando real de la CLI, no el script monolítico viejo', () => {
        expect(AYUDA).toContain('npm run sync');
        expect(AYUDA).toContain('npx tsx src/entrypoints/cli.ts');
        expect(AYUDA).not.toContain('sync-tablero-features');
    });
});
