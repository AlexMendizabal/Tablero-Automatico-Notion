/**
 * @jest-environment node
 *
 * Tests del contrato de entidades (`core/entities`) y de las funciones
 * genéricas de esquema (`core/schema.ts`) que lo consumen.
 */
import { crearDescriptorFeature, ESQUEMA_FEATURE, TIPOS_PROPIEDAD } from '../../src/core/entities/feature';
import { avisosFeaturePadre, crearDescriptorTarea } from '../../src/core/entities/tarea';
import type { EsquemaEntidad } from '../../src/core/entities/tipos';
import {
    esquemaEsperadoEntidad,
    extraerPaginaExistente,
    propiedadesOpcionalesAusentes,
    traducirPropiedadesEntidad,
    validarEsquemaEntidad,
} from '../../src/core/schema';
import {
    docBase,
    ESQUEMA_CORRECTO_NOTION,
    ESQUEMA_CORRECTO_NOTION_TAREAS,
    ESQUEMA_CORRECTO_NOTION_TAREAS_EN,
    filaBase,
    tarea,
} from '../helpers/fixtures';

import '../helpers/aislar-board-language';

/** Entidad de prueba con una propiedad de Notion ("responsable", people) que
 *  la sincronización valida pero nunca escribe. */
type ClavePrueba = 'nombre' | 'slug' | 'responsable' | 'huella';
const ESQUEMA_PRUEBA: EsquemaEntidad<ClavePrueba, 'Abierta'> = {
    tiposPropiedad: { nombre: 'title', slug: 'rich_text', responsable: 'people', huella: 'rich_text' },
    claveTitulo: 'nombre',
    claveSlug: 'slug',
    claveHuella: 'huella',
    propiedadesDeNotion: ['responsable'],
    propiedadesOpcionales: [],
    textos: {
        es: {
            propiedades: { nombre: 'Nombre', slug: 'Slug', responsable: 'Responsable', huella: 'Huella' },
            estados: { Abierta: 'Abierta' },
            progreso: (h, t) => `${h}/${t}`,
        },
        en: {
            propiedades: { nombre: 'Name', slug: 'Slug', responsable: 'Assignee', huella: 'Fingerprint' },
            estados: { Abierta: 'Open' },
            progreso: (h, t) => `${h}/${t}`,
        },
    },
};

describe('propiedades de Notion (propiedadesDeNotion)', () => {
    test('se validan en el esquema esperado aunque nunca se escriban', () => {
        expect(esquemaEsperadoEntidad(ESQUEMA_PRUEBA, 'es')).toContainEqual({ nombre: 'Responsable', tipo: 'people' });
        expect(
            validarEsquemaEntidad(ESQUEMA_PRUEBA, { Nombre: { type: 'title' }, Slug: { type: 'rich_text' }, Huella: { type: 'rich_text' } }),
        ).toEqual([{ nombre: 'Responsable', motivo: 'faltante', tipoEsperado: 'people' }]);
    });

    test('quedan fuera de las propiedades que viajan a Notion, aunque el armado de valores las incluya', () => {
        const valores = {
            nombre: { title: [] },
            slug: { rich_text: [] },
            responsable: { people: [{ id: 'alguien' }] },
            huella: { rich_text: [] },
        };
        const es = traducirPropiedadesEntidad(ESQUEMA_PRUEBA, valores, 'es');
        const en = traducirPropiedadesEntidad(ESQUEMA_PRUEBA, valores, 'en');

        expect(Object.keys(es)).toEqual(['Nombre', 'Slug', 'Huella']);
        expect(Object.keys(en)).toEqual(['Name', 'Slug', 'Fingerprint']);
    });
});

describe('descriptor de Feature', () => {
    test('expone el esquema de siempre, sin propiedades de Notion', () => {
        const descriptor = crearDescriptorFeature({ carpetaFeatures: 'odd/tasks', carpetaTareas: 'odd/tareas', ramaBaseDocumento: 'main' });

        expect(descriptor.clave).toBe('feature');
        expect(descriptor.carpeta).toBe('odd/tasks');
        expect(descriptor.tiposPropiedad).toBe(TIPOS_PROPIEDAD);
        expect(descriptor.claveTitulo).toBe('feature');
        expect(descriptor.propiedadesDeNotion).toEqual([]);
        expect(validarEsquemaEntidad(descriptor, ESQUEMA_CORRECTO_NOTION)).toEqual([]);
    });

    test('todas sus propiedades viajan a Notion', () => {
        const descriptor = crearDescriptorFeature();
        const propiedades = traducirPropiedadesEntidad(
            descriptor,
            descriptor.construirValoresPropiedades(filaBase(), 'es'),
            'es',
        );
        expect(Object.keys(propiedades)).toEqual(Object.keys(ESQUEMA_CORRECTO_NOTION));
    });

    test('arma el enlace "Documento" con la carpeta y la rama base recibidas', () => {
        const descriptor = crearDescriptorFeature({
            carpetaFeatures: 'docs/features',
            carpetaTareas: 'docs/tareas',
            ramaBaseDocumento: 'develop',
        });
        const fila = descriptor.construirFila({
            documento: { slug: 'x', ramas: [], commits: [], titulo: 'X', tareas: [] },
            todasLasRamas: [],
            todosLosPRs: [],
            fechaDocumento: null,
            hoy: new Date('2026-09-21T00:00:00Z'),
            ownerRepo: 'org/repo',
        });
        expect(descriptor.carpeta).toBe('docs/features');
        expect(fila.documento).toBe('https://github.com/org/repo/blob/develop/docs/features/x.md');
    });
});

describe('extraerPaginaExistente', () => {
    test('lee Slug y Huella por sus nombres visibles en el idioma del tablero', () => {
        const pagina = {
            id: 'page-1',
            createdTime: '2026-01-01T00:00:00.000Z',
            properties: {
                Slug: { rich_text: [{ plain_text: 'feature-' }, { text: { content: 'x' } }] },
                Fingerprint: { rich_text: [{ plain_text: 'abc' }] },
            },
        };
        expect(extraerPaginaExistente(ESQUEMA_FEATURE, pagina, 'en')).toEqual({
            pageId: 'page-1',
            slug: 'feature-x',
            huella: 'abc',
            createdTime: '2026-01-01T00:00:00.000Z',
        });
        expect(extraerPaginaExistente(ESQUEMA_FEATURE, pagina, 'es').huella).toBe('');
    });
});

describe('descriptor de Tarea', () => {
    const AJUSTES_PROPIOS = { carpetaFeatures: 'docs/features', carpetaTareas: 'docs/tareas', ramaBaseDocumento: 'develop' };
    const documentoTarea = (feature: string | null) => ({
        slug: 'tarea-x',
        ramas: ['feat/tarea-x*'],
        commits: [],
        titulo: 'Tarea X',
        tareas: [tarea({ hecha: true }), tarea({ id: 'T2', nombre: 'Dos' })],
        feature,
    });
    const parametrosFila = (feature: string | null) => ({
        documento: documentoTarea(feature),
        todasLasRamas: [{ nombre: 'feat/tarea-x-1', fecha: '2026-09-20T00:00:00Z' }],
        todosLosPRs: [],
        fechaDocumento: null,
        hoy: new Date('2026-09-21T00:00:00Z'),
        ownerRepo: 'org/repo',
    });

    test('su carpeta es la de los ajustes y su base tiene las columnas de Features con título "Tarea"/"Task"', () => {
        const descriptor = crearDescriptorTarea(AJUSTES_PROPIOS);

        expect(descriptor.clave).toBe('tarea');
        expect(descriptor.carpeta).toBe('docs/tareas');
        expect(descriptor.claveTitulo).toBe('tarea');
        expect(validarEsquemaEntidad(descriptor, ESQUEMA_CORRECTO_NOTION_TAREAS, 'es')).toEqual([]);
        expect(validarEsquemaEntidad(descriptor, ESQUEMA_CORRECTO_NOTION_TAREAS_EN, 'en')).toEqual([]);
        // Una base de Features (título "Feature") no sirve como base de Tareas.
        expect(validarEsquemaEntidad(descriptor, ESQUEMA_CORRECTO_NOTION)).toEqual([
            { nombre: 'Tarea', motivo: 'faltante', tipoEsperado: 'title' },
            { nombre: 'Feature', motivo: 'tipo-incorrecto', tipoEsperado: 'relation', tipoActual: 'title' },
            { nombre: 'Responsable', motivo: 'faltante', tipoEsperado: 'people' },
        ]);
    });

    test('su base suma "Feature" (relación) y "Responsable"/"Assignee" (people, propiedad de Notion)', () => {
        const descriptor = crearDescriptorTarea();

        expect(descriptor.tiposPropiedad.feature).toBe('relation');
        expect(descriptor.tiposPropiedad.responsable).toBe('people');
        expect(descriptor.propiedadesDeNotion).toEqual(['responsable']);
        expect(descriptor.textos.es.propiedades).toMatchObject({ feature: 'Feature', responsable: 'Responsable' });
        expect(descriptor.textos.en.propiedades).toMatchObject({ feature: 'Feature', responsable: 'Assignee' });
        expect(
            validarEsquemaEntidad(descriptor, { ...ESQUEMA_CORRECTO_NOTION_TAREAS, Responsable: { type: 'rich_text' } }),
        ).toEqual([{ nombre: 'Responsable', motivo: 'tipo-incorrecto', tipoEsperado: 'people', tipoActual: 'rich_text' }]);
    });

    test('por defecto, la carpeta es "odd/tareas"', () => {
        expect(crearDescriptorTarea().carpeta).toBe('odd/tareas');
    });

    test('parsea "feature" (padre) del frontmatter; un documento sin "feature" queda sin padre', () => {
        const descriptor = crearDescriptorTarea();
        const conPadre = descriptor.parsearDocumento('t', docBase({ frontmatter: '---\nramas: ["feat/x"]\nfeature: "padre"\n---' }));
        const sinPadre = descriptor.parsearDocumento('t', docBase());

        expect(conPadre.ok && conPadre.documento.feature).toBe('padre');
        expect(sinPadre.ok && sinPadre.documento.feature).toBeNull();
    });

    test('la regla de estado es la de Features', () => {
        expect(crearDescriptorTarea().derivarEstado).toBe(crearDescriptorFeature().derivarEstado);
    });

    test('arma la fila con el título, el padre y el enlace "Documento" de la carpeta de Tareas', () => {
        const fila = crearDescriptorTarea(AJUSTES_PROPIOS).construirFila(parametrosFila('padre'));

        expect(fila).toMatchObject({
            tarea: 'Tarea X',
            slug: 'tarea-x',
            featurePadre: 'padre',
            estado: 'En curso',
            progreso: '1/2 tareas',
            pendiente: 'T2 — Dos',
            ramas: 'feat/tarea-x-1',
            documento: 'https://github.com/org/repo/blob/develop/docs/tareas/tarea-x.md',
        });
        expect(fila).not.toHaveProperty('feature');
    });

    test('sus propiedades viajan a Notion, salvo "Responsable" (nunca) y, sin páginas de Features, la relación', () => {
        const descriptor = crearDescriptorTarea();
        const fila = descriptor.construirFila(parametrosFila('padre'));

        const es = traducirPropiedadesEntidad(descriptor, descriptor.construirValoresPropiedades(fila, 'es'), 'es');
        const en = traducirPropiedadesEntidad(descriptor, descriptor.construirValoresPropiedades(fila, 'en'), 'en');

        const sinNotion = (nombre: string) => !['Feature', 'Responsable', 'Assignee'].includes(nombre);
        expect(Object.keys(es)).toEqual(Object.keys(ESQUEMA_CORRECTO_NOTION_TAREAS).filter(sinNotion));
        expect(Object.keys(en)).toEqual(Object.keys(ESQUEMA_CORRECTO_NOTION_TAREAS_EN).filter(sinNotion));
        expect(es.Tarea).toEqual({ title: [{ type: 'text', text: { content: 'Tarea X' } }] });
        expect(en.Status).toEqual({ select: { name: 'In progress' } });
        expect(JSON.stringify(es)).not.toContain('padre');
    });

    test('con las páginas de Features, la relación viaja a Notion; "Responsable" nunca', () => {
        const descriptor = crearDescriptorTarea(undefined, undefined, { paginas: new Map([['padre', 'page-padre']]) });
        const fila = descriptor.construirFila(parametrosFila('padre'));

        const es = traducirPropiedadesEntidad(descriptor, descriptor.construirValoresPropiedades(fila, 'es'), 'es');
        const en = traducirPropiedadesEntidad(
            descriptor,
            { ...descriptor.construirValoresPropiedades(fila, 'en'), responsable: { people: [{ id: 'alguien' }] } },
            'en',
        );

        expect(es.Feature).toEqual({ relation: [{ id: 'page-padre' }] });
        expect(Object.keys(es)).toEqual(Object.keys(ESQUEMA_CORRECTO_NOTION_TAREAS).filter((n) => n !== 'Responsable'));
        expect(en).not.toHaveProperty('Assignee');
        expect(descriptor.construirValoresPropiedades(descriptor.construirFila(parametrosFila(null)), 'es').feature).toEqual({
            relation: [],
        });
    });

    test('la forma legible muestra el slug de la feature padre, o "—" si no tiene', () => {
        const descriptor = crearDescriptorTarea();

        expect(descriptor.encabezadoFilaLegible).toBe(
            'slug | feature | estado | progreso | PRs abiertos | días | actualizado | contribuyentes',
        );
        expect(descriptor.formatearFilaLegible(descriptor.construirFila(parametrosFila('padre')))).toMatch(
            /^tarea-x\s+\| padre\s+\| En curso\s+\| 1\/2 tareas\s+\| —\s+\| 1d\s+\| 2026-09-20T00:00:00\.000Z \| —$/,
        );
        const { feature: _titulo, ...resto } = filaBase({ contribuyentes: ['Ana', 'Zoe'] });
        expect(descriptor.formatearFilaLegible({ ...resto, tarea: 'T', featurePadre: null })).toMatch(/ \| Ana, Zoe$/);
        expect(descriptor.formatearFilaLegible(descriptor.construirFila(parametrosFila(null)))).toMatch(
            /^tarea-x\s+\| —\s+\| En curso/,
        );
    });
});

describe('validarEsquemaEntidad — destino de una relación', () => {
    const descriptor = crearDescriptorTarea();
    const conDestino = (relation: Record<string, string> | undefined) => ({
        ...ESQUEMA_CORRECTO_NOTION_TAREAS,
        Feature: { type: 'relation', ...(relation ? { relation } : {}) },
    });

    test('una relación con el data source esperado es válida (con o sin guiones, en cualquier caja)', () => {
        const destino = '0123abcd-0000-4000-8000-00000000abcd';
        const sinGuiones = destino.split('-').join('').toUpperCase();
        expect(validarEsquemaEntidad(descriptor, conDestino({ data_source_id: destino }), 'es', { feature: destino })).toEqual([]);
        expect(
            validarEsquemaEntidad(descriptor, conDestino({ data_source_id: sinGuiones }), 'es', { feature: destino }),
        ).toEqual([]);
    });

    test('una relación con otra base es un problema de esquema que nombra los dos destinos', () => {
        expect(
            validarEsquemaEntidad(descriptor, conDestino({ data_source_id: 'ds-otra', database_id: 'db-otra' }), 'es', {
                feature: 'ds-features',
            }),
        ).toEqual([
            {
                nombre: 'Feature',
                motivo: 'relacion-incorrecta',
                tipoEsperado: 'relation',
                destinoEsperado: 'ds-features',
                destinoActual: 'ds-otra',
            },
        ]);
        expect(validarEsquemaEntidad(descriptor, conDestino(undefined), 'es', { feature: 'ds-features' })).toEqual([
            expect.objectContaining({ nombre: 'Feature', motivo: 'relacion-incorrecta', destinoActual: undefined }),
        ]);
    });

    test('sin destino esperado, solo se valida el tipo', () => {
        expect(validarEsquemaEntidad(descriptor, conDestino({ data_source_id: 'ds-otra' }))).toEqual([]);
    });
});

describe('Tarea — feature padre inexistente (avisosFeaturePadre)', () => {
    const doc = (slug: string, feature: string | null) => ({ slug, ramas: [], commits: [], titulo: slug, tareas: [], feature });

    test('avisa solo de las tareas cuyo padre no es un documento de Features', () => {
        const avisos = avisosFeaturePadre(
            [doc('sin-padre', null), doc('con-padre', 'existe'), doc('huerfana', 'no-existe')],
            new Set(['existe']),
            'odd/tasks',
        );
        expect(avisos).toEqual([
            {
                slug: 'huerfana',
                mensajes: ['La feature padre "no-existe" no existe: no hay ningún documento "no-existe.md" en "odd/tasks".'],
            },
        ]);
    });

    test('el descriptor valida el padre solo si recibe los slugs de Features', () => {
        expect(crearDescriptorTarea().avisosDocumentos).toBeUndefined();
        const descriptor = crearDescriptorTarea(undefined, new Set(['existe']));
        expect(descriptor.avisosDocumentos?.([doc('t', 'otra')])).toHaveLength(1);
    });

    test('cada descriptor nombra la variable de su base de Notion', () => {
        expect(crearDescriptorFeature().variableBaseNotion).toBe('NOTION_TABLERO_DB_ID');
        expect(crearDescriptorTarea().variableBaseNotion).toBe('NOTION_TAREAS_DB_ID');
    });
});

// ---------------------------------------------------------------------------
// Propiedades opcionales y "Contribuyentes"
// ---------------------------------------------------------------------------

describe('propiedades opcionales (propiedadesOpcionales)', () => {
    type Clave = 'nombre' | 'slug' | 'etiquetas' | 'huella';
    const ESQUEMA: EsquemaEntidad<Clave, 'Abierta'> = {
        tiposPropiedad: { nombre: 'title', slug: 'rich_text', etiquetas: 'multi_select', huella: 'rich_text' },
        claveTitulo: 'nombre',
        claveSlug: 'slug',
        claveHuella: 'huella',
        propiedadesDeNotion: [],
        propiedadesOpcionales: ['etiquetas'],
        textos: {
            es: { propiedades: { nombre: 'Nombre', slug: 'Slug', etiquetas: 'Etiquetas', huella: 'Huella' }, estados: { Abierta: 'Abierta' }, progreso: (h, t) => `${h}/${t}` },
            en: { propiedades: { nombre: 'Name', slug: 'Slug', etiquetas: 'Tags', huella: 'Fingerprint' }, estados: { Abierta: 'Open' }, progreso: (h, t) => `${h}/${t}` },
        },
    };
    const BASE = { Nombre: { type: 'title' }, Slug: { type: 'rich_text' }, Huella: { type: 'rich_text' } };

    test('si falta, no es un error de esquema y figura como ausente', () => {
        expect(validarEsquemaEntidad(ESQUEMA, BASE)).toEqual([]);
        expect(propiedadesOpcionalesAusentes(ESQUEMA, BASE, 'es')).toEqual(['etiquetas']);
    });

    test('si existe, tiene que tener su tipo (y no figura como ausente)', () => {
        const conTipoIncorrecto = { ...BASE, Etiquetas: { type: 'rich_text' } };
        expect(validarEsquemaEntidad(ESQUEMA, conTipoIncorrecto)).toEqual([
            { nombre: 'Etiquetas', motivo: 'tipo-incorrecto', tipoEsperado: 'multi_select', tipoActual: 'rich_text' },
        ]);
        expect(propiedadesOpcionalesAusentes(ESQUEMA, { ...BASE, Etiquetas: { type: 'multi_select' } }, 'es')).toEqual([]);
    });

    test('se busca por el nombre del idioma', () => {
        const baseEn = { Name: { type: 'title' }, Slug: { type: 'rich_text' }, Fingerprint: { type: 'rich_text' }, Etiquetas: { type: 'multi_select' } };
        expect(propiedadesOpcionalesAusentes(ESQUEMA, baseEn, 'en')).toEqual(['etiquetas']);
    });

    test('las claves omitidas no se traducen (no viajan a Notion)', () => {
        const valores = { nombre: 'n', slug: 's', etiquetas: { multi_select: [] }, huella: 'h' };
        expect(Object.keys(traducirPropiedadesEntidad(ESQUEMA, valores, 'es', ['etiquetas']))).toEqual(['Nombre', 'Slug', 'Huella']);
        expect(Object.keys(traducirPropiedadesEntidad(ESQUEMA, valores, 'es'))).toEqual(['Nombre', 'Slug', 'Etiquetas', 'Huella']);
    });
});

describe('"Contribuyentes" en Features y Tareas', () => {
    test.each([
        ['Features', crearDescriptorFeature()],
        ['Tareas', crearDescriptorTarea()],
    ] as const)('%s: multi-select opcional, "Contribuyentes" / "Contributors"', (nombreBase, descriptor) => {
        expect(descriptor.nombreBase).toBe(nombreBase);
        expect((descriptor.tiposPropiedad as Record<string, string>).contribuyentes).toBe('multi_select');
        expect(descriptor.propiedadesOpcionales).toEqual(['contribuyentes']);
        expect((descriptor.textos.es.propiedades as Record<string, string>).contribuyentes).toBe('Contribuyentes');
        expect((descriptor.textos.en.propiedades as Record<string, string>).contribuyentes).toBe('Contributors');
    });

    test('se escribe como multi_select con un nombre por contribuyente (vacío si no hay)', () => {
        const feature = crearDescriptorFeature();
        expect(feature.construirValoresPropiedades(filaBase({ contribuyentes: ['Ana', 'octocat'] }), 'es').contribuyentes).toEqual({
            multi_select: [{ name: 'Ana' }, { name: 'octocat' }],
        });
        expect(feature.construirValoresPropiedades(filaBase(), 'en').contribuyentes).toEqual({ multi_select: [] });
        const tarea = crearDescriptorTarea();
        const { feature: _titulo, ...resto } = filaBase({ contribuyentes: ['Zoe'] });
        const filaTarea = { ...resto, tarea: 'Tarea X', featurePadre: null };
        expect(tarea.construirValoresPropiedades(filaTarea, 'es').contribuyentes).toEqual({ multi_select: [{ name: 'Zoe' }] });
    });
});
