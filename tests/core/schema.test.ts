/**
 * @jest-environment node
 *
 * Tests de propiedades y esquema de Notion (núcleo).
 *
 * Los casos NO leen `odd/tasks/` real: los documentos son strings fixture
 * dentro del propio test (convención de la casa, ver
 * `validar-rutas-docs.test.ts`), así que mover o editar un archivo del repo
 * no puede volver estos tests rojos por accidente.
 */
import { construirPropiedadesNotion, validarEsquema } from '../../src/core/schema';
import { type PropiedadesNotion } from '../../src/core/types';
import { ESQUEMA_CORRECTO_NOTION, filaBase } from '../helpers/fixtures';

import '../helpers/aislar-board-language';

// ---------------------------------------------------------------------------
// construirPropiedadesNotion
// ---------------------------------------------------------------------------

describe('construirPropiedadesNotion', () => {
    test('genera los 11 nombres y tipos exactos que exige el esquema de Notion', () => {
        const fila = filaBase();
        const propiedades: PropiedadesNotion = construirPropiedadesNotion(fila);

        expect(propiedades.Feature.title[0].text.content).toBe('Feature X');
        expect(propiedades.Slug.rich_text[0].text.content).toBe('feature-x');
        expect(propiedades.Estado.select.name).toBe('En curso');
        expect(propiedades.Progreso.rich_text[0].text.content).toBe('1/2 tareas');
        expect(propiedades.Pendiente.rich_text[0].text.content).toBe('T2 — Dos');
        expect(propiedades['PRs abiertos'].rich_text[0].text.content).toBe('#1');
        expect(propiedades.Ramas.rich_text[0].text.content).toBe('feat/x');
        expect(propiedades['Días sin actividad'].number).toBe(5);
        expect(propiedades.Actualizado.date.start).toBe('2026-09-01T00:00:00.000Z');
        expect(propiedades.Documento.url).toBe('https://github.com/owner/repo/blob/master/odd/tasks/feature-x.md');
        expect(propiedades.Huella.rich_text[0].text.content).toBe('abc123');
    });

    test('un campo de texto vacío se envía como "rich_text: []", no con contenido vacío', () => {
        const propiedades = construirPropiedadesNotion(filaBase({ pendiente: '' }));
        expect(propiedades.Pendiente.rich_text).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// validarEsquema
// ---------------------------------------------------------------------------

describe('validarEsquema', () => {
    test('un esquema correcto no reporta problemas', () => {
        expect(validarEsquema(ESQUEMA_CORRECTO_NOTION)).toEqual([]);
    });

    test('nombra la propiedad faltante', () => {
        const sinHuella = Object.fromEntries(
            Object.entries(ESQUEMA_CORRECTO_NOTION).filter(([nombre]) => nombre !== 'Huella'),
        );
        const problemas = validarEsquema(sinHuella);
        expect(problemas).toContainEqual(expect.objectContaining({ nombre: 'Huella', motivo: 'faltante' }));
    });

    test('nombra la propiedad con tipo incorrecto', () => {
        const conTipoMalo = { ...ESQUEMA_CORRECTO_NOTION, 'Días sin actividad': { type: 'rich_text' } };
        const problemas = validarEsquema(conTipoMalo);
        expect(problemas).toContainEqual(
            expect.objectContaining({
                nombre: 'Días sin actividad',
                motivo: 'tipo-incorrecto',
                tipoEsperado: 'number',
                tipoActual: 'rich_text',
            }),
        );
    });
});
