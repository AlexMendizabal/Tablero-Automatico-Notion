/**
 * @jest-environment node
 *
 * Tests del idioma del tablero (núcleo).
 *
 * Los casos NO leen `odd/tasks/` real: los documentos son strings fixture
 * dentro del propio test (convención de la casa, ver
 * `validar-rutas-docs.test.ts`), así que mover o editar un archivo del repo
 * no puede volver estos tests rojos por accidente.
 */
import { resolverIdiomaTablero } from '../../src/core/i18n';
import { construirFila, construirPropiedadesNotion, validarEsquema } from '../../src/core/entities/feature';
import { ESQUEMA_CORRECTO_NOTION, ESQUEMA_CORRECTO_NOTION_EN, filaBase, tarea } from '../helpers/fixtures';

import '../helpers/aislar-board-language';

// ---------------------------------------------------------------------------
// Idioma del tablero (BOARD_LANGUAGE): nombres, estados y textos en Notion
// ---------------------------------------------------------------------------

describe('resolverIdiomaTablero', () => {
    test.each([undefined, '', '   ', 'es', 'ES', ' es '])('"%s" resuelve a "es" (valor por defecto)', (valor) => {
        expect(resolverIdiomaTablero(valor)).toEqual({ ok: true, idioma: 'es' });
    });

    test.each(['en', 'EN', ' en '])('"%s" resuelve a "en"', (valor) => {
        expect(resolverIdiomaTablero(valor)).toEqual({ ok: true, idioma: 'en' });
    });

    test('un valor desconocido es un error que nombra la variable, el valor y los valores admitidos', () => {
        const resultado = resolverIdiomaTablero('xx');
        expect(resultado.ok).toBe(false);
        if (!resultado.ok) {
            expect(resultado.error).toContain('BOARD_LANGUAGE');
            expect(resultado.error).toContain('"xx"');
            expect(resultado.error).toContain('"es"');
            expect(resultado.error).toContain('"en"');
        }
    });
});

describe('idioma del tablero — núcleo puro', () => {
    test('construirPropiedadesNotion en inglés usa los 12 nombres en inglés y el estado traducido', () => {
        const propiedades = construirPropiedadesNotion(filaBase({ progreso: '1/2 tasks' }), 'en');

        expect(Object.keys(propiedades)).toEqual(Object.keys(ESQUEMA_CORRECTO_NOTION_EN));
        expect(propiedades.Feature.title[0].text.content).toBe('Feature X');
        expect(propiedades.Status.select.name).toBe('In progress');
        expect(propiedades.Progress.rich_text[0].text.content).toBe('1/2 tasks');
        expect(propiedades.Pending.rich_text[0].text.content).toBe('T2 — Dos');
        expect(propiedades['Open PRs'].rich_text[0].text.content).toBe('#1');
        expect(propiedades.Branches.rich_text[0].text.content).toBe('feat/x');
        expect(propiedades['Days inactive'].number).toBe(5);
        expect(propiedades.Updated.date.start).toBe('2026-09-01T00:00:00.000Z');
        expect(propiedades.Document.url).toBe('https://github.com/owner/repo/blob/master/odd/tasks/feature-x.md');
        expect(propiedades.Contributors.multi_select).toEqual([]);
        expect(propiedades.Fingerprint.rich_text[0].text.content).toBe('abc123');
    });

    test('sin idioma (o "es"), construirPropiedadesNotion conserva los nombres en español en el mismo orden', () => {
        const porDefecto = construirPropiedadesNotion(filaBase());
        expect(Object.keys(porDefecto)).toEqual(Object.keys(ESQUEMA_CORRECTO_NOTION));
        expect(construirPropiedadesNotion(filaBase(), 'es')).toEqual(porDefecto);
        expect(porDefecto.Estado.select.name).toBe('En curso');
    });

    test.each([
        ['Terminada', 'Done'],
        ['QA pendiente', 'QA pending'],
        ['Sin empezar', 'Not started'],
        ['En curso', 'In progress'],
    ] as const)('el estado "%s" se escribe como "%s" en inglés', (estado, enIngles) => {
        expect(construirPropiedadesNotion(filaBase({ estado }), 'en').Status.select.name).toBe(enIngles);
        expect(construirPropiedadesNotion(filaBase({ estado }), 'es').Estado.select.name).toBe(estado);
    });

    test('validarEsquema en inglés acepta el esquema en inglés y rechaza el español', () => {
        expect(validarEsquema(ESQUEMA_CORRECTO_NOTION_EN, 'en')).toEqual([]);
        const problemas = validarEsquema(ESQUEMA_CORRECTO_NOTION, 'en');
        expect(problemas).toContainEqual(expect.objectContaining({ nombre: 'Status', motivo: 'faltante' }));
        expect(problemas).toContainEqual(expect.objectContaining({ nombre: 'Fingerprint', motivo: 'faltante' }));
        expect(validarEsquema(ESQUEMA_CORRECTO_NOTION_EN)).toContainEqual(
            expect.objectContaining({ nombre: 'Estado', motivo: 'faltante' }),
        );
    });

    test('construirFila en inglés escribe el progreso como "N/M tasks"', () => {
        const parametros = {
            documento: {
                slug: 'feature-x',
                ramas: [],
                commits: [],
                titulo: 'Feature X',
                tareas: [tarea({ id: 'T1', hecha: true }), tarea({ id: 'T2' })],
            },
            todasLasRamas: [],
            todosLosPRs: [],
            fechaDocumento: null,
            hoy: new Date('2026-09-21T00:00:00Z'),
            ownerRepo: 'owner/repo',
        };
        expect(construirFila({ ...parametros, idioma: 'en' }).progreso).toBe('1/2 tasks');
        expect(construirFila({ ...parametros, idioma: 'es' }).progreso).toBe('1/2 tareas');
        expect(construirFila(parametros).progreso).toBe('1/2 tareas');
    });
});
