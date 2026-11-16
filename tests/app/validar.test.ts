/**
 * Tests de `validar` (flag "--validar"): solo lee y parsea los documentos de
 * Features y Tareas; nunca toca el ".env", Notion ni git/gh (sus
 * dependencias ni siquiera los incluyen).
 */
import { validar } from '../../src/app/validar';
import type { AjustesProyecto } from '../../src/core/ajustes';
import { parsearDocumentoTarea } from '../../src/core/entities/tarea';
import { parsearDocumento } from '../../src/core/parse';
import type { DependenciasValidar } from '../../src/ports/validar';
import { docBase } from '../helpers/fixtures';

const AJUSTES: AjustesProyecto = { carpetaFeatures: 'odd/tasks', carpetaTareas: 'odd/tareas', ramaBaseDocumento: 'main' };
const ENCABEZADO = '--validar: solo se leyeron y parsearon los documentos (sin .env, sin Notion, sin git/gh).';
const ROTO = '# sin frontmatter';

const docTarea = (padre: string) =>
    docBase({ frontmatter: ['---', 'ramas: ["feat/tarea-x*"]', `feature: "${padre}"`, '---'].join('\n') });

type Documentos = Array<{ slug: string; contenido: string }>;

/** Carpetas falsas: una carpeta ausente de `carpetas` no existe (lanza como
 *  `listarDocumentosODD`, o `[]` si es opcional). */
function crear(carpetas: Record<string, Documentos | Error>, ajustes: AjustesProyecto = AJUSTES) {
    const lineas: string[] = [];
    const listarDocumentos = jest.fn((carpeta: string, opciones?: { opcional?: boolean }) => {
        const contenido = carpetas[carpeta];
        if (contenido instanceof Error) throw contenido;
        if (contenido === undefined) {
            if (opciones?.opcional) return [];
            throw new Error(`No se encontró "${carpeta}" en "/repo".`);
        }
        return contenido;
    });
    const dependencias: DependenciasValidar = { raizRepo: '/repo', listarDocumentos, ajustes, log: (l) => lineas.push(l) };
    return { dependencias, lineas, listarDocumentos };
}

const erroresDe = (errores: string[]) => errores.map((e) => `    - ${e}`);
const erroresFeature = (slug: string, contenido: string) => {
    const r = parsearDocumento(slug, contenido);
    if (r.ok) throw new Error('se esperaba un documento inválido');
    return r.errores;
};
const erroresTarea = (slug: string, contenido: string) => {
    const r = parsearDocumentoTarea(slug, contenido);
    if (r.ok) throw new Error('se esperaba un documento inválido');
    return r.errores;
};

describe('validar — documentos válidos', () => {
    test('solo Features: código 0 y "Errores de formato: 0"', () => {
        const { dependencias, lineas, listarDocumentos } = crear({ 'odd/tasks': [{ slug: 'feature-x', contenido: docBase() }] });

        const resumen = validar(dependencias);

        expect(resumen.codigo).toBe(0);
        expect(lineas).toEqual([ENCABEZADO, 'Errores de formato: 0']);
        expect(listarDocumentos).toHaveBeenCalledWith('odd/tasks');
        expect(listarDocumentos).toHaveBeenCalledWith('odd/tareas', { opcional: true });
    });

    test('Features y Tareas: un bloque "Tareas:" con su propio conteo', () => {
        const { dependencias, lineas } = crear({
            'odd/tasks': [{ slug: 'feature-x', contenido: docBase() }],
            'odd/tareas': [{ slug: 'tarea-x', contenido: docTarea('feature-x') }],
        });

        const resumen = validar(dependencias);

        expect(resumen.codigo).toBe(0);
        expect(lineas).toEqual([ENCABEZADO, 'Errores de formato: 0', '', 'Tareas:', 'Errores de formato: 0']);
    });

    test('feature padre inexistente: aviso (mismo formato que el sync), código 0', () => {
        const { dependencias, lineas } = crear({
            'odd/tasks': [{ slug: 'feature-x', contenido: docBase() }],
            'odd/tareas': [{ slug: 'tarea-x', contenido: docTarea('no-existe') }],
        });

        const resumen = validar(dependencias);

        expect(resumen.codigo).toBe(0);
        expect(lineas).toEqual([
            ENCABEZADO,
            'Errores de formato: 0',
            '',
            'Tareas:',
            'Avisos: 1',
            '  tarea-x:',
            '    - La feature padre "no-existe" no existe: no hay ningún documento "no-existe.md" en "odd/tasks".',
            'Errores de formato: 0',
        ]);
    });

    test('Tareas deshabilitadas: no se lista su carpeta', () => {
        const { dependencias, lineas, listarDocumentos } = crear(
            { 'odd/tareas': [{ slug: 'feature-x', contenido: docBase() }] },
            { carpetaFeatures: 'odd/tareas', carpetaTareas: 'odd/tareas', ramaBaseDocumento: 'main', tareasDeshabilitadas: true },
        );

        const resumen = validar(dependencias);

        expect(resumen.codigo).toBe(0);
        expect(lineas).toEqual([ENCABEZADO, 'Errores de formato: 0']);
        expect(listarDocumentos).toHaveBeenCalledTimes(1);
    });
});

describe('validar — errores', () => {
    test('un documento de Features mal formado: código 1 y sus errores', () => {
        const { dependencias, lineas } = crear({
            'odd/tasks': [
                { slug: 'feature-x', contenido: docBase() },
                { slug: 'rota', contenido: ROTO },
            ],
        });

        const resumen = validar(dependencias);

        expect(resumen.codigo).toBe(1);
        expect(lineas).toEqual([ENCABEZADO, 'Errores de formato: 1', '  rota:', ...erroresDe(erroresFeature('rota', ROTO))]);
        expect(resumen.features.erroresDeFormato.map((e) => e.slug)).toEqual(['rota']);
    });

    test('un documento de Tareas mal formado: código 1 aunque Features esté bien', () => {
        const { dependencias, lineas } = crear({
            'odd/tasks': [{ slug: 'feature-x', contenido: docBase() }],
            'odd/tareas': [{ slug: 'rota', contenido: ROTO }],
        });

        const resumen = validar(dependencias);

        expect(resumen.codigo).toBe(1);
        expect(lineas).toEqual([
            ENCABEZADO,
            'Errores de formato: 0',
            '',
            'Tareas:',
            'Errores de formato: 1',
            '  rota:',
            ...erroresDe(erroresTarea('rota', ROTO)),
        ]);
    });

    test('carpeta de Features faltante: error de entorno y código 1', () => {
        const { dependencias, lineas } = crear({});

        const resumen = validar(dependencias);

        expect(resumen.codigo).toBe(1);
        expect(lineas).toEqual([ENCABEZADO, 'Error de entorno: No se encontró "odd/tasks" en "/repo".']);
    });

    test('carpeta de Tareas ilegible: bloque "Tareas:" con el error de entorno y código 1', () => {
        const { dependencias, lineas } = crear({
            'odd/tasks': [{ slug: 'feature-x', contenido: docBase() }],
            'odd/tareas': new Error('No se encontró "odd/tareas" en "/repo".'),
        });

        const resumen = validar(dependencias);

        expect(resumen.codigo).toBe(1);
        expect(lineas).toEqual([
            ENCABEZADO,
            'Errores de formato: 0',
            '',
            'Tareas:',
            'Error de entorno: No se encontró "odd/tareas" en "/repo".',
        ]);
    });

    test('carpetas mal configuradas: el error de ajustes, código 1 y no se lee nada', () => {
        const { dependencias, lineas, listarDocumentos } = crear(
            { 'odd/tasks': [{ slug: 'feature-x', contenido: docBase() }] },
            { carpetaFeatures: 'odd/tasks', carpetaTareas: 'odd/tasks', ramaBaseDocumento: 'main' },
        );

        const resumen = validar(dependencias);

        expect(resumen.codigo).toBe(1);
        expect(lineas).toEqual([
            ENCABEZADO,
            'TABLERO_CARPETA_TAREAS ("odd/tasks") es la misma carpeta que TABLERO_CARPETA ("odd/tasks"): las Tareas necesitan su propia carpeta.',
        ]);
        expect(listarDocumentos).not.toHaveBeenCalled();
    });
});
