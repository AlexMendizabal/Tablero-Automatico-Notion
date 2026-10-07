/**
 * @jest-environment node
 *
 * Tests del contrato de entidades (`core/entities`) y de las funciones
 * genéricas de esquema (`core/schema.ts`) que lo consumen.
 */
import { crearDescriptorFeature, ESQUEMA_FEATURE, TIPOS_PROPIEDAD } from '../../src/core/entities/feature';
import { crearDescriptorTarea } from '../../src/core/entities/tarea';
import type { EsquemaEntidad } from '../../src/core/entities/tipos';
import {
    esquemaEsperadoEntidad,
    extraerPaginaExistente,
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
        expect(descriptor.propiedadesDeNotion).toEqual([]);
        expect(validarEsquemaEntidad(descriptor, ESQUEMA_CORRECTO_NOTION_TAREAS, 'es')).toEqual([]);
        expect(validarEsquemaEntidad(descriptor, ESQUEMA_CORRECTO_NOTION_TAREAS_EN, 'en')).toEqual([]);
        // Una base de Features (título "Feature") no sirve como base de Tareas.
        expect(validarEsquemaEntidad(descriptor, ESQUEMA_CORRECTO_NOTION)).toEqual([
            { nombre: 'Tarea', motivo: 'faltante', tipoEsperado: 'title' },
        ]);
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

    test('todas sus propiedades viajan a Notion; el padre no es una columna (todavía)', () => {
        const descriptor = crearDescriptorTarea();
        const fila = descriptor.construirFila(parametrosFila('padre'));

        const es = traducirPropiedadesEntidad(descriptor, descriptor.construirValoresPropiedades(fila, 'es'), 'es');
        const en = traducirPropiedadesEntidad(descriptor, descriptor.construirValoresPropiedades(fila, 'en'), 'en');

        expect(Object.keys(es)).toEqual(Object.keys(ESQUEMA_CORRECTO_NOTION_TAREAS));
        expect(Object.keys(en)).toEqual(Object.keys(ESQUEMA_CORRECTO_NOTION_TAREAS_EN));
        expect(es.Tarea).toEqual({ title: [{ type: 'text', text: { content: 'Tarea X' } }] });
        expect(en.Status).toEqual({ select: { name: 'In progress' } });
        expect(JSON.stringify(es)).not.toContain('padre');
    });

    test('la forma legible muestra el slug de la feature padre, o "—" si no tiene', () => {
        const descriptor = crearDescriptorTarea();

        expect(descriptor.encabezadoFilaLegible).toBe('slug | feature | estado | progreso | PRs abiertos | días | actualizado');
        expect(descriptor.formatearFilaLegible(descriptor.construirFila(parametrosFila('padre')))).toMatch(
            /^tarea-x\s+\| padre\s+\| En curso\s+\| 1\/2 tareas\s+\| —\s+\| 1d\s+\| 2026-09-20T00:00:00/,
        );
        expect(descriptor.formatearFilaLegible(descriptor.construirFila(parametrosFila(null)))).toMatch(
            /^tarea-x\s+\| —\s+\| En curso/,
        );
    });
});
