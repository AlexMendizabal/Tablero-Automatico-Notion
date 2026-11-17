/** @jest-environment node */
import { construirFila } from '../../src/core/entities/feature';
import { parsearDocumento } from '../../src/core/parse';
import { calcularHuella } from '../../src/core/plan';
import { derivarEstado } from '../../src/core/status';
import '../helpers/aislar-board-language';

// Regresión de los estados de tarea (odd/tasks/plugin-claude-odd.md, T1).
const doc = (lineas: string[]) =>
    ['---', 'ramas: ["feat/x"]', '---', '', '# Doc', '', '## Tasks', '', ...lineas, ''].join('\n');
const tareas = (lineas: string[]) => {
    const r = parsearDocumento('d', doc(lineas));
    if (!r.ok) throw new Error(r.errores.join());
    return r.documento.tareas;
};

test('la huella de [X]/[ ] con unicode y [?] es la misma que antes de los estados nuevos', () => {
    expect(calcularHuella(tareas(['- [X] **T1 — Ñandú**: déscr — con raya', '- [?] **T9 — raro**', '- [ ] **QA1 — Smoke**.']))).toBe(
        'c77cd08a1d6e6e800c62ca727a9d7413b867fae8d5e0ea73fa3c9b39d55d33e8',
    );
});

test('lista vacía y todo hecho con un PR abierto siguen como antes', () => {
    expect(derivarEstado([], 0)).toBe('Sin empezar');
    expect(derivarEstado(tareas(['- [x] **T1 — A**', '- [-] **T2 — B**']), 1)).toBe('En curso');
});

test('una tarea bloqueada gana aunque haya un PR abierto y otra en curso', () => {
    expect(derivarEstado(tareas(['- [/] **T1 — A**', '- [!] **T2 — B**']), 1)).toBe('Bloqueada');
});

test('el ejemplo de los cinco marcadores da 1/4 y Pendiente T1 en inglés', () => {
    const r = parsearDocumento(
        'd',
        doc([
            '- [ ] **T1 — Pendiente**',
            '- [/] **T2 — En curso**',
            '- [!] **T3 — Bloqueada**: espera API de pagos',
            '- [-] **T4 — Descartada**',
            '- [x] **T5 — Hecha**',
        ]),
    );
    if (!r.ok) throw new Error(r.errores.join());
    const fila = construirFila({
        documento: r.documento,
        todasLasRamas: [],
        todosLosPRs: [],
        fechaDocumento: null,
        hoy: new Date('2026-09-21T00:00:00Z'),
        ownerRepo: 'o/r',
        idioma: 'en',
    });
    expect([fila.estado, fila.progreso, fila.pendiente]).toEqual(['Bloqueada', '1/4 tasks', 'T1 — Pendiente']);
});
