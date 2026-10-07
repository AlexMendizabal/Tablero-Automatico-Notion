/**
 * @jest-environment node
 *
 * Tests del contrato de entidades (`core/entities`) y de las funciones
 * genéricas de esquema (`core/schema.ts`) que lo consumen.
 */
import { crearDescriptorFeature, ESQUEMA_FEATURE, TIPOS_PROPIEDAD } from '../../src/core/entities/feature';
import type { EsquemaEntidad } from '../../src/core/entities/tipos';
import {
    esquemaEsperadoEntidad,
    extraerPaginaExistente,
    traducirPropiedadesEntidad,
    validarEsquemaEntidad,
} from '../../src/core/schema';
import { ESQUEMA_CORRECTO_NOTION, filaBase } from '../helpers/fixtures';

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
