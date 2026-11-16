/**
 * @jest-environment node
 *
 * Estados de tarea (S3-S5): `[ ]` pendiente, `[/]` en curso, `[!]`
 * bloqueada, `[-]` descartada y `[x]`/`[X]` hecha, en el parser, la regla de
 * estado, la fila (progreso y "Pendiente") y la huella.
 *
 * Documentos fixture en el propio test (convención de la casa).
 */
import { createHash } from 'node:crypto';

import { construirFila, construirValoresPropiedades } from '../../src/core/entities/feature';
import { crearDescriptorTarea } from '../../src/core/entities/tarea';
import { parsearDocumento } from '../../src/core/parse';
import { calcularHuella } from '../../src/core/plan';
import { derivarEstado } from '../../src/core/status';
import { type DocumentoODD, type TareaDocumento } from '../../src/core/types';
import { docBase } from '../helpers/fixtures';

import '../helpers/aislar-board-language';

const HOY = new Date('2026-09-21T00:00:00Z');

function seccion(...lineas: string[]): string {
    return ['## Tasks', '', ...lineas].join('\n');
}

function tareasDe(...lineas: string[]): TareaDocumento[] {
    const resultado = parsearDocumento('doc', docBase({ seccionTareas: seccion(...lineas) }));
    if (!resultado.ok) throw new Error(`no parseó: ${resultado.errores.join(' / ')}`);
    return resultado.documento.tareas;
}

function fila(lineas: string[], prsAbiertos = 0, idioma: 'es' | 'en' = 'es') {
    const documento: DocumentoODD = {
        slug: 'doc',
        ramas: ['feat/x'],
        commits: [],
        titulo: 'Doc',
        tareas: tareasDe(...lineas),
    };
    const prs = Array.from({ length: prsAbiertos }, (_, i) => ({
        number: i + 1,
        headRefName: 'feat/x',
        state: 'OPEN' as const,
        createdAt: '2026-09-01T00:00:00Z',
        mergedAt: null,
        closedAt: null,
    }));
    return construirFila({ documento, todasLasRamas: [], todosLosPRs: prs, fechaDocumento: null, hoy: HOY, ownerRepo: 'o/r', idioma });
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

describe('parser — cinco marcadores (S3)', () => {
    test('el ejemplo verbatim de S3 parsea con el estado de cada marcador', () => {
        const tareas = tareasDe(
            '- [ ] **T1 — Pendiente**',
            '- [/] **T2 — En curso**',
            '- [!] **T3 — Bloqueada**: espera API de pagos',
            '- [-] **T4 — Descartada**',
            '- [x] **T5 — Hecha**',
            '- [X] **T6 — Hecha mayúscula**',
        );
        expect(tareas.map((t) => [t.id, t.estado, t.hecha])).toEqual([
            ['T1', 'pendiente', false],
            ['T2', 'en_curso', false],
            ['T3', 'bloqueada', false],
            ['T4', 'descartada', false],
            ['T5', 'hecha', true],
            ['T6', 'hecha', true],
        ]);
        expect(tareas[2].descripcion).toBe('espera API de pagos');
    });

    test.each(['/', '!', '-'])('"[%s]" exige las mismas reglas: ID válido y raya', (marca) => {
        const sinId = parsearDocumento('doc', docBase({ seccionTareas: seccion(`- [${marca}] **sin id**`) }));
        expect(sinId).toEqual({
            ok: false,
            errores: [`Checkbox bajo '## Tasks' sin ID válido: "- [${marca}] **sin id**".`],
        });
        const guion = parsearDocumento('doc', docBase({ seccionTareas: seccion(`- [${marca}] **T1 - Uno**`) }));
        expect(guion).toEqual({
            ok: false,
            errores: [`Checkbox bajo '## Tasks' usa guion común en vez de — (raya): "- [${marca}] **T1 - Uno**".`],
        });
    });

    test('una sección con solo tareas descartadas tiene tareas (no es "ninguna tarea")', () => {
        expect(tareasDe('- [-] **T1 — Uno**', '- [-] **T2 — Dos**').map((t) => t.estado)).toEqual([
            'descartada',
            'descartada',
        ]);
    });

    test('otro contenido entre corchetes ("[?]") se sigue ignorando como hoy', () => {
        const resultado = parsearDocumento('doc', docBase({ seccionTareas: seccion('- [?] **T1 — Uno**') }));
        expect(resultado).toEqual({ ok: false, errores: ["La sección '## Tasks' no tiene ninguna tarea."] });
        expect(tareasDe('- [?] **T9 — Raro**', '- [ ] **T1 — Uno**').map((t) => t.id)).toEqual(['T1']);
    });
});

// ---------------------------------------------------------------------------
// Progreso (S5)
// ---------------------------------------------------------------------------

describe('progreso — descartadas fuera del total (S5)', () => {
    test('hechas / (total − descartadas)', () => {
        expect(
            fila(['- [x] **T1 — A**', '- [-] **T2 — B**', '- [/] **T3 — C**', '- [ ] **T4 — D**']).progreso,
        ).toBe('1/3 tareas');
    });

    test('todas descartadas: 0/0 y Terminada', () => {
        const f = fila(['- [-] **T1 — A**', '- [-] **T2 — B**']);
        expect(f.progreso).toBe('0/0 tareas');
        expect(f.estado).toBe('Terminada');
    });
});

// ---------------------------------------------------------------------------
// Estado (S4, S5)
// ---------------------------------------------------------------------------

describe('derivarEstado — precedencia con los estados nuevos (S4, S5)', () => {
    test('todo hecho o descartado y 0 PRs abiertos: Terminada', () => {
        expect(derivarEstado(tareasDe('- [x] **T1 — A**', '- [-] **T2 — B**'), 0)).toBe('Terminada');
    });

    test('una tarea no descartada bloqueada: Bloqueada', () => {
        expect(derivarEstado(tareasDe('- [x] **T1 — A**', '- [!] **T2 — B**', '- [ ] **T3 — C**'), 0)).toBe(
            'Bloqueada',
        );
    });

    test('Bloqueada gana sobre QA pendiente y Sin empezar', () => {
        expect(derivarEstado(tareasDe('- [x] **T1 — A**', '- [!] **QA1 — B**'), 0)).toBe('Bloqueada');
        expect(derivarEstado(tareasDe('- [!] **T1 — A**', '- [ ] **T2 — B**'), 0)).toBe('Bloqueada');
    });

    test('ninguna hecha pero una en curso: En curso (no Sin empezar)', () => {
        expect(derivarEstado(tareasDe('- [/] **T1 — A**', '- [ ] **T2 — B**'), 0)).toBe('En curso');
    });

    test('descartadas no cuentan para QA pendiente ni Sin empezar', () => {
        expect(derivarEstado(tareasDe('- [x] **T1 — A**', '- [-] **T2 — B**', '- [ ] **QA1 — C**'), 0)).toBe(
            'QA pendiente',
        );
        expect(derivarEstado(tareasDe('- [-] **T1 — A**', '- [ ] **T2 — B**'), 0)).toBe('Sin empezar');
    });

    test('etiqueta visible: "Bloqueada" en español, "Blocked" en inglés', () => {
        const f = fila(['- [!] **T1 — A**']);
        expect(construirValoresPropiedades(f, 'es').estado).toEqual({ select: { name: 'Bloqueada' } });
        expect(construirValoresPropiedades(f, 'en').estado).toEqual({ select: { name: 'Blocked' } });
    });

    test('documentos de Tareas: misma regla y etiqueta', () => {
        const descriptor = crearDescriptorTarea();
        const parseado = descriptor.parsearDocumento(
            'tarea',
            docBase({ seccionTareas: seccion('- [x] **T1 — A**', '- [!] **T2 — B**', '- [-] **T3 — C**') }),
        );
        if (!parseado.ok) throw new Error(parseado.errores.join(' / '));
        const filaTarea = descriptor.construirFila({
            documento: parseado.documento,
            todasLasRamas: [],
            todosLosPRs: [],
            fechaDocumento: null,
            hoy: HOY,
            ownerRepo: 'o/r',
            idioma: 'en',
        });
        expect(filaTarea.estado).toBe('Bloqueada');
        expect(filaTarea.progreso).toBe('1/2 tasks');
        expect(filaTarea.pendiente).toBe('T2 — B');
        expect(descriptor.construirValoresPropiedades(filaTarea, 'en').estado).toEqual({ select: { name: 'Blocked' } });
    });
});

// ---------------------------------------------------------------------------
// Pendiente
// ---------------------------------------------------------------------------

describe('"Pendiente": primera tarea ni hecha ni descartada', () => {
    test('salta descartadas y hechas', () => {
        expect(fila(['- [x] **T1 — A**', '- [-] **T2 — B**', '- [!] **T3 — C**', '- [ ] **T4 — D**']).pendiente).toBe(
            'T3 — C',
        );
    });

    test('solo hechas y descartadas: vacío', () => {
        expect(fila(['- [x] **T1 — A**', '- [-] **T2 — B**']).pendiente).toBe('');
    });
});

// ---------------------------------------------------------------------------
// Huella
// ---------------------------------------------------------------------------

describe('huella con estados', () => {
    const huellaHistorica = (lineas: string[]) =>
        createHash('sha256').update(lineas.join('\n'), 'utf8').digest('hex');

    test('[ ] y [x] conservan la huella byte a byte de antes', () => {
        const tareas = tareasDe('- [x] **T1 — Uno**: hace algo.', '- [ ] **T2 — Dos**');
        expect(calcularHuella(tareas)).toBe(huellaHistorica(['T1|true|Uno|hace algo.', 'T2|false|Dos|']));
    });

    test.each(['/', '!', '-'])('"[%s]" cambia la huella respecto de "[ ]"', (marca) => {
        expect(calcularHuella(tareasDe(`- [${marca}] **T1 — Uno**`))).not.toBe(
            calcularHuella(tareasDe('- [ ] **T1 — Uno**')),
        );
    });

    test('los tres estados nuevos tienen huellas distintas entre sí', () => {
        const huellas = ['/', '!', '-'].map((m) => calcularHuella(tareasDe(`- [${m}] **T1 — Uno**`)));
        expect(new Set(huellas).size).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// Preservación de [ ]/[x]
// ---------------------------------------------------------------------------

describe('[ ]/[x] siguen igual', () => {
    test('parseo, estado, progreso y pendiente de un documento solo con [ ]/[x]', () => {
        const tareas = tareasDe('- [x] **T1 — Uno**: hace algo.', '- [ ] **QA1 — Smoke**');
        expect(tareas.map(({ id, nombre, descripcion, hecha, esQA }) => ({ id, nombre, descripcion, hecha, esQA }))).toEqual([
            { id: 'T1', nombre: 'Uno', descripcion: 'hace algo.', hecha: true, esQA: false },
            { id: 'QA1', nombre: 'Smoke', descripcion: '', hecha: false, esQA: true },
        ]);
        expect(derivarEstado(tareas, 0)).toBe('QA pendiente');
        const f = fila(['- [x] **T1 — Uno**', '- [ ] **T2 — Dos**'], 1);
        expect([f.estado, f.progreso, f.pendiente]).toEqual(['En curso', '1/2 tareas', 'T2 — Dos']);
        expect(fila(['- [x] **T1 — Uno**'], 1).estado).toBe('En curso');
        expect(fila(['- [ ] **T1 — Uno**']).estado).toBe('Sin empezar');
        expect(fila(['- [x] **T1 — Uno**']).estado).toBe('Terminada');
        expect(derivarEstado([], 0)).toBe('Sin empezar');
    });
});
