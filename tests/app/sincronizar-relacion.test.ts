/**
 * @jest-environment node
 *
 * Tests de la relación "Feature" de las Tareas: el mapa slug → página de
 * Features que deja la sincronización de Features, la relación que escribe
 * cada Tarea (o vacía, con aviso), el salteo de Notion para las Tareas cuando
 * Features no terminó, el detalle de la relación en "--dry-run" con
 * credenciales, y que "Responsable" (propiedad de Notion) nunca se escribe.
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
    ESQUEMA_CORRECTO_NOTION_EN,
    ESQUEMA_CORRECTO_NOTION_TAREAS,
    ESQUEMA_CORRECTO_NOTION_TAREAS_EN,
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

    test('un padre con espacios en su nombre ("mi feature.md") resuelve la relación a su página', async () => {
        const { entrada, paginaTarea } = escenario(
            [{ slug: 'mi feature', contenido: docFeature('Mi feature') }],
            [{ slug: 'tarea-x', contenido: docTarea('mi feature') }],
        );

        const resumen = await sincronizar({ dryRun: false }, entrada);

        expect(resumen.codigo).toBe(0);
        expect(resumen.tareas?.erroresDeFormato).toEqual([]);
        expect(resumen.paginasPorSlug?.get('mi feature')).toBe('page-1');
        expect(paginaTarea('tarea-x')?.properties.Feature).toEqual({ relation: [{ id: 'page-1' }] });
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

    test('con la huella sin cambios, la actualización reescribe igual la relación (sin reescribir el cuerpo)', async () => {
        const { features, tareas, entrada, paginaTarea } = escenario(
            [{ slug: 'padre', contenido: docFeature('Padre') }],
            [{ slug: 'tarea-x', contenido: docTarea('padre') }],
        );
        // 1.ª corrida: la tarea queda con la Huella calculada y relación a "page-1".
        await sincronizar({ dryRun: false }, entrada);
        const pagina = paginaTarea('tarea-x');
        expect(pagina).toBeDefined();
        if (!pagina) throw new Error('la 1.ª corrida no creó la página de "tarea-x"');
        // En Notion, la tarea apunta a una página vieja y la de la feature
        // padre ahora es otra ("page-nueva").
        pagina.properties.Feature = { relation: [{ id: 'page-vieja' }] };
        features.paginas.clear();
        features.paginas.set('page-nueva', { id: 'page-nueva', properties: propiedadesMinimas('padre', 'x'), hijos: [] });
        const desde = tareas.solicitudes.length;

        const segunda = await sincronizar({ dryRun: false }, entrada);

        expect(segunda.tareas?.actualizadas).toBe(1);
        expect(segunda.tareas?.cuerposReescritos).toBe(0);
        const solicitudes = tareas.solicitudes.slice(desde);
        expect(solicitudes.some((s) => s.ruta.startsWith('/blocks/'))).toBe(false);
        const actualizaciones = solicitudes.filter((s) => s.metodo === 'PATCH' && s.ruta === `/pages/${pagina.id}`);
        expect(actualizaciones).toHaveLength(1);
        expect(JSON.parse(actualizaciones[0].cuerpo).properties.Feature).toEqual({ relation: [{ id: 'page-nueva' }] });
        expect(pagina.properties.Feature).toEqual({ relation: [{ id: 'page-nueva' }] });
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

// ---------------------------------------------------------------------------
// "Responsable": propiedad de Notion, nunca se escribe
// ---------------------------------------------------------------------------

describe('sincronizar — "Responsable" nunca viaja a Notion', () => {
    test.each([
        ['es', 'Responsable'],
        ['en', 'Assignee'],
    ] as const)('ni al crear ni al actualizar (con y sin reescritura de cuerpo) (idioma: %s)', async (idioma, nombre) => {
        const documentosTareas = [
            { slug: 'tarea-a', contenido: docTarea('padre') },
            { slug: 'tarea-b', contenido: docTarea(null) },
        ];
        const features = crearNotionFalsoCompleto(idioma === 'es' ? ESQUEMA_CORRECTO_NOTION : ESQUEMA_CORRECTO_NOTION_EN);
        const tareas = crearNotionFalsoTareas(idioma === 'es' ? ESQUEMA_CORRECTO_NOTION_TAREAS : ESQUEMA_CORRECTO_NOTION_TAREAS_EN);
        const { fetchFalso } = combinarNotionFalsos(features, tareas);
        const entrada = {
            raizRepo: '/repo',
            ejecutar: ejecutar(),
            fetchInyectado: fetchFalso,
            listarDocumentos: () => [{ slug: 'padre', contenido: docFeature('Padre') }],
            listarDocumentosTareas: () => documentosTareas,
            credenciales: { token: 'tok', databaseId: features.databaseId, databaseIdTareas: tareas.databaseId },
            hoy: HOY,
            idioma,
        };

        // 1.ª corrida: altas.
        const primera = await sincronizar({ dryRun: false }, entrada);
        // Alguien asigna el Responsable a mano en Notion; "tarea-b" queda con
        // una huella vieja para forzar la reescritura de su cuerpo.
        const asignado = { people: [{ object: 'user', id: 'usuario-1' }] };
        for (const pagina of tareas.paginas.values()) pagina.properties[nombre] = asignado;
        const huella = idioma === 'es' ? 'Huella' : 'Fingerprint';
        const paginaB = [...tareas.paginas.values()].find((p) => JSON.stringify(p.properties.Slug).includes('"tarea-b"'));
        expect(paginaB).toBeDefined();
        if (!paginaB) throw new Error('la 1.ª corrida no creó la página de "tarea-b"');
        paginaB.properties[huella] = { rich_text: [{ type: 'text', text: { content: 'vieja' } }] };
        // 2.ª corrida: actualizaciones (tarea-a sin reescribir, tarea-b reescribiendo).
        const segunda = await sincronizar({ dryRun: false }, entrada);

        expect(primera.tareas?.creadas).toBe(2);
        expect(segunda.tareas?.actualizadas).toBe(2);
        expect(segunda.tareas?.cuerposReescritos).toBe(1);
        const escrituras = tareas.solicitudes.filter((s) => s.metodo === 'POST' || s.metodo === 'PATCH');
        expect(escrituras.some((s) => s.ruta === '/pages')).toBe(true);
        expect(escrituras.some((s) => s.ruta.startsWith('/pages/'))).toBe(true);
        for (const solicitud of [...tareas.solicitudes, ...features.solicitudes]) {
            expect(solicitud.cuerpo).not.toContain(nombre);
            expect(solicitud.cuerpo).not.toContain('"people"');
        }
        for (const pagina of tareas.paginas.values()) expect(pagina.properties[nombre]).toEqual(asignado);
    });
});
