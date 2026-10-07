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
import { type FetchInyectado } from '../../src/ports/notion';
import { type EjecutarComando } from '../../src/ports/sincronizar';
import { sincronizar, sincronizarEntidad } from '../helpers/sincronizar-compuesto';
import * as app from '../../src/app/sincronizar';
import { type RepositorioGit } from '../../src/ports/sincronizar';
import { crearDescriptorFeature } from '../../src/core/entities/feature';
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

// ---------------------------------------------------------------------------
// Fix 1 del review de T3: "Huella" se escribe al final, solo con el cuerpo
// completo (determinístico)
// ---------------------------------------------------------------------------

describe('sincronizar — "Huella" se escribe al final (fix 1 del review de T3)', () => {
    test('si la reescritura del cuerpo falla a mitad de camino, la Huella en Notion NO cambia, y la corrida siguiente la repara', async () => {
        const notionFalso = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
        const ejecutar = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });
        const credenciales = { token: 'tok', databaseId: notionFalso.databaseId };
        const hoy = new Date('2026-09-21T00:00:00Z');

        const contenidoInicial = docBase({
            seccionTareas: ['## Tareas', '', '- [x] **T1 — Uno**: hecha.'].join('\n'),
        });
        await sincronizar(
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
        const huellaOriginal = [...notionFalso.paginas.values()][0].properties.Huella;

        // Documento modificado (huella distinta) + falla forzada justo al
        // borrar el primer bloque del cuerpo viejo.
        const contenidoModificado = docBase({
            seccionTareas: ['## Tareas', '', '- [x] **T1 — Uno**: hecha DISTINTO ahora.'].join('\n'),
        });
        notionFalso.forzarFalloEn('borrarBloque', 1);
        await expect(
            sincronizar(
                { dryRun: false },
                {
                    raizRepo: '/repo',
                    ejecutar,
                    fetchInyectado: notionFalso.fetchFalso,
                    listarDocumentos: () => [{ slug: 'feature-x', contenido: contenidoModificado }],
                    credenciales,
                    hoy,
                },
            ),
        ).rejects.toThrow(/400/);

        // La Huella en Notion sigue siendo la de ANTES: no quedó corrompida
        // con la huella nueva mientras el cuerpo quedó a medio borrar.
        const paginaTrasFalla = [...notionFalso.paginas.values()][0];
        expect(paginaTrasFalla.properties.Huella).toEqual(huellaOriginal);

        // Corrida siguiente, sin forzar más fallas: como la huella calculada
        // sigue sin coincidir con la guardada, se detecta y se repara sola.
        const reparacion = await sincronizar(
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
        expect(reparacion.cuerposReescritos).toBe(1);
        expect(reparacion.creadas).toBe(0);
    });

    test('una alta que falla al agregar el segundo lote de bloques nunca llega a escribir la Huella', async () => {
        const notionFalso = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
        const ejecutar = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });
        const credenciales = { token: 'tok', databaseId: notionFalso.databaseId };

        const contenido = docBase({ seccionTareas: seccionConNTareas(150) }); // > TAMANO_LOTE_BLOQUES (100)
        notionFalso.forzarFalloEn('agregarHijos', 1);

        await expect(
            sincronizar(
                { dryRun: false },
                {
                    raizRepo: '/repo',
                    ejecutar,
                    fetchInyectado: notionFalso.fetchFalso,
                    listarDocumentos: () => [{ slug: 'feature-grande', contenido }],
                    credenciales,
                    hoy: new Date('2026-09-21T00:00:00Z'),
                },
            ),
        ).rejects.toThrow(/400/);

        expect(notionFalso.llamadas.crearPagina).toBe(1); // la página SÍ se creó
        const pagina = [...notionFalso.paginas.values()][0];
        expect(pagina.properties.Huella).toBeUndefined(); // pero la Huella NUNCA se escribió
    });
});

// ---------------------------------------------------------------------------
// Fix 2 del review de T3: "--dry-run" CON credenciales muestra el plan, no
// contadores en cero (determinístico)
// ---------------------------------------------------------------------------

describe('sincronizar — "--dry-run" con credenciales muestra el plan (fix 2 del review de T3)', () => {
    test('la salida no contiene "Creadas:", muestra los 4 números del plan, y las huérfanas una sola vez', async () => {
        const notionFalso = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
        notionFalso.paginas.set('page-huerfana', {
            id: 'page-huerfana',
            properties: propiedadesMinimas('no-existe-mas', 'hash-x'),
            hijos: [],
        });
        const listarDocumentos = () => [{ slug: 'feature-x', contenido: docBase() }];
        const ejecutar = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });
        const lineas: string[] = [];

        const resumen = await sincronizar(
            { dryRun: true },
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
        expect(salida).not.toContain('Creadas:');
        // "huerfanas" NO va en "plan" (fix T9: era un dato duplicado que
        // "imprimirResumenFinal" nunca leía de ahí; lee "resumen.huerfanas").
        expect(resumen.plan).toEqual({
            crearia: 1,
            actualizaria: 0,
            cuerposAReescribir: 0,
        });
        expect(salida).toContain('Crearía: 1');
        expect(salida).toContain('Actualizaría: 0');
        expect(salida).toContain('Cuerpos a reescribir: 0');
        // Las huérfanas aparecen UNA sola vez en toda la salida.
        expect((salida.match(/no-existe-mas/g) ?? []).length).toBe(1);
    });
});

describe('sincronizar — recuperación end-to-end cuando una escritura no idempotente falla (T6)', () => {
    test('caso "no aplicada": timeout en el alta (corrida 1) → nada se creó; la corrida 2 crea completo, sin duplicados', async () => {
        const notionFalso = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
        const fetchConPerdida = conRespuestaPerdidaUnaVez(
            notionFalso.fetchFalso,
            (url, init) => init.method === 'POST' && url.endsWith('/pages'),
            'no-aplicada',
        );
        const ejecutar = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });
        const credenciales = { token: 'tok', databaseId: notionFalso.databaseId };
        const contenido = docBase({
            seccionTareas: ['## Tareas', '', '- [x] **T1 — Uno**: hecha.'].join('\n'),
        });
        const hoy = new Date('2026-09-21T00:00:00Z');
        const listarDocumentos = () => [{ slug: 'feature-x', contenido }];

        await expect(
            sincronizar(
                { dryRun: false },
                { raizRepo: '/repo', ejecutar, fetchInyectado: fetchConPerdida, listarDocumentos, credenciales, hoy },
            ),
        ).rejects.toThrow(/no idempotente/i);
        expect(notionFalso.paginas.size).toBe(0); // no se aplicó nada

        const segunda = await sincronizar(
            { dryRun: false },
            { raizRepo: '/repo', ejecutar, fetchInyectado: notionFalso.fetchFalso, listarDocumentos, credenciales, hoy },
        );

        expect(segunda.creadas).toBe(1);
        expect(notionFalso.paginas.size).toBe(1);
        const pagina = [...notionFalso.paginas.values()][0];
        expect(pagina.hijos).toHaveLength(1);
        expect(pagina.properties.Huella).toBeDefined();
    });

    test('caso "aplicada": Notion creó la página pero la respuesta se perdió → la corrida 2 la completa sin duplicarla', async () => {
        const notionFalso = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
        const fetchConPerdida = conRespuestaPerdidaUnaVez(
            notionFalso.fetchFalso,
            (url, init) => init.method === 'POST' && url.endsWith('/pages'),
            'aplicada',
        );
        const ejecutar = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });
        const credenciales = { token: 'tok', databaseId: notionFalso.databaseId };
        const contenido = docBase({
            seccionTareas: ['## Tareas', '', '- [x] **T1 — Uno**: hecha.'].join('\n'),
        });
        const hoy = new Date('2026-09-21T00:00:00Z');
        const listarDocumentos = () => [{ slug: 'feature-x', contenido }];

        await expect(
            sincronizar(
                { dryRun: false },
                { raizRepo: '/repo', ejecutar, fetchInyectado: fetchConPerdida, listarDocumentos, credenciales, hoy },
            ),
        ).rejects.toThrow(/no idempotente/i);
        // La página SÍ quedó creada en Notion, pero sin Huella (se corta antes
        // de esa última escritura — ver "Huella al final", arreglo 1 de T5).
        expect(notionFalso.paginas.size).toBe(1);
        expect([...notionFalso.paginas.values()][0].properties.Huella).toBeUndefined();

        const segunda = await sincronizar(
            { dryRun: false },
            { raizRepo: '/repo', ejecutar, fetchInyectado: notionFalso.fetchFalso, listarDocumentos, credenciales, hoy },
        );

        // La corrida 2 ve la página existente (por Slug) con huella "" ≠ la
        // calculada: la trata como actualización con reescritura de cuerpo,
        // no como una alta nueva — sin duplicados.
        expect(segunda.creadas).toBe(0);
        expect(segunda.cuerposReescritos).toBe(1);
        expect(notionFalso.paginas.size).toBe(1);
        const paginaFinal = [...notionFalso.paginas.values()][0];
        expect(paginaFinal.hijos).toHaveLength(1);
        expect(paginaFinal.properties.Huella).toBeDefined();
    });
});

describe('sincronizar — "listarDocumentos" que lanza es error de entorno (fix 5 del review de T3)', () => {
    test('código 1 y CERO llamadas al fetch, ANTES de cualquier llamada a Notion (aunque haya credenciales)', async () => {
        const fetchEspiado = jest.fn();
        const listarDocumentos = (): Array<{ slug: string; contenido: string }> => {
            throw new Error('No se encontró "odd/tasks" en "/otro/lugar".');
        };

        const resumen = await sincronizar(
            { dryRun: true },
            {
                raizRepo: '/otro/lugar',
                ejecutar: crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' }),
                fetchInyectado: fetchEspiado as unknown as FetchInyectado,
                listarDocumentos,
                credenciales: { token: 'tok', databaseId: 'db-1' },
                hoy: new Date('2026-09-21T00:00:00Z'),
            },
        );

        expect(resumen.codigo).toBe(1);
        expect(fetchEspiado).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Fix 7 del review de T3: falla de git ≠ error de formato
// ---------------------------------------------------------------------------

describe('sincronizar — falla de git ≠ error de formato (fix 7 del review de T3)', () => {
    const HASH = `a${'0'.repeat(39)}`; // 40 caracteres hex, formato válido

    test('repositorio superficial con documentos que declaran "commits" es error de ENTORNO, no de formato', async () => {
        const listarDocumentos = () => [
            {
                slug: 'con-commits',
                contenido: docBase({ frontmatter: `---\nramas: []\ncommits: ["${HASH}"]\n---` }),
            },
        ];
        const ejecutar = crearEjecutarFalso({
            ramas: '',
            prs: '[]',
            ownerRepo: 'owner/repo',
            superficial: true,
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
        expect(resumen.erroresDeFormato).toEqual([]); // NO es un error de formato del documento
    });

    test('si "git" no puede correr (ENOENT o similar), es error de entorno, no de formato', async () => {
        const listarDocumentos = () => [
            {
                slug: 'con-commits',
                contenido: docBase({ frontmatter: `---\nramas: []\ncommits: ["${HASH}"]\n---` }),
            },
        ];
        const ejecutar = crearEjecutarFalso({
            ramas: '',
            prs: '[]',
            ownerRepo: 'owner/repo',
            gitNoDisponible: true,
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
        expect(resumen.erroresDeFormato).toEqual([]);
    });

    test('en un repo COMPLETO con git funcionando, un commit inexistente sigue siendo error de FORMATO', async () => {
        const listarDocumentos = () => [
            {
                slug: 'con-commits',
                contenido: docBase({ frontmatter: `---\nramas: []\ncommits: ["${HASH}"]\n---` }),
            },
        ];
        const ejecutar = crearEjecutarFalso({
            ramas: '',
            prs: '[]',
            ownerRepo: 'owner/repo',
            superficial: false,
            commits: {},
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
        expect(resumen.erroresDeFormato).toHaveLength(1);
        expect(resumen.erroresDeFormato[0].slug).toBe('con-commits');
    });
});

describe('sincronizar — slugs duplicados en Notion se informan (fix 8 del review de T3)', () => {
    test('dos páginas con el mismo Slug: se actualiza la más antigua, la otra aparece como duplicada, código 1, nada se borra', async () => {
        const notionFalso = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
        notionFalso.paginas.set('page-1', {
            id: 'page-1',
            properties: propiedadesMinimas('feature-x', 'h-vieja'),
            hijos: [],
            createdTime: '2026-01-01T00:00:00Z',
        });
        notionFalso.paginas.set('page-2', {
            id: 'page-2',
            properties: propiedadesMinimas('feature-x', 'h-vieja'),
            hijos: [],
            createdTime: '2026-06-01T00:00:00Z',
        });

        const listarDocumentos = () => [{ slug: 'feature-x', contenido: docBase() }];
        const ejecutar = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });

        const resumen = await sincronizar(
            { dryRun: false },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: notionFalso.fetchFalso,
                listarDocumentos,
                credenciales: { token: 'tok', databaseId: notionFalso.databaseId },
                hoy: new Date('2026-09-21T00:00:00Z'),
            },
        );

        expect(resumen.codigo).toBe(1);
        expect(resumen.duplicadas).toEqual([{ slug: 'feature-x', pageIds: ['page-2'] }]);
        // Ambas páginas siguen existiendo en el fake: nada se borró.
        expect(notionFalso.paginas.has('page-1')).toBe(true);
        expect(notionFalso.paginas.has('page-2')).toBe(true);
        // Se actualizó la más antigua (page-1): sus propiedades cambiaron.
        expect(notionFalso.paginas.get('page-1')!.properties.Huella).not.toEqual(
            propiedadesMinimas('feature-x', 'h-vieja').Huella,
        );
    });
});

describe('sincronizar — idioma del tablero', () => {
    const ejecutar = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });
    const hoy = new Date('2026-09-21T00:00:00Z');

    function correr(
        notionFalso: ReturnType<typeof crearNotionFalsoCompleto>,
        extra: { log?: (linea: string) => void; idioma?: 'es' | 'en' } = {},
    ) {
        return sincronizar(
            { dryRun: false },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: notionFalso.fetchFalso,
                listarDocumentos: () => [{ slug: 'feature-x', contenido: docBase() }],
                credenciales: { token: 'tok', databaseId: notionFalso.databaseId },
                hoy,
                ...extra,
            },
        );
    }

    test('BOARD_LANGUAGE=en: valida el esquema en inglés, escribe propiedades y estado en inglés y relee Slug/Fingerprint', async () => {
        const notionFalso = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION_EN);

        const primera = await conBoardLanguage('en', () => correr(notionFalso));
        expect(primera.codigo).toBe(0);
        expect(primera.creadas).toBe(1);

        const pagina = [...notionFalso.paginas.values()][0];
        expect(Object.keys(pagina.properties).sort()).toEqual(Object.keys(ESQUEMA_CORRECTO_NOTION_EN).sort());
        expect(pagina.properties.Status).toEqual({ select: { name: 'Done' } });
        expect(pagina.properties.Progress).toEqual({ rich_text: [{ type: 'text', text: { content: '1/1 tasks' } }] });
        expect(pagina.properties.Estado).toBeUndefined();

        // La 2da corrida encuentra la página por "Slug" y compara "Fingerprint":
        // nada que crear ni cuerpo que reescribir.
        const segunda = await conBoardLanguage('en', () => correr(notionFalso));
        expect(segunda.creadas).toBe(0);
        expect(segunda.actualizadas).toBe(1);
        expect(segunda.cuerposReescritos).toBe(0);
    });

    test('BOARD_LANGUAGE=en contra una base con columnas en español: esquema inválido, código 1, nada escrito', async () => {
        const notionFalso = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
        const lineas: string[] = [];
        const resumen = await conBoardLanguage('en', () => correr(notionFalso, { log: (l) => lineas.push(l) }));
        expect(resumen.codigo).toBe(1);
        expect(notionFalso.llamadas.crearPagina).toBe(0);
        expect(lineas.join('\n')).toContain('Falta la propiedad "Status"');
    });

    test.each([undefined, ''])('BOARD_LANGUAGE=%p: escribe con los nombres y estados en español', async (valor) => {
        const notionFalso = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
        const resumen = await conBoardLanguage(valor, () => correr(notionFalso));
        expect(resumen.codigo).toBe(0);
        const pagina = [...notionFalso.paginas.values()][0];
        expect(pagina.properties.Estado).toEqual({ select: { name: 'Terminada' } });
        expect(pagina.properties.Progreso).toEqual({ rich_text: [{ type: 'text', text: { content: '1/1 tareas' } }] });
    });

    test('BOARD_LANGUAGE inválido: código 1, mensaje claro y ninguna llamada de red ni a git', async () => {
        const fetchEspiado = jest.fn();
        const ejecutarEspiado = jest.fn();
        const lineas: string[] = [];
        const resumen = await conBoardLanguage('xx', () =>
            sincronizar(
                { dryRun: true },
                {
                    raizRepo: '/repo',
                    ejecutar: ejecutarEspiado as unknown as EjecutarComando,
                    fetchInyectado: fetchEspiado as unknown as FetchInyectado,
                    listarDocumentos: () => [{ slug: 'feature-x', contenido: docBase() }],
                    credenciales: null,
                    hoy,
                    log: (linea) => lineas.push(linea),
                },
            ),
        );
        expect(resumen.codigo).toBe(1);
        expect(fetchEspiado).not.toHaveBeenCalled();
        expect(ejecutarEspiado).not.toHaveBeenCalled();
        const salida = lineas.join('\n');
        expect(salida).toContain('BOARD_LANGUAGE');
        expect(salida).toContain('"xx"');
        expect(salida).toMatch(/plan de escritura.*no calculado.*idioma/i);
    });

    test('el idioma inyectado en las dependencias tiene prioridad sobre BOARD_LANGUAGE', async () => {
        const notionFalso = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION_EN);
        const resumen = await conBoardLanguage('xx', () => correr(notionFalso, { idioma: 'en' }));
        expect(resumen.codigo).toBe(0);
        expect([...notionFalso.paginas.values()][0].properties.Status).toEqual({ select: { name: 'Done' } });
    });
});

// ---------------------------------------------------------------------------
// sincronizarEntidad — el pipeline lo guía el descriptor
// ---------------------------------------------------------------------------

describe('sincronizarEntidad', () => {
    test('usa la carpeta del descriptor para fechar el documento e informa la entidad en el resumen', async () => {
        const rutasConsultadas: string[] = [];
        const base = crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' });
        const ejecutar: EjecutarComando = (comando, args) => {
            if (comando === 'git' && args[0] === 'log') rutasConsultadas.push(args[args.length - 1]);
            return base(comando, args);
        };
        const lineas: string[] = [];

        const resumen = await sincronizarEntidad(
            crearDescriptorFeature({ carpetaFeatures: 'docs/features', ramaBaseDocumento: 'main' }),
            { dryRun: true },
            {
                raizRepo: '/repo',
                ejecutar,
                fetchInyectado: jest.fn() as unknown as FetchInyectado,
                listarDocumentos: () => [{ slug: 'feature-x', contenido: docBase() }],
                credenciales: null,
                hoy: new Date('2026-09-21T00:00:00Z'),
                log: (linea) => lineas.push(linea),
            },
        );

        expect(resumen.entidad).toBe('feature');
        expect(resumen.codigo).toBe(0);
        expect(rutasConsultadas).toEqual(['docs/features/feature-x.md']);
        expect(lineas.join('\n')).not.toMatch(/entidad|feature:/i);
    });

    test('"sincronizar" es el pipeline de Features', async () => {
        const resumen = await sincronizar(
            { dryRun: true },
            {
                raizRepo: '/repo',
                ejecutar: crearEjecutarFalso({ ramas: '', prs: '[]', ownerRepo: 'owner/repo' }),
                fetchInyectado: jest.fn() as unknown as FetchInyectado,
                listarDocumentos: () => [{ slug: 'feature-x', contenido: docBase() }],
                credenciales: null,
                hoy: new Date('2026-09-21T00:00:00Z'),
            },
        );
        expect(resumen.entidad).toBe('feature');
    });
});

// ---------------------------------------------------------------------------
// La app solo habla con puertos
// ---------------------------------------------------------------------------

describe('sincronizar — puertos sin adaptadores', () => {
    test('con puertos falsos (sin git, gh, .env ni Notion reales) arma y muestra las filas en "--dry-run"', async () => {
        const repositorio: RepositorioGit = {
            esRepoSuperficial: () => false,
            fechaCommit: () => null,
            fechaDocumento: (ruta) => (ruta === 'odd/tasks/feature-x.md' ? '2026-09-01T00:00:00Z' : null),
            ramasConFecha: () => [],
            prs: () => [],
            ownerRepo: () => 'owner/repo',
        };
        const crearClienteNotion = jest.fn();
        const cargarCredenciales = jest.fn(() => null);
        const lineas: string[] = [];

        const resumen = await app.sincronizar(
            { dryRun: true },
            {
                raizRepo: '/repo',
                listarDocumentos: () => [{ slug: 'feature-x', contenido: docBase() }],
                repositorio,
                configuracion: { cargarCredenciales, leerBoardLanguage: () => undefined },
                crearClienteNotion,
                ajustes: { carpetaFeatures: 'odd/tasks', ramaBaseDocumento: 'main' },
                hoy: new Date('2026-09-21T00:00:00Z'),
                log: (linea) => lineas.push(linea),
            },
        );

        expect(resumen.codigo).toBe(0);
        expect(cargarCredenciales).toHaveBeenCalledWith('/repo');
        expect(crearClienteNotion).not.toHaveBeenCalled();
        expect(lineas.some((linea) => linea.startsWith('feature-x ') && linea.includes('| 20d    |'))).toBe(true);
    });
});
