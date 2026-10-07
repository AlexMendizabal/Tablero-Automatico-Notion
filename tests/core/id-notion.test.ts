/**
 * @jest-environment node
 *
 * Tests de normalización del ID de la base de Notion (núcleo).
 *
 * Los casos NO leen `odd/tasks/` real: los documentos son strings fixture
 * dentro del propio test (convención de la casa, ver
 * `validar-rutas-docs.test.ts`), así que mover o editar un archivo del repo
 * no puede volver estos tests rojos por accidente.
 */
import { normalizarIdBaseNotion } from '../../src/core/id-notion';

import '../helpers/aislar-board-language';

// ---------------------------------------------------------------------------
// normalizarIdBaseNotion (T7)
// ---------------------------------------------------------------------------

describe('normalizarIdBaseNotion (T7)', () => {
    const ID_32_HEX = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
    const ID_DASHED = 'a1b2c3d4-e5f6-a1b2-c3d4-e5f6a1b2c3d4';

    test('acepta el ID "pelado" de 32 hex tal cual', () => {
        const resultado = normalizarIdBaseNotion(ID_32_HEX);
        expect(resultado).toEqual({ ok: true, id: ID_32_HEX });
    });

    test('acepta el ID en mayúsculas y lo normaliza a minúsculas', () => {
        const resultado = normalizarIdBaseNotion(ID_32_HEX.toUpperCase());
        expect(resultado).toEqual({ ok: true, id: ID_32_HEX });
    });

    test('acepta el UUID con guiones y lo normaliza a la misma forma que el ID pelado', () => {
        const resultado = normalizarIdBaseNotion(ID_DASHED);
        expect(resultado).toEqual({ ok: true, id: ID_32_HEX });
    });

    test('recorta espacios alrededor del valor', () => {
        const resultado = normalizarIdBaseNotion(`  ${ID_32_HEX}  `);
        expect(resultado).toEqual({ ok: true, id: ID_32_HEX });
    });

    test('extrae el ID de una URL completa con "?v=" (el error real que motivó esta función)', () => {
        const resultado = normalizarIdBaseNotion(
            `https://www.notion.so/miworkspace/Tablero-de-Features-${ID_32_HEX}?v=${'0'.repeat(32)}`,
        );
        expect(resultado).toEqual({ ok: true, id: ID_32_HEX });
    });

    test('extrae el ID de una URL sin título ni "?v="', () => {
        const resultado = normalizarIdBaseNotion(`https://www.notion.so/${ID_32_HEX}`);
        expect(resultado).toEqual({ ok: true, id: ID_32_HEX });
    });

    test('extrae el ID de una URL de "notion.site" (workspace publicado)', () => {
        const resultado = normalizarIdBaseNotion(`https://miworkspace.notion.site/Tablero-${ID_32_HEX}?pvs=4`);
        expect(resultado).toEqual({ ok: true, id: ID_32_HEX });
    });

    test('extrae el UUID con guiones cuando es el último segmento de la URL', () => {
        const resultado = normalizarIdBaseNotion(`https://www.notion.so/miworkspace/${ID_DASHED}`);
        expect(resultado).toEqual({ ok: true, id: ID_32_HEX });
    });

    test('un valor sin ningún ID de Notion reconocible falla con un mensaje claro que no repite el valor crudo', () => {
        const valorCrudo = 'esto-no-es-un-id-de-notion-secreto-xyz';
        const resultado = normalizarIdBaseNotion(valorCrudo);
        expect(resultado.ok).toBe(false);
        if (!resultado.ok) {
            expect(resultado.error).not.toContain(valorCrudo);
            expect(resultado.error).toMatch(/32/);
            expect(resultado.error).toMatch(/url/i);
            expect(resultado.error).toMatch(/vista/i);
        }
    });

    test('una cadena vacía o solo espacios falla', () => {
        const resultado = normalizarIdBaseNotion('   ');
        expect(resultado.ok).toBe(false);
    });
});
