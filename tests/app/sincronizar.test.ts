/**
 * @jest-environment node
 *
 * Tests de la orquestación `sincronizar` (app).
 *
 * Los casos NO leen `odd/tasks/` real: los documentos son strings fixture
 * dentro del propio test (convención de la casa, ver
 * `validar-rutas-docs.test.ts`), así que mover o editar un archivo del repo
 * no puede volver estos tests rojos por accidente.
 */
import { type Estado } from '../../src/core/types';
import { type FetchInyectado } from '../../src/ports/notion';
import { type EjecutarComando } from '../../src/ports/sincronizar';
import { sincronizar } from '../../src/app/sincronizar';
import {
    conBoardLanguage,
    conRespuestaPerdidaUnaVez,
    crearEjecutarFalso,
    crearNotionFalsoCompleto,
    docBase,
    ESQUEMA_CORRECTO_NOTION,
    ESQUEMA_CORRECTO_NOTION_EN,
    propiedadesMinimas,
    seccionConNTareas,
} from '../helpers/fixtures';

import '../helpers/aislar-board-language';

// ---------------------------------------------------------------------------
// sincronizar — credenciales
// ---------------------------------------------------------------------------

describe('sincronizar — sin credenciales', () => {
    const listarDocumentos = () => [{ slug: 'feature-x', contenido: docBase() }];
    const ejecutar = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });

    test('sin "--dry-run": código 1 y el fetch falso nunca se llama', async () => {
        const fetchEspiado = jest.fn();
        const resumen = await sincronizar(
            { dryRun: false },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: fetchEspiado as unknown as FetchInyectado,
                listarDocumentos,
                credenciales: null,
                hoy: new Date('2026-09-21T00:00:00Z'),
            },
        );

        expect(resumen.codigo).toBe(1);
        expect(fetchEspiado).not.toHaveBeenCalled();
    });

    test('con "--dry-run": código 0 y cero llamadas al fetch (no consultó Notion)', async () => {
        const fetchEspiado = jest.fn();
        const resumen = await sincronizar(
            { dryRun: true },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: fetchEspiado as unknown as FetchInyectado,
                listarDocumentos,
                credenciales: null,
                hoy: new Date('2026-09-21T00:00:00Z'),
            },
        );

        expect(resumen.codigo).toBe(0);
        expect(resumen.consultoNotion).toBe(false);
        expect(fetchEspiado).not.toHaveBeenCalled();
    });

    test('la salida no informa contadores de escritura que no se pudieron calcular', async () => {
        // Defecto real del "--dry-run" del sync viejo de fichas: informar
        // "Creadas: 0" sin haber consultado Notion es indistinguible de un
        // plan real con cero altas. Sin credenciales, el aviso debe decir
        // explícitamente que el plan no se calculó, y el conteo de errores de
        // formato sigue siendo la única cifra confiable.
        const lineas: string[] = [];
        await sincronizar(
            { dryRun: true },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: jest.fn() as unknown as FetchInyectado,
                listarDocumentos,
                credenciales: null,
                hoy: new Date('2026-09-21T00:00:00Z'),
                log: (linea) => lineas.push(linea),
            },
        );

        const salida = lineas.join('\n');
        expect(salida).not.toContain('Creadas:');
        expect(salida).toMatch(/plan de escritura.*no calculado/i);
    });
});

// ---------------------------------------------------------------------------
// sincronizar — NOTION_TABLERO_DB_ID inválido (T7)
// ---------------------------------------------------------------------------

describe('sincronizar — NOTION_TABLERO_DB_ID inválido (T7)', () => {
    test('con credenciales pero un databaseId que no es un ID de Notion: código 1, cero llamadas al fetch, y la razón en el resumen', async () => {
        const listarDocumentos = () => [{ slug: 'feature-x', contenido: docBase() }];
        const ejecutar = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });
        const fetchEspiado = jest.fn();
        const lineas: string[] = [];

        const resumen = await sincronizar(
            { dryRun: false },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: fetchEspiado as unknown as FetchInyectado,
                listarDocumentos,
                credenciales: { token: 'tok', databaseId: 'esto-no-es-un-id' },
                hoy: new Date('2026-09-21T00:00:00Z'),
                log: (linea) => lineas.push(linea),
            },
        );

        expect(resumen.codigo).toBe(1);
        expect(fetchEspiado).not.toHaveBeenCalled();
        expect(resumen.consultoNotion).toBe(false);
        const salida = lineas.join('\n');
        expect(salida).not.toContain('Creadas:');
        expect(salida).not.toContain('Actualizadas:');
        expect(salida).toMatch(/plan de escritura.*no calculado/i);
        expect(salida).not.toContain('esto-no-es-un-id');
    });

    test('también se valida en "--dry-run" con credenciales', async () => {
        const listarDocumentos = () => [{ slug: 'feature-x', contenido: docBase() }];
        const ejecutar = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });
        const fetchEspiado = jest.fn();

        const resumen = await sincronizar(
            { dryRun: true },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: fetchEspiado as unknown as FetchInyectado,
                listarDocumentos,
                credenciales: { token: 'tok', databaseId: 'https://www.notion.so/miworkspace/una-pagina-cualquiera' },
                hoy: new Date('2026-09-21T00:00:00Z'),
            },
        );

        expect(resumen.codigo).toBe(1);
        expect(fetchEspiado).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// sincronizar — errores de formato mezclados con documentos válidos
// ---------------------------------------------------------------------------

describe('sincronizar — errores de formato mezclados con documentos válidos', () => {
    test('los documentos válidos se sincronizan igual y el proceso termina en código 1', async () => {
        const listarDocumentos = () => [
            { slug: 'valido', contenido: docBase() },
            { slug: 'invalido', contenido: '# Sin frontmatter\n\n## Tareas\n\n- [ ] mal formada' },
        ];
        const ejecutar = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });

        const resumen = await sincronizar(
            { dryRun: true },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: jest.fn() as unknown as FetchInyectado,
                listarDocumentos,
                credenciales: null,
                hoy: new Date('2026-09-21T00:00:00Z'),
            },
        );

        expect(resumen.codigo).toBe(1);
        expect(resumen.erroresDeFormato.map((e) => e.slug)).toEqual(['invalido']);
    });
});

// ---------------------------------------------------------------------------
// sincronizar — commit inexistente en "commits"
// ---------------------------------------------------------------------------

describe('sincronizar — commit inexistente en "commits"', () => {
    const HASH_FANTASMA = `deadbeef${'0'.repeat(32)}`; // 40 caracteres hex

    test('un commit que no existe en el repo es error de formato y el documento se saltea', async () => {
        const listarDocumentos = () => [
            {
                slug: 'con-commit-fantasma',
                contenido: docBase({ frontmatter: `---\nramas: []\ncommits: ["${HASH_FANTASMA}"]\n---` }),
            },
            { slug: 'valido', contenido: docBase() },
        ];
        // "commits: {}" vacío: el hash nunca resuelve → el "ejecutar" falso
        // lanza, tal como lo haría "git show" con un hash inexistente. El
        // repo NO es superficial (ver fix del review de T3): sin esa
        // respuesta, "sincronizar" ya ni llega a intentar resolver el hash.
        const ejecutar = crearEjecutarFalso({
            ramas: '',
            prs: '[]',
            ownerRepo: 'owner/repo',
            commits: {},
            superficial: false,
        });

        const resumen = await sincronizar(
            { dryRun: true },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: jest.fn() as unknown as FetchInyectado,
                listarDocumentos,
                credenciales: null,
                hoy: new Date('2026-09-21T00:00:00Z'),
            },
        );

        expect(resumen.codigo).toBe(1);
        expect(resumen.erroresDeFormato.map((e) => e.slug)).toEqual(['con-commit-fantasma']);
        expect(resumen.erroresDeFormato[0].errores.some((e) => e.includes(HASH_FANTASMA))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// sincronizar — dry-run CON credenciales consulta Notion en modo lectura
// ---------------------------------------------------------------------------

describe('sincronizar — dry-run con credenciales', () => {
    test('cuenta cuántas crearía/actualizaría y lista huérfanas, sin escribir nada', async () => {
        const notionFalso = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
        notionFalso.paginas.set('page-huerfana', {
            id: 'page-huerfana',
            properties: propiedadesMinimas('no-existe-mas', 'hash-x'),
            hijos: [],
        });

        const listarDocumentos = () => [{ slug: 'feature-x', contenido: docBase() }];
        const ejecutar = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });

        const resumen = await sincronizar(
            { dryRun: true },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: notionFalso.fetchFalso,
                listarDocumentos,
                credenciales: { token: 'tok', databaseId: notionFalso.databaseId },
                hoy: new Date('2026-09-21T00:00:00Z'),
            },
        );

        expect(resumen.consultoNotion).toBe(true);
        expect(resumen.creadas).toBe(0);
        expect(resumen.actualizadas).toBe(0);
        expect(resumen.huerfanas).toEqual(['no-existe-mas']);
        expect(notionFalso.llamadas.crearPagina).toBe(0);
        expect(notionFalso.llamadas.actualizarPropiedades).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// sincronizar — esquema inválido (T7)
// ---------------------------------------------------------------------------

describe('sincronizar — esquema inválido (T7)', () => {
    test('lista las columnas que SÍ encontró, en el orden de Notion, y el resumen no informa contadores inventados', async () => {
        // Falta "Huella" y "Progreso" viene con el tipo equivocado: dos
        // problemas de esquema distintos en la misma base falsa.
        const esquemaIncompleto: Record<string, { type: string }> = {
            Nombre: { type: 'title' },
            Estado: { type: 'select' },
            Progreso: { type: 'number' },
        };
        const notionFalso = crearNotionFalsoCompleto(esquemaIncompleto);
        const listarDocumentos = () => [{ slug: 'feature-x', contenido: docBase() }];
        const ejecutar = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });
        const lineas: string[] = [];

        const resumen = await sincronizar(
            { dryRun: false },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: notionFalso.fetchFalso,
                listarDocumentos,
                credenciales: { token: 'tok', databaseId: notionFalso.databaseId },
                hoy: new Date('2026-09-21T00:00:00Z'),
                log: (linea) => lineas.push(linea),
            },
        );

        expect(resumen.codigo).toBe(1);
        expect(notionFalso.llamadas.crearPagina).toBe(0);
        const salida = lineas.join('\n');
        expect(salida).not.toContain('Creadas:');
        expect(salida).not.toContain('Actualizadas:');
        expect(salida).not.toContain('Cuerpos reescritos:');
        expect(salida).toMatch(/plan de escritura.*no calculado.*esquema/i);
        expect(salida).toContain('Columnas encontradas en la base: Nombre (title), Estado (select), Progreso (number)');
    });

    test('sin ninguna columna en la base, informa "(ninguna)"', async () => {
        const notionFalso = crearNotionFalsoCompleto({});
        const listarDocumentos = () => [{ slug: 'feature-x', contenido: docBase() }];
        const ejecutar = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });
        const lineas: string[] = [];

        await sincronizar(
            { dryRun: false },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: notionFalso.fetchFalso,
                listarDocumentos,
                credenciales: { token: 'tok', databaseId: notionFalso.databaseId },
                hoy: new Date('2026-09-21T00:00:00Z'),
                log: (linea) => lineas.push(linea),
            },
        );

        const salida = lineas.join('\n');
        expect(salida).toContain('Columnas encontradas en la base: (ninguna)');
    });
});

// ---------------------------------------------------------------------------
// sincronizar — corrida real de escritura (crear, actualizar, reescribir cuerpo)
// ---------------------------------------------------------------------------

describe('sincronizar — corrida real de escritura contra un Notion falso completo', () => {
    test('1ra corrida crea; 2da (sin cambios) no crea ni reescribe cuerpo; 3ra (con cambio) reescribe', async () => {
        const notionFalso = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
        const ejecutar = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });
        const credenciales = { token: 'tok', databaseId: notionFalso.databaseId };
        const hoy = new Date('2026-09-21T00:00:00Z');

        const contenidoInicial = docBase({
            seccionTareas: ['## Tareas', '', '- [x] **T1 — Uno**: hecha.', '- [ ] **T2 — Dos**: pendiente.'].join(
                '\n',
            ),
        });

        const primera = await sincronizar(
            { dryRun: false },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: notionFalso.fetchFalso,
                listarDocumentos: () => [{ slug: 'feature-x', contenido: contenidoInicial }],
                credenciales,
                hoy,
            },
        );
        expect(primera.creadas).toBe(1);
        expect(notionFalso.llamadas.crearPagina).toBe(1);

        const segunda = await sincronizar(
            { dryRun: false },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: notionFalso.fetchFalso,
                listarDocumentos: () => [{ slug: 'feature-x', contenido: contenidoInicial }],
                credenciales,
                hoy,
            },
        );
        expect(segunda.creadas).toBe(0); // sin duplicados
        expect(segunda.actualizadas).toBe(1); // las propiedades siempre se actualizan
        expect(segunda.cuerposReescritos).toBe(0); // la huella no cambió
        expect(notionFalso.llamadas.borrarBloque).toBe(0);
        expect(notionFalso.llamadas.agregarHijos).toBe(0);

        const contenidoModificado = docBase({
            seccionTareas: ['## Tareas', '', '- [x] **T1 — Uno**: hecha.', '- [x] **T2 — Dos**: ahora hecha.'].join(
                '\n',
            ),
        });

        const tercera = await sincronizar(
            { dryRun: false },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: notionFalso.fetchFalso,
                listarDocumentos: () => [{ slug: 'feature-x', contenido: contenidoModificado }],
                credenciales,
                hoy,
            },
        );
        expect(tercera.creadas).toBe(0);
        expect(tercera.cuerposReescritos).toBe(1); // la huella sí cambió
        expect(notionFalso.llamadas.borrarBloque).toBeGreaterThan(0);
        expect(notionFalso.llamadas.agregarHijos).toBeGreaterThan(0);
    });
});
