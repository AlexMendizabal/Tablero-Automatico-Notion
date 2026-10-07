/**
 * @jest-environment node
 *
 * Tests de lectura de documentos ODD (adaptador).
 *
 * Los casos NO leen `odd/tasks/` real: los documentos son strings fixture
 * dentro del propio test (convención de la casa, ver
 * `validar-rutas-docs.test.ts`), así que mover o editar un archivo del repo
 * no puede volver estos tests rojos por accidente.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { listarDocumentosODD } from '../../src/adapters/fs-node';

import '../helpers/aislar-board-language';

// ---------------------------------------------------------------------------
// Fix 5 del review de T3: carpeta "odd/tasks" faltante o vacía es error
// ---------------------------------------------------------------------------

describe('listarDocumentosODD — carpeta faltante o vacía (fix 5 del review de T3)', () => {
    const raicesCreadas: string[] = [];
    afterAll(() => {
        for (const raiz of raicesCreadas) fs.rmSync(raiz, { recursive: true, force: true });
    });

    test('carpeta "odd/tasks" inexistente lanza un error explícito', () => {
        const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-tablero-sin-carpeta-'));
        raicesCreadas.push(raiz);

        expect(() => listarDocumentosODD(raiz, 'odd/tasks')).toThrow(/no se encontró "odd\/tasks"/i);
    });

    test('carpeta "odd/tasks" existente pero sin ningún ".md" lanza un error explícito', () => {
        const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-tablero-vacia-'));
        raicesCreadas.push(raiz);
        fs.mkdirSync(path.join(raiz, 'odd', 'tasks'), { recursive: true });

        expect(() => listarDocumentosODD(raiz, 'odd/tasks')).toThrow(/ningún documento/i);
    });
});
