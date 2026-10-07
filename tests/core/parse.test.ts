/**
 * @jest-environment node
 *
 * Tests del parser del documento ODD (núcleo).
 *
 * Los casos NO leen `odd/tasks/` real: los documentos son strings fixture
 * dentro del propio test (convención de la casa, ver
 * `validar-rutas-docs.test.ts`), así que mover o editar un archivo del repo
 * no puede volver estos tests rojos por accidente.
 */
import { parsearDocumento } from '../../src/core/parse';
import { conBoardLanguage, docBase } from '../helpers/fixtures';

import '../helpers/aislar-board-language';

// ---------------------------------------------------------------------------
// parsearDocumento
// ---------------------------------------------------------------------------

describe('parsearDocumento', () => {
    test('salta un bloque de código que contiene una "## Tareas" de ejemplo con checkboxes falsos', () => {
        const contenido = [
            '---',
            'ramas: ["feat/ejemplo-*"]',
            '---',
            '',
            '# Feature de ejemplo',
            '',
            '## Formato',
            '',
            '```markdown',
            '---',
            'ramas: ["feat/checkout-*"]',
            '---',
            '',
            '# Título legible de la feature',
            '',
            '## Tareas',
            '',
            '- [x] **T1 — Nombre corto**: descripción.',
            '- [ ] **T2 — Nombre corto**: descripción.',
            '- [ ] **QA1 — Smoke test en Android**: descripción.',
            '```',
            '',
            '## Tareas',
            '',
            '- [x] **T1 — Primera**: uno.',
            '- [x] **T2 — Segunda**: dos.',
            '- [ ] **T3 — Tercera**: tres.',
            '- [ ] **QA1 — Cuarta**: cuatro.',
        ].join('\n');

        const resultado = parsearDocumento('ejemplo', contenido);

        expect(resultado.ok).toBe(true);
        if (resultado.ok) {
            expect(resultado.documento.tareas.map((t) => t.id)).toEqual(['T1', 'T2', 'T3', 'QA1']);
        }
    });

    test('una tarea sin ": descripción" (solo "**ID — Nombre**." a secas) es válida (caso real del repo)', () => {
        // Regla normativa del contrato: "un ID en negrita al principio" es lo
        // único obligatorio; ": descripción" es el estilo del ejemplo, no un
        // requisito. odd/tasks/qa-venta-fraccionada.md mezcla ambos estilos en
        // el mismo archivo.
        const contenido = docBase({
            seccionTareas: [
                '## Tareas',
                '',
                '- [x] **T1 — Publicar el plan de QA como artifact**: hecho, 2026-08-25.',
                '- [ ] **QA1 — Ejecutar los pasos de Configuración (a1-a14)**.',
            ].join('\n'),
        });

        const resultado = parsearDocumento('qa-venta-fraccionada', contenido);

        expect(resultado.ok).toBe(true);
        if (resultado.ok) {
            expect(resultado.documento.tareas).toEqual([
                {
                    id: 'T1',
                    nombre: 'Publicar el plan de QA como artifact',
                    descripcion: 'hecho, 2026-08-25.',
                    hecha: true,
                    esQA: false,
                },
                {
                    id: 'QA1',
                    nombre: 'Ejecutar los pasos de Configuración (a1-a14)',
                    descripcion: '',
                    hecha: false,
                    esQA: true,
                },
            ]);
        }
    });

    test('un bloque de 4 backticks con una línea de 3 backticks adentro no se cierra ahí', () => {
        const contenido = [
            '---',
            'ramas: []',
            '---',
            '',
            '# Título',
            '',
            '````',
            '## Tareas',
            '```',
            '- [ ] **FAKE1 — no debería contar**: nada.',
            '````',
            '',
            '## Tareas',
            '',
            '- [ ] **T1 — Real**: desc.',
        ].join('\n');

        const resultado = parsearDocumento('fence', contenido);

        expect(resultado.ok).toBe(true);
        if (resultado.ok) {
            expect(resultado.documento.tareas.map((t) => t.id)).toEqual(['T1']);
        }
    });

    test('parsea un documento válido con ramas, título y tareas QA/no-QA', () => {
        const contenido = docBase({
            seccionTareas: [
                '## Tareas',
                '',
                '- [x] **T1 — Uno**: hace algo.',
                '- [ ] **QA1 — Smoke test**: probar a mano.',
            ].join('\n'),
        });

        const resultado = parsearDocumento('mi-feature', contenido);

        expect(resultado.ok).toBe(true);
        if (resultado.ok) {
            expect(resultado.documento.slug).toBe('mi-feature');
            expect(resultado.documento.ramas).toEqual(['feat/x']);
            expect(resultado.documento.titulo).toBe('Feature X');
            expect(resultado.documento.tareas).toEqual([
                { id: 'T1', nombre: 'Uno', descripcion: 'hace algo.', hecha: true, esQA: false },
                { id: 'QA1', nombre: 'Smoke test', descripcion: 'probar a mano.', hecha: false, esQA: true },
            ]);
        }
    });

    test('"[X]" mayúscula cuenta como hecha, y CRLF + BOM no rompen el parseo', () => {
        const contenidoLF = docBase({
            seccionTareas: ['## Tareas', '', '- [X] **T1 — Uno**: listo.'].join('\n'),
        });
        const contenidoConBomYCrlf = '﻿' + contenidoLF.replace(/\n/g, '\r\n');

        const resultado = parsearDocumento('feature-x', contenidoConBomYCrlf);

        expect(resultado.ok).toBe(true);
        if (resultado.ok) {
            expect(resultado.documento.tareas[0].hecha).toBe(true);
        }
    });

    test('frontmatter faltante (la línea 1 no es "---") se reporta como error', () => {
        const contenido = ['# Sin frontmatter', '', '## Tareas', '', '- [ ] **T1 — Uno**: x.'].join('\n');
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) {
            expect(resultado.errores.some((e) => /frontmatter/i.test(e))).toBe(true);
        }
    });

    test('frontmatter sin línea de cierre "---" se reporta como error', () => {
        const contenido = ['---', 'ramas: ["feat/x"]', '', '# Título', '', '## Tareas', '', '- [ ] **T1 — Uno**: x.'].join(
            '\n',
        );
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.some((e) => /frontmatter/i.test(e))).toBe(true);
    });

    test('"ramas" con comillas simples (JSON inválido) se reporta como error', () => {
        const contenido = docBase({ frontmatter: "---\nramas: ['feat/x']\n---" });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) {
            expect(resultado.errores.some((e) => /ramas/i.test(e) && /json|comillas/i.test(e))).toBe(true);
        }
    });

    test('"ramas" que no es un array se reporta como error', () => {
        const contenido = docBase({ frontmatter: '---\nramas: "feat/x"\n---' });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.some((e) => /ramas/i.test(e) && /array/i.test(e))).toBe(true);
    });

    test('"ramas" con un elemento que no es string se reporta como error', () => {
        const contenido = docBase({ frontmatter: '---\nramas: ["feat/x", 1]\n---' });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.some((e) => /ramas/i.test(e))).toBe(true);
    });

    test('frontmatter sin la clave "ramas" se reporta como error', () => {
        const contenido = docBase({ frontmatter: '---\notracosa: 1\n---' });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.some((e) => /ramas/i.test(e))).toBe(true);
    });

    test('una clave desconocida en el frontmatter (ni "ramas" ni "commits") se reporta como error', () => {
        const contenido = docBase({ frontmatter: '---\nramas: ["feat/x"]\notracosa: 1\n---' });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) {
            expect(resultado.errores.some((e) => /frontmatter/i.test(e) && /clave desconocida/i.test(e))).toBe(
                true,
            );
        }
    });

    test('el frontmatter acepta "ramas" y "commits" juntos, en cualquier orden', () => {
        const contenidoConmitsPrimero = docBase({
            frontmatter:
                '---\ncommits: ["85f7e8e0dbf967bdce4c0948c46a9468ea9bb65a", "6113641f4805af66004bab57a8ab0a464fd2cffc"]\nramas: []\n---',
        });
        const resultado = parsearDocumento('scanner-carrito-continuo', contenidoConmitsPrimero);

        expect(resultado.ok).toBe(true);
        if (resultado.ok) {
            expect(resultado.documento.ramas).toEqual([]);
            expect(resultado.documento.commits).toEqual([
                '85f7e8e0dbf967bdce4c0948c46a9468ea9bb65a',
                '6113641f4805af66004bab57a8ab0a464fd2cffc',
            ]);
        }
    });

    test('sin la clave "commits", el documento queda con "commits: []"', () => {
        const resultado = parsearDocumento('x', docBase());
        expect(resultado.ok).toBe(true);
        if (resultado.ok) expect(resultado.documento.commits).toEqual([]);
    });

    test('"commits" con un hash no hexadecimal se reporta como error', () => {
        const contenido = docBase({ frontmatter: '---\nramas: []\ncommits: ["zzzzzzz"]\n---' });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.some((e) => /commits/i.test(e))).toBe(true);
    });

    test('"commits" con un hash demasiado corto (menos de 7 caracteres) se reporta como error', () => {
        const contenido = docBase({ frontmatter: '---\nramas: []\ncommits: ["ab12"]\n---' });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.some((e) => /commits/i.test(e))).toBe(true);
    });

    test('"commits" con un hash abreviado de 7 caracteres (antes válido) ahora se rechaza (fix 6 del review de T3)', () => {
        // El contrato exige el hash COMPLETO (40 caracteres): uno abreviado
        // puede volverse ambiguo cuando el repo crece.
        const contenido = docBase({ frontmatter: '---\nramas: []\ncommits: ["6113641"]\n---' });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) {
            expect(resultado.errores.some((e) => /commits/i.test(e) && /completo/i.test(e))).toBe(true);
        }
    });

    test('"commits" con un hash demasiado largo (más de 40 caracteres) se reporta como error', () => {
        const contenido = docBase({
            frontmatter: `---\nramas: []\ncommits: ["${'a'.repeat(41)}"]\n---`,
        });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.some((e) => /commits/i.test(e))).toBe(true);
    });

    test('"commits" en mayúsculas (no minúsculas) se reporta como error', () => {
        const contenido = docBase({
            frontmatter: '---\nramas: []\ncommits: ["85F7E8E0DBF967BDCE4C0948C46A9468EA9BB65A"]\n---',
        });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.some((e) => /commits/i.test(e))).toBe(true);
    });

    test('"commits" que no es un array se reporta como error', () => {
        const contenido = docBase({ frontmatter: '---\nramas: []\ncommits: "85f7e8e"\n---' });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.some((e) => /commits/i.test(e))).toBe(true);
    });

    test('sin título (ningún "# " fuera de bloques de código) se reporta como error', () => {
        const contenido = docBase({ titulo: 'Esto no es un título' });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.some((e) => /título/i.test(e))).toBe(true);
    });

    test('sin ninguna sección "## Tareas" se reporta como error', () => {
        const contenido = docBase({ seccionTareas: '## Otra Sección\n\nNada.' });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.some((e) => /tareas/i.test(e))).toBe(true);
    });

    test('con dos secciones "## Tareas" se reporta como error', () => {
        const contenido = docBase({
            seccionTareas: [
                '## Tareas',
                '',
                '- [x] **T1 — Uno**: x.',
                '',
                '## Tareas',
                '',
                '- [ ] **T2 — Dos**: y.',
            ].join('\n'),
        });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.some((e) => /tareas/i.test(e))).toBe(true);
    });

    test('una sección "## Tareas" sin ninguna tarea se reporta como error', () => {
        const contenido = docBase({ seccionTareas: '## Tareas\n\nNada por acá.' });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.some((e) => /tareas/i.test(e))).toBe(true);
    });

    test('un checkbox bajo "## Tareas" sin ID válido se reporta como error', () => {
        const contenido = docBase({
            seccionTareas: ['## Tareas', '', '- [ ] **sin id valido**: x.'].join('\n'),
        });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.some((e) => /ID/.test(e))).toBe(true);
    });

    test('un checkbox con guion común en vez de raya (—) se reporta con mensaje explícito', () => {
        const contenido = docBase({
            seccionTareas: ['## Tareas', '', '- [ ] **T1 - Nombre corto**: x.'].join('\n'),
        });
        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) {
            expect(resultado.errores.some((e) => e.includes('—') && /raya/i.test(e))).toBe(true);
        }
    });

    test('checkboxes fuera de "## Tareas" se ignoran, no cuentan como error ni como tarea', () => {
        const contenido = [
            '---',
            'ramas: []',
            '---',
            '',
            '# Título',
            '',
            '## Problema',
            '',
            '- [ ] esto no es una tarea real',
            '',
            '## Tareas',
            '',
            '- [x] **T1 — Uno**: x.',
        ].join('\n');

        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(true);
        if (resultado.ok) expect(resultado.documento.tareas).toHaveLength(1);
    });

    test('reporta TODOS los errores de formato juntos, no solo el primero', () => {
        const contenido = [
            '# Sin frontmatter',
            '',
            '## Tareas',
            '',
            '- [ ] **T1 - Guion común**: x.',
            '- [ ] checkbox sin negrita',
        ].join('\n');

        const resultado = parsearDocumento('x', contenido);

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.length).toBeGreaterThanOrEqual(2);
    });
});

// ---------------------------------------------------------------------------
// Documentos ODD con palabras clave en inglés (independiente de BOARD_LANGUAGE)
// ---------------------------------------------------------------------------

describe('parsearDocumento — palabras clave en español o inglés', () => {
    const commit = 'a'.repeat(40);
    const tareasEs = ['## Tareas', '', '- [x] **T1 — Uno**: hace algo.', '- [ ] **QA1 — Smoke**: probar.'].join('\n');
    const tareasEn = tareasEs.replace('## Tareas', '## Tasks');

    test('un documento con "branches" y "## Tasks" parsea idéntico a su equivalente en español', () => {
        const espanol = parsearDocumento(
            'f',
            docBase({ frontmatter: `---\nramas: ["feat/x"]\ncommits: ["${commit}"]\n---`, seccionTareas: tareasEs }),
        );
        const ingles = parsearDocumento(
            'f',
            docBase({ frontmatter: `---\nbranches: ["feat/x"]\ncommits: ["${commit}"]\n---`, seccionTareas: tareasEn }),
        );

        expect(espanol.ok).toBe(true);
        expect(ingles).toEqual(espanol);
    });

    test.each([
        ['ramas', '## Tasks'],
        ['branches', '## Tareas'],
    ])('se pueden combinar "%s" con "%s"', (clave, seccion) => {
        const resultado = parsearDocumento(
            'f',
            docBase({ frontmatter: `---\n${clave}: ["feat/x"]\n---`, seccionTareas: tareasEs.replace('## Tareas', seccion) }),
        );
        expect(resultado.ok).toBe(true);
        if (resultado.ok) expect(resultado.documento.ramas).toEqual(['feat/x']);
    });

    test('BOARD_LANGUAGE no cambia el parseo: "branches" se acepta con el tablero en español', async () => {
        const resultado = await conBoardLanguage('es', async () =>
            parsearDocumento('f', docBase({ frontmatter: '---\nbranches: ["feat/x"]\n---', seccionTareas: tareasEn })),
        );
        expect(resultado.ok).toBe(true);
    });

    test('"ramas" y "branches" en el mismo documento es un error de formato de clave duplicada', () => {
        const resultado = parsearDocumento(
            'f',
            docBase({ frontmatter: '---\nramas: ["feat/x"]\nbranches: ["feat/y"]\n---' }),
        );
        expect(resultado.ok).toBe(false);
        if (!resultado.ok) {
            const duplicada = resultado.errores.find((e) => /duplicada/.test(e));
            expect(duplicada).toBeDefined();
            expect(duplicada).toContain('branches');
            expect(duplicada).toContain('ramas');
        }
    });

    test('"branches" repetida es un error de clave duplicada', () => {
        const resultado = parsearDocumento(
            'f',
            docBase({ frontmatter: '---\nbranches: ["feat/x"]\nbranches: ["feat/y"]\n---' }),
        );
        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.errores.some((e) => /"branches".*duplicada/.test(e))).toBe(true);
    });

    test('"## Tareas" y "## Tasks" en el mismo documento: debe haber exactamente una sección de tareas', () => {
        const resultado = parsearDocumento(
            'f',
            docBase({ seccionTareas: [tareasEs, '', '## Tasks', '', '- [ ] **T9 — Otra**: x.'].join('\n') }),
        );
        expect(resultado.ok).toBe(false);
        if (!resultado.ok) {
            const error = resultado.errores.find((e) => /exactamente una/.test(e));
            expect(error).toBeDefined();
            expect(error).toContain('## Tasks');
        }
    });

    test('los mensajes que listan claves y secciones válidas nombran las dos grafías', () => {
        const desconocida = parsearDocumento('f', docBase({ frontmatter: '---\nramas: []\nbranchs: []\n---' }));
        const sinRamas = parsearDocumento('f', docBase({ frontmatter: '---\ncommits: []\n---' }));
        const sinSeccion = parsearDocumento('f', docBase({ seccionTareas: '## Otra cosa' }));

        expect([desconocida.ok, sinRamas.ok, sinSeccion.ok]).toEqual([false, false, false]);
        if (!desconocida.ok) {
            expect(desconocida.errores.join('\n')).toMatch(/'ramas'.*'branches'.*'commits'/);
        }
        if (!sinRamas.ok) {
            expect(sinRamas.errores.join('\n')).toMatch(/'ramas'.*'branches'/);
        }
        if (!sinSeccion.ok) {
            expect(sinSeccion.errores.join('\n')).toMatch(/'## Tareas'.*'## Tasks'/);
        }
    });
});
