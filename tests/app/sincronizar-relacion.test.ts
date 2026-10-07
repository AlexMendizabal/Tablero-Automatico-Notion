/**
 * @jest-environment node
 *
 * Tests de la relación "Feature" de las Tareas: el mapa slug → página de
 * Features que deja la sincronización de Features, la relación que escribe
 * cada Tarea (o vacía, con aviso), el salteo de Notion para las Tareas cuando
 * Features no terminó, y el detalle de la relación en "--dry-run" con
 * credenciales.
 *
 * Como en el resto de los tests de la app, los documentos son strings
 * fixture (nunca se lee `odd/` real).
 */
import { crearDescriptorFeature } from '../../src/core/entities/feature';
import {
    combinarNotionFalsos,
    crearEjecutarFalso,
    crearNotionFalsoCompleto,
    crearNotionFalsoTareas,
    docBase,
    ESQUEMA_CORRECTO_NOTION,
    propiedadesMinimas,
} from '../helpers/fixtures';
import { sincronizar, sincronizarEntidad } from '../helpers/sincronizar-compuesto';

import '../helpers/aislar-board-language';

const HOY = new Date('2026-09-21T00:00:00Z');

const docFeature = (titulo: string) => docBase({ titulo: `# ${titulo}` });
const docTarea = (padre: string | null) =>
    docBase({
        frontmatter: ['---', 'ramas: ["feat/t*"]', ...(padre === null ? [] : [`feature: "${padre}"`]), '---'].join('\n'),
        titulo: '# Una tarea',
    });

const ejecutar = () => crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });

/** Las dos bases falsas, una entrada de `sincronizar` sobre ellas y el log. */
function escenario(
    documentosFeatures: Array<{ slug: string; contenido: string }>,
    documentosTareas: Array<{ slug: string; contenido: string }>,
    esquemaFeatures = ESQUEMA_CORRECTO_NOTION,
) {
    const features = crearNotionFalsoCompleto(esquemaFeatures);
    const tareas = crearNotionFalsoTareas();
    const { fetchFalso, orden } = combinarNotionFalsos(features, tareas);
    const lineas: string[] = [];
    const entrada = {
        raizRepo: '/repo',
        ejecutar: ejecutar(),
        fetchInyectado: fetchFalso,
        listarDocumentos: () => documentosFeatures,
        listarDocumentosTareas: () => documentosTareas,
        credenciales: { token: 'tok', databaseId: features.databaseId, databaseIdTareas: tareas.databaseId },
        hoy: HOY,
        log: (l: string) => lineas.push(l),
    };
    /** Propiedades de la página de Tareas con ese Slug. */
    const paginaTarea = (slug: string) =>
        [...tareas.paginas.values()].find((p) => JSON.stringify(p.properties.Slug).includes(`"${slug}"`));
    return { features, tareas, orden, lineas, entrada, paginaTarea };
}

// ---------------------------------------------------------------------------
// Mapa slug → página de Features
// ---------------------------------------------------------------------------

describe('sincronizarEntidad — páginas de Features por slug', () => {
    test('después de escribir, expone las páginas existentes y las recién creadas', async () => {
        const { features, entrada } = escenario(
            [
                { slug: 'existente', contenido: docFeature('Existente') },
                { slug: 'nueva', contenido: docFeature('Nueva') },
            ],
            [],
        );
        features.paginas.set('page-vieja', { id: 'page-vieja', properties: propiedadesMinimas('existente', 'x'), hijos: [] });

        const resumen = await sincronizarEntidad(crearDescriptorFeature(), { dryRun: false }, entrada);

        expect(resumen.paginasPorSlug).toEqual(
            new Map([
                ['existente', 'page-vieja'],
                ['nueva', 'page-1'],
            ]),
        );
    });

    test('en "--dry-run" con credenciales, solo las existentes (y las que se crearían, aparte)', async () => {
        const { features, entrada } = escenario(
            [
                { slug: 'existente', contenido: docFeature('Existente') },
                { slug: 'nueva', contenido: docFeature('Nueva') },
            ],
            [],
        );
        features.paginas.set('page-vieja', { id: 'page-vieja', properties: propiedadesMinimas('existente', 'x'), hijos: [] });

        const resumen = await sincronizarEntidad(crearDescriptorFeature(), { dryRun: true }, entrada);

        expect(resumen.paginasPorSlug).toEqual(new Map([['existente', 'page-vieja']]));
        expect(resumen.slugsPorCrear).toEqual(['nueva']);
    });
});

// ---------------------------------------------------------------------------
// Relación escrita por cada Tarea
// ---------------------------------------------------------------------------

describe('sincronizar — relación "Feature" de las Tareas', () => {
    test('una tarea apunta a la página de su feature padre (recién creada o existente); sin padre, relación vacía', async () => {
        const { features, entrada, paginaTarea } = escenario(
            [
                { slug: 'existente', contenido: docFeature('Existente') },
                { slug: 'nueva', contenido: docFeature('Nueva') },
            ],
            [
                { slug: 'de-existente', contenido: docTarea('existente') },
                { slug: 'de-nueva', contenido: docTarea('nueva') },
                { slug: 'sin-padre', contenido: docTarea(null) },
            ],
        );
        features.paginas.set('page-vieja', { id: 'page-vieja', properties: propiedadesMinimas('existente', 'x'), hijos: [] });

        const resumen = await sincronizar({ dryRun: false }, entrada);

        expect(resumen.codigo).toBe(0);
        expect(resumen.tareas?.avisos).toBeUndefined();
        expect(paginaTarea('de-existente')?.properties.Feature).toEqual({ relation: [{ id: 'page-vieja' }] });
        expect(paginaTarea('de-nueva')?.properties.Feature).toEqual({ relation: [{ id: 'page-1' }] });
        expect(paginaTarea('sin-padre')?.properties.Feature).toEqual({ relation: [] });
    });

    test('la actualización de una tarea existente también escribe la relación', async () => {
        const { tareas, entrada, paginaTarea } = escenario(
            [{ slug: 'padre', contenido: docFeature('Padre') }],
            [{ slug: 'tarea-x', contenido: docTarea('padre') }],
        );
        tareas.paginas.set('tareas-page-vieja', {
            id: 'tareas-page-vieja',
            properties: { ...propiedadesMinimas('tarea-x', 'x'), Feature: { relation: [] } },
            hijos: [],
        });

        const resumen = await sincronizar({ dryRun: false }, entrada);

        expect(resumen.tareas?.actualizadas).toBe(1);
        expect(paginaTarea('tarea-x')?.properties.Feature).toEqual({ relation: [{ id: 'page-1' }] });
    });

    test('un padre sin página en Notion (su documento tiene errores) deja la relación vacía y avisa', async () => {
        const { entrada, paginaTarea } = escenario(
            [
                { slug: 'sana', contenido: docFeature('Sana') },
                { slug: 'rota', contenido: '# sin frontmatter' },
            ],
            [{ slug: 'tarea-x', contenido: docTarea('rota') }],
        );

        const resumen = await sincronizar({ dryRun: false }, entrada);

        expect(resumen.erroresDeFormato.map((e) => e.slug)).toEqual(['rota']); // los de Features
        expect(resumen.tareas?.codigo).toBe(0);
        expect(resumen.tareas?.creadas).toBe(1);
        expect(paginaTarea('tarea-x')?.properties.Feature).toEqual({ relation: [] });
        expect(resumen.tareas?.avisos).toEqual([
            {
                slug: 'tarea-x',
                mensajes: [
                    'La feature padre "rota" no tiene página en la base de Features de Notion (¿su documento tiene errores de formato?): la relación "Feature" queda vacía.',
                ],
            },
        ]);
    });
});

// ---------------------------------------------------------------------------
// Features no terminó: las Tareas no tocan Notion
// ---------------------------------------------------------------------------

describe('sincronizar — Features no terminó', () => {
    const MENSAJE =
        'La sincronización de Features no terminó: se omite la sincronización de Tareas con Notion (su relación "Feature" quedaría incompleta).';

    test.each([false, true])(
        'un esquema de Features inválido saltea Notion para las Tareas, con su mensaje y el código de Features (dry-run: %s)',
        async (dryRun) => {
            const { tareas, orden, lineas, entrada } = escenario(
                [{ slug: 'padre', contenido: docFeature('Padre') }],
                [{ slug: 'tarea-x', contenido: docTarea('padre') }],
                { ...ESQUEMA_CORRECTO_NOTION, Huella: { type: 'number' } },
            );

            const resumen = await sincronizar({ dryRun }, entrada);

            expect(resumen.codigo).toBe(1);
            expect(resumen.tareas?.codigo).toBe(0);
            expect(orden).not.toContain('tareas');
            expect(tareas.paginas.size).toBe(0);
            expect(lineas.slice(lineas.indexOf('Tareas:') + 1)).toEqual([
                MENSAJE,
                'Plan de escritura: no calculado (no se consultó Notion).',
                'Errores de formato: 0',
            ]);
        },
    );

    test('un error de entorno de Features (repo superficial) también la saltea', async () => {
        const sha = 'b'.repeat(40);
        const { orden, lineas, entrada } = escenario(
            [{ slug: 'padre', contenido: docBase({ frontmatter: `---\nramas: ["feat/x"]\ncommits: ["${sha}"]\n---` }) }],
            [{ slug: 'tarea-x', contenido: docTarea('padre') }],
        );

        const resumen = await sincronizar(
            { dryRun: false },
            { ...entrada, ejecutar: crearEjecutarFalso({ ramas: '', prs: '[]', superficial: true }) },
        );

        expect(resumen.codigo).toBe(1);
        expect(orden).not.toContain('tareas');
        expect(lineas[lineas.indexOf('Tareas:') + 1]).toBe(MENSAJE);
    });
});

// ---------------------------------------------------------------------------
// "--dry-run" con credenciales: la relación resuelta en el plan
// ---------------------------------------------------------------------------

describe('sincronizar — "--dry-run" con credenciales muestra la relación', () => {
    test('cada tarea con su feature padre y la página a la que apuntaría', async () => {
        const { features, tareas, lineas, entrada } = escenario(
            [
                { slug: 'existente', contenido: docFeature('Existente') },
                { slug: 'nueva', contenido: docFeature('Nueva') },
                { slug: 'rota', contenido: '# sin frontmatter' },
            ],
            [
                { slug: 'a', contenido: docTarea('existente') },
                { slug: 'b', contenido: docTarea('nueva') },
                { slug: 'c', contenido: docTarea('rota') },
                { slug: 'd', contenido: docTarea(null) },
            ],
        );
        features.paginas.set('page-vieja', { id: 'page-vieja', properties: propiedadesMinimas('existente', 'x'), hijos: [] });

        const resumen = await sincronizar({ dryRun: true }, entrada);

        expect(features.llamadas.crearPagina + tareas.llamadas.crearPagina).toBe(0);
        expect(resumen.tareas?.plan?.crearia).toBe(4);
        const bloqueTareas = lineas.slice(lineas.indexOf('Tareas:') + 1);
        expect(bloqueTareas.slice(0, 6)).toEqual([
            '--dry-run con credenciales: se consultó Notion en modo lectura; no se escribió nada.',
            'Relación "Feature":',
            '  a → existente (página page-vieja)',
            '  b → nueva (página nueva: se crea con la Feature)',
            '  c → rota (sin página en Notion: relación vacía)',
            '  d → (sin feature padre: relación vacía)',
        ]);
        expect(bloqueTareas[6]).toBe('Crearía: 4');
    });
});
