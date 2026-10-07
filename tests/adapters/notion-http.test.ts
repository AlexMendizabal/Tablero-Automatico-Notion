/**
 * @jest-environment node
 *
 * Tests del cliente HTTP de Notion (adaptador).
 *
 * Los casos NO leen `odd/tasks/` real: los documentos son strings fixture
 * dentro del propio test (convención de la casa, ver
 * `validar-rutas-docs.test.ts`), así que mover o editar un archivo del repo
 * no puede volver estos tests rojos por accidente.
 */
import { type ClienteNotion, type Dormir, type FetchInyectado } from '../../src/ports/notion';
import { crearClienteNotion } from '../../src/adapters/notion-http';
import {
    crearNotionFalsoCompleto,
    ESQUEMA_CORRECTO_NOTION,
    respuestaFalsa,
    tarea,
} from '../helpers/fixtures';

import '../helpers/aislar-board-language';

// ---------------------------------------------------------------------------
// crearClienteNotion — reescritura de cuerpo (contando llamadas del fake)
// ---------------------------------------------------------------------------

describe('crearClienteNotion — reescritura de cuerpo', () => {
    test('agrega los bloques nuevos ANTES de borrar los viejos, con el agregado en un solo PATCH y un DELETE por bloque viejo (fix T8)', async () => {
        const bloquesExistentes = [
            { id: 'child-1', type: 'to_do', to_do: { rich_text: [], checked: false } },
            { id: 'child-2', type: 'to_do', to_do: { rich_text: [], checked: false } },
        ];
        const llamadas: string[] = [];
        const idsBorrados: string[] = [];
        const fetchFalso: FetchInyectado = async (url, init) => {
            const ruta = url.replace('https://api.notion.com/v1', '');
            llamadas.push(`${init.method} ${ruta}`);
            if (init.method === 'GET' && ruta === '/blocks/page-1/children') {
                return respuestaFalsa(200, { results: bloquesExistentes, has_more: false, next_cursor: null });
            }
            if (init.method === 'PATCH' && ruta === '/blocks/page-1/children') return respuestaFalsa(200, {});
            if (init.method === 'DELETE') {
                idsBorrados.push(ruta.replace('/blocks/', ''));
                return respuestaFalsa(200, {});
            }
            throw new Error(`ruta no simulada en el test: ${init.method} ${ruta}`);
        };
        const dormir: Dormir = async () => {};
        const cliente: ClienteNotion = crearClienteNotion(fetchFalso, 'token-fake', dormir);

        await cliente.reescribirCuerpo('page-1', [tarea({ id: 'T1', hecha: true })]);

        expect(llamadas.filter((l) => l.startsWith('DELETE')).length).toBe(2);
        expect(llamadas.filter((l) => l === 'PATCH /blocks/page-1/children').length).toBe(1);
        // Orden: el ÚLTIMO agregado corre antes que el PRIMER borrado.
        const indiceUltimoAppend = llamadas.lastIndexOf('PATCH /blocks/page-1/children');
        const indicePrimerDelete = llamadas.findIndex((l) => l.startsWith('DELETE'));
        expect(indiceUltimoAppend).toBeGreaterThanOrEqual(0);
        expect(indicePrimerDelete).toBeGreaterThan(indiceUltimoAppend);
        // Solo se borran los ids que ya existían ANTES del agregado.
        expect(idsBorrados.sort()).toEqual(['child-1', 'child-2']);
    });

    test('sin tareas: no agrega nada, y borra igual los bloques viejos', async () => {
        const bloquesExistentes = [{ id: 'child-1', type: 'to_do', to_do: { rich_text: [], checked: false } }];
        const llamadas: string[] = [];
        const fetchFalso: FetchInyectado = async (url, init) => {
            const ruta = url.replace('https://api.notion.com/v1', '');
            llamadas.push(`${init.method} ${ruta}`);
            if (init.method === 'GET' && ruta === '/blocks/page-1/children') {
                return respuestaFalsa(200, { results: bloquesExistentes, has_more: false, next_cursor: null });
            }
            if (init.method === 'DELETE') return respuestaFalsa(200, {});
            throw new Error(`ruta no simulada en el test: ${init.method} ${ruta}`);
        };
        const cliente: ClienteNotion = crearClienteNotion(fetchFalso, 'token-fake', async () => {});

        await cliente.reescribirCuerpo('page-1', []);

        expect(llamadas.some((l) => l.startsWith('PATCH'))).toBe(false);
        expect(llamadas.filter((l) => l.startsWith('DELETE')).length).toBe(1);
    });

    test('si el agregado falla con un 503 en una página CON bloques viejos, no se borra ninguno (R3-001)', async () => {
        const bloquesExistentes = [
            { id: 'child-1', type: 'to_do', to_do: { rich_text: [], checked: false } },
            { id: 'child-2', type: 'to_do', to_do: { rich_text: [], checked: false } },
        ];
        let llamadasDelete = 0;
        const fetchFalso: FetchInyectado = async (url, init) => {
            const ruta = url.replace('https://api.notion.com/v1', '');
            if (init.method === 'GET' && ruta === '/blocks/page-1/children') {
                return respuestaFalsa(200, { results: bloquesExistentes, has_more: false, next_cursor: null });
            }
            if (init.method === 'PATCH' && ruta === '/blocks/page-1/children') {
                return respuestaFalsa(503, { code: 'service_unavailable' });
            }
            if (init.method === 'DELETE') {
                llamadasDelete++;
                return respuestaFalsa(200, {});
            }
            throw new Error(`ruta no simulada en el test: ${init.method} ${ruta}`);
        };
        const cliente = crearClienteNotion(fetchFalso, 'tok', async () => {});

        await expect(cliente.reescribirCuerpo('page-1', [tarea({ id: 'T1' })])).rejects.toThrow(/no idempotente/i);
        expect(llamadasDelete).toBe(0);
    });

    test('si el agregado falla con un error de red en una página CON bloques viejos, no se borra ninguno (R3-001)', async () => {
        const bloquesExistentes = [{ id: 'child-1', type: 'to_do', to_do: { rich_text: [], checked: false } }];
        let llamadasDelete = 0;
        const fetchFalso: FetchInyectado = async (url, init) => {
            const ruta = url.replace('https://api.notion.com/v1', '');
            if (init.method === 'GET' && ruta === '/blocks/page-1/children') {
                return respuestaFalsa(200, { results: bloquesExistentes, has_more: false, next_cursor: null });
            }
            if (init.method === 'PATCH' && ruta === '/blocks/page-1/children') {
                throw new Error('ECONNRESET');
            }
            if (init.method === 'DELETE') {
                llamadasDelete++;
                return respuestaFalsa(200, {});
            }
            throw new Error(`ruta no simulada en el test: ${init.method} ${ruta}`);
        };
        const cliente = crearClienteNotion(fetchFalso, 'tok', async () => {});

        await expect(cliente.reescribirCuerpo('page-1', [tarea({ id: 'T1' })])).rejects.toThrow(/no idempotente/i);
        expect(llamadasDelete).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// crearClienteNotion — reintentos ante 429
// ---------------------------------------------------------------------------

describe('crearClienteNotion — reintentos ante 429', () => {
    test('respeta "Retry-After" (vía "dormir" inyectado) y reintenta hasta lograr éxito', async () => {
        let intentos = 0;
        const dormidas: number[] = [];
        const fetchFalso: FetchInyectado = async () => {
            intentos++;
            if (intentos <= 2) return respuestaFalsa(429, { code: 'rate_limited' }, { 'retry-after': '2' });
            return respuestaFalsa(200, { data_sources: [{ id: 'ds-1' }] });
        };
        const dormir: Dormir = async (ms) => {
            dormidas.push(ms);
        };
        const cliente = crearClienteNotion(fetchFalso, 'token-fake', dormir);

        const id = await cliente.obtenerDataSourceId('db-1');

        expect(id).toBe('ds-1');
        expect(intentos).toBe(3);
        expect(dormidas).toEqual([2000, 2000]);
    });

    test('tras superar el tope de reintentos (3), falla', async () => {
        const fetchFalso: FetchInyectado = async () =>
            respuestaFalsa(429, { code: 'rate_limited' }, { 'retry-after': '1' });
        const dormir: Dormir = async () => {};
        const cliente = crearClienteNotion(fetchFalso, 'token-fake', dormir);

        await expect(cliente.obtenerDataSourceId('db-1')).rejects.toThrow(/429/);
    });

    test('un error HTTP distinto de 429 falla con un mensaje que incluye el status y el cuerpo', async () => {
        const fetchFalso: FetchInyectado = async () =>
            respuestaFalsa(500, { code: 'internal_server_error', message: 'boom' });
        const dormir: Dormir = async () => {};
        const cliente = crearClienteNotion(fetchFalso, 'token-fake', dormir);

        await expect(cliente.obtenerDataSourceId('db-1')).rejects.toThrow(/500/);
    });
});

// ---------------------------------------------------------------------------
// crearClienteNotion — el status HTTP se preserva aunque falle la lectura del
// cuerpo de un error (R2-001 / R3-002 / R4-001)
// ---------------------------------------------------------------------------

describe('crearClienteNotion — status preservado cuando falla la lectura del cuerpo de un error', () => {
    test('escritura NO idempotente con 503 cuyo cuerpo no se puede leer: preserva "503" y "NO idempotente", un solo fetch', async () => {
        let llamadas = 0;
        const fetchFalso: FetchInyectado = async () => {
            llamadas++;
            return {
                status: 503,
                headers: { get: () => null },
                text: () => Promise.reject(new Error('lectura interrumpida')),
            };
        };
        const cliente = crearClienteNotion(fetchFalso, 'tok', async () => {});

        let error: unknown;
        try {
            await cliente.crearPagina('ds-1', { Slug: { rich_text: [] } }, []);
        } catch (e) {
            error = e;
        }
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('503');
        expect((error as Error).message).toMatch(/no idempotente/i);
        expect(llamadas).toBe(1);
    });

    test('429 agotado (3 reintentos) cuyo cuerpo del último intento no se puede leer: preserva "429" y no reintenta de más', async () => {
        let llamadas = 0;
        const dormidas: number[] = [];
        const fetchFalso: FetchInyectado = async () => {
            llamadas++;
            return {
                status: 429,
                headers: { get: (nombre: string) => (nombre.toLowerCase() === 'retry-after' ? '0' : null) },
                text: () => Promise.reject(new Error('lectura interrumpida')),
            };
        };
        const dormir: Dormir = async (ms) => {
            dormidas.push(ms);
        };
        const cliente = crearClienteNotion(fetchFalso, 'tok', dormir);

        let error: unknown;
        try {
            await cliente.obtenerDataSourceId('db-1');
        } catch (e) {
            error = e;
        }
        expect((error as Error).message).toContain('429');
        expect(llamadas).toBe(4); // MAX_REINTENTOS (3) + el intento inicial
        expect(dormidas.length).toBe(3); // MAX_REINTENTOS, sin dormida extra por "manejarFalloDeIntento"
    });

    test('503 persistente (escritura idempotente) cuyo cuerpo del último intento no se puede leer: mensaje "503 tras 3 reintentos"', async () => {
        let llamadas = 0;
        const fetchFalso: FetchInyectado = async () => {
            llamadas++;
            return {
                status: 503,
                headers: { get: () => null },
                text: () => Promise.reject(new Error('lectura interrumpida')),
            };
        };
        const cliente = crearClienteNotion(fetchFalso, 'tok', async () => {});

        await expect(cliente.obtenerDataSourceId('db-1')).rejects.toThrow(/503 tras 3 reintentos/);
        expect(llamadas).toBe(4);
    });

    test('un 400 cuyo cuerpo no se puede leer preserva el status "400"', async () => {
        const fetchFalso: FetchInyectado = async () => ({
            status: 400,
            headers: { get: () => null },
            text: () => Promise.reject(new Error('lectura interrumpida')),
        });
        const cliente = crearClienteNotion(fetchFalso, 'tok', async () => {});

        await expect(cliente.obtenerDataSourceId('db-1')).rejects.toThrow(/400/);
    });
});

// ---------------------------------------------------------------------------
// Fix 3 del review de T3: timeout y reintento de errores transitorios
// ---------------------------------------------------------------------------

describe('crearClienteNotion — timeout y reintento de errores transitorios (fix 3 del review de T3)', () => {
    test('un 503 se reintenta con backoff exponencial y funciona', async () => {
        let intentos = 0;
        const dormidas: number[] = [];
        const fetchFalso: FetchInyectado = async () => {
            intentos++;
            if (intentos === 1) return respuestaFalsa(503, { code: 'internal_error' });
            return respuestaFalsa(200, { data_sources: [{ id: 'ds-1' }] });
        };
        const dormir: Dormir = async (ms) => {
            dormidas.push(ms);
        };
        const cliente = crearClienteNotion(fetchFalso, 'token-fake', dormir);

        const id = await cliente.obtenerDataSourceId('db-1');

        expect(id).toBe('ds-1');
        expect(intentos).toBe(2);
        expect(dormidas).toEqual([1000]);
    });

    test('un fetch rechazado (error de red) se reintenta', async () => {
        let intentos = 0;
        const fetchFalso: FetchInyectado = async () => {
            intentos++;
            if (intentos === 1) throw new Error('ECONNRESET');
            return respuestaFalsa(200, { data_sources: [{ id: 'ds-1' }] });
        };
        const dormidas: number[] = [];
        const dormir: Dormir = async (ms) => {
            dormidas.push(ms);
        };
        const cliente = crearClienteNotion(fetchFalso, 'token-fake', dormir);

        const id = await cliente.obtenerDataSourceId('db-1');

        expect(id).toBe('ds-1');
        expect(intentos).toBe(2);
        expect(dormidas).toEqual([1000]);
    });

    test('un timeout (AbortController dispara la señal) se reintenta', async () => {
        let intentos = 0;
        const fetchFalso: FetchInyectado = (_url, init) => {
            intentos++;
            if (intentos === 1) {
                return new Promise((_resolve, reject) => {
                    init.signal?.addEventListener('abort', () => {
                        reject(new DOMException('The operation was aborted.', 'AbortError'));
                    });
                });
            }
            return respuestaFalsa(200, { data_sources: [{ id: 'ds-1' }] });
        };
        const dormidas: number[] = [];
        const dormir: Dormir = async (ms) => {
            dormidas.push(ms);
        };
        // "timeoutMs" bajo (5ms) para que el test no espere de verdad 30s.
        const cliente = crearClienteNotion(fetchFalso, 'token-fake', dormir, 5);

        const id = await cliente.obtenerDataSourceId('db-1');

        expect(id).toBe('ds-1');
        expect(intentos).toBe(2);
        expect(dormidas).toEqual([1000]);
    });

    test('el timeout también cubre la LECTURA del cuerpo (fix T8): se reintenta si es idempotente', async () => {
        let intentos = 0;
        const fetchFalso: FetchInyectado = (_url, init) => {
            intentos++;
            const intentoActual = intentos;
            return Promise.resolve({
                status: 200,
                headers: { get: () => null },
                text: () =>
                    new Promise<string>((resolve, reject) => {
                        if (intentoActual === 1) {
                            // Los headers llegaron bien, pero la LECTURA del
                            // cuerpo se cuelga hasta que el timeout aborta.
                            init.signal?.addEventListener('abort', () => {
                                reject(new DOMException('The operation was aborted.', 'AbortError'));
                            });
                        } else {
                            resolve(JSON.stringify({ data_sources: [{ id: 'ds-1' }] }));
                        }
                    }),
            });
        };
        const dormidas: number[] = [];
        const dormir: Dormir = async (ms) => {
            dormidas.push(ms);
        };
        const cliente = crearClienteNotion(fetchFalso, 'token-fake', dormir, 5);

        const id = await cliente.obtenerDataSourceId('db-1');

        expect(id).toBe('ds-1');
        expect(intentos).toBe(2);
        expect(dormidas).toEqual([1000]);
    });

    test('un cuerpo que nunca resuelve en una escritura NO idempotente falla sin reintentar', async () => {
        let llamadas = 0;
        const fetchFalso: FetchInyectado = (_url, init) => {
            llamadas++;
            return Promise.resolve({
                status: 200,
                headers: { get: () => null },
                text: () =>
                    new Promise<string>((_resolve, reject) => {
                        init.signal?.addEventListener('abort', () => {
                            reject(new DOMException('The operation was aborted.', 'AbortError'));
                        });
                    }),
            });
        };
        const cliente = crearClienteNotion(fetchFalso, 'tok', async () => {}, 5);

        await expect(cliente.crearPagina('ds-1', { Slug: { rich_text: [] } }, [])).rejects.toThrow(
            /no idempotente/i,
        );
        expect(llamadas).toBe(1);
    });

    test('un 400 (4xx que no es 429) falla sin reintentar', async () => {
        let intentos = 0;
        const fetchFalso: FetchInyectado = async () => {
            intentos++;
            return respuestaFalsa(400, { message: 'solicitud inválida' });
        };
        const cliente = crearClienteNotion(fetchFalso, 'token-fake', async () => {});

        await expect(cliente.obtenerDataSourceId('db-1')).rejects.toThrow(/400/);
        expect(intentos).toBe(1);
    });

    test('tras agotar los reintentos de un 503 persistente, falla con un mensaje que incluye el status y el cuerpo', async () => {
        const fetchFalso: FetchInyectado = async () =>
            respuestaFalsa(503, { code: 'service_unavailable', message: 'boom' });
        const cliente = crearClienteNotion(fetchFalso, 'token-fake', async () => {});

        await expect(cliente.obtenerDataSourceId('db-1')).rejects.toThrow(/503/);
        await expect(cliente.obtenerDataSourceId('db-1')).rejects.toThrow(/boom/);
    });
});

// ---------------------------------------------------------------------------
// T6: el reintento respeta idempotencia (no duplicar altas/appends)
// ---------------------------------------------------------------------------

describe('crearClienteNotion — el reintento respeta idempotencia (T6)', () => {
    test('un POST de alta (crearPagina) con timeout falla SIN reintentar (no idempotente)', async () => {
        let llamadas = 0;
        const fetchFalso: FetchInyectado = (_url, init) => {
            llamadas++;
            return new Promise((_resolve, reject) => {
                init.signal?.addEventListener('abort', () => {
                    reject(new DOMException('The operation was aborted.', 'AbortError'));
                });
            });
        };
        const dormidas: number[] = [];
        const cliente = crearClienteNotion(
            fetchFalso,
            'tok',
            async (ms) => {
                dormidas.push(ms);
            },
            5,
        );

        await expect(cliente.crearPagina('ds-1', { Slug: { rich_text: [] } }, [])).rejects.toThrow(
            /no idempotente/i,
        );
        expect(llamadas).toBe(1);
        expect(dormidas).toEqual([]);
    });

    test('un PATCH de agregar hijos con 503 falla SIN reintentar (no idempotente)', async () => {
        let llamadas = 0;
        const fetchFalso: FetchInyectado = async (url, init) => {
            llamadas++;
            if (init.method === 'POST' && url.endsWith('/pages')) {
                return respuestaFalsa(200, { id: 'page-1' });
            }
            // PATCH /blocks/page-1/children — el lote restante.
            return respuestaFalsa(503, { code: 'service_unavailable' });
        };
        const cliente = crearClienteNotion(fetchFalso, 'tok', async () => {});
        const tareas = Array.from({ length: 150 }, (_, i) => tarea({ id: `T${i + 1}`, nombre: `n${i}` }));

        await expect(
            cliente.crearPagina('ds-1', { Slug: { rich_text: [] } }, tareas),
        ).rejects.toThrow(/no idempotente/i);
        expect(llamadas).toBe(2); // 1 POST de creación + 1 PATCH que falla, sin reintento
    });

    test('un POST de alta con 429 SÍ reintenta (Notion confirma que no aplicó nada) y funciona', async () => {
        let llamadas = 0;
        const fetchFalso: FetchInyectado = async () => {
            llamadas++;
            if (llamadas === 1) return respuestaFalsa(429, { code: 'rate_limited' }, { 'retry-after': '2' });
            return respuestaFalsa(200, { id: 'page-1' });
        };
        const dormidas: number[] = [];
        const cliente = crearClienteNotion(fetchFalso, 'tok', async (ms) => {
            dormidas.push(ms);
        });

        const pageId = await cliente.crearPagina('ds-1', { Slug: { rich_text: [] } }, []);

        expect(pageId).toBe('page-1');
        expect(llamadas).toBe(2);
        expect(dormidas).toEqual([2000]);
    });

    test('un GET con 503 sigue reintentando (regresión del comportamiento de T5)', async () => {
        let llamadas = 0;
        const fetchFalso: FetchInyectado = async () => {
            llamadas++;
            if (llamadas === 1) return respuestaFalsa(503, { code: 'service_unavailable' });
            return respuestaFalsa(200, { data_sources: [{ id: 'ds-1' }] });
        };
        const dormidas: number[] = [];
        const cliente = crearClienteNotion(fetchFalso, 'tok', async (ms) => {
            dormidas.push(ms);
        });

        const id = await cliente.obtenerDataSourceId('db-1');

        expect(id).toBe('ds-1');
        expect(llamadas).toBe(2);
        expect(dormidas).toEqual([1000]);
    });

    test('un PATCH de propiedades de página con timeout sigue reintentando (es idempotente)', async () => {
        let llamadas = 0;
        const fetchFalso: FetchInyectado = (_url, init) => {
            llamadas++;
            if (llamadas === 1) {
                return new Promise((_resolve, reject) => {
                    init.signal?.addEventListener('abort', () => {
                        reject(new DOMException('The operation was aborted.', 'AbortError'));
                    });
                });
            }
            return respuestaFalsa(200, {});
        };
        const dormidas: number[] = [];
        const cliente = crearClienteNotion(
            fetchFalso,
            'tok',
            async (ms) => {
                dormidas.push(ms);
            },
            5,
        );

        await cliente.actualizarPropiedades('page-1', { Slug: { rich_text: [] } });

        expect(llamadas).toBe(2);
        expect(dormidas).toEqual([1000]);
    });

    test('el agregado no idempotente dentro de "reescribirCuerpo" falla SIN reintentar ante un 503', async () => {
        let llamadasPatch = 0;
        const fetchFalso: FetchInyectado = async (url, init) => {
            const ruta = url.replace('https://api.notion.com/v1', '');
            if (init.method === 'GET' && ruta === '/blocks/page-1/children') {
                return respuestaFalsa(200, { results: [], has_more: false, next_cursor: null });
            }
            if (init.method === 'PATCH' && ruta === '/blocks/page-1/children') {
                llamadasPatch++;
                return respuestaFalsa(503, { code: 'service_unavailable' });
            }
            throw new Error(`ruta no simulada en el test: ${init.method} ${ruta}`);
        };
        const cliente = crearClienteNotion(fetchFalso, 'tok', async () => {});

        await expect(cliente.reescribirCuerpo('page-1', [tarea({ id: 'T1' })])).rejects.toThrow(/no idempotente/i);
        expect(llamadasPatch).toBe(1);
    });

    test('el agregado no idempotente dentro de "reescribirCuerpo" falla SIN reintentar ante un error de red', async () => {
        let llamadasPatch = 0;
        const fetchFalso: FetchInyectado = async (url, init) => {
            const ruta = url.replace('https://api.notion.com/v1', '');
            if (init.method === 'GET' && ruta === '/blocks/page-1/children') {
                return respuestaFalsa(200, { results: [], has_more: false, next_cursor: null });
            }
            if (init.method === 'PATCH' && ruta === '/blocks/page-1/children') {
                llamadasPatch++;
                throw new Error('ECONNRESET');
            }
            throw new Error(`ruta no simulada en el test: ${init.method} ${ruta}`);
        };
        const cliente = crearClienteNotion(fetchFalso, 'tok', async () => {});

        await expect(cliente.reescribirCuerpo('page-1', [tarea({ id: 'T1' })])).rejects.toThrow(/no idempotente/i);
        expect(llamadasPatch).toBe(1);
    });

    test('el agregado dentro de "reescribirCuerpo" SÍ reintenta ante un 429 (Notion confirma que no aplicó nada)', async () => {
        let llamadasPatch = 0;
        const dormidas: number[] = [];
        const fetchFalso: FetchInyectado = async (url, init) => {
            const ruta = url.replace('https://api.notion.com/v1', '');
            if (init.method === 'GET' && ruta === '/blocks/page-1/children') {
                return respuestaFalsa(200, { results: [], has_more: false, next_cursor: null });
            }
            if (init.method === 'PATCH' && ruta === '/blocks/page-1/children') {
                llamadasPatch++;
                if (llamadasPatch === 1) {
                    return respuestaFalsa(429, { code: 'rate_limited' }, { 'retry-after': '2' });
                }
                return respuestaFalsa(200, {});
            }
            if (init.method === 'DELETE') return respuestaFalsa(200, {});
            throw new Error(`ruta no simulada en el test: ${init.method} ${ruta}`);
        };
        const cliente = crearClienteNotion(fetchFalso, 'tok', async (ms) => {
            dormidas.push(ms);
        });

        await cliente.reescribirCuerpo('page-1', [tarea({ id: 'T1' })]);

        expect(llamadasPatch).toBe(2);
        expect(dormidas).toEqual([2000]);
    });
});

// ---------------------------------------------------------------------------
// Fix 4 del review de T3: texto de bloque recortado y alta en lotes
// ---------------------------------------------------------------------------

describe('crearClienteNotion.crearPagina — recorte de texto y alta en lotes (fix 4 del review de T3)', () => {
    test('una descripción de 5000 caracteres llega recortada con "…" en el bloque to_do', async () => {
        const notionFalso = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
        const cliente = crearClienteNotion(notionFalso.fetchFalso, 'tok', async () => {});
        const dataSourceId = await cliente.obtenerDataSourceId(notionFalso.databaseId);
        const tareaLarga = tarea({ descripcion: 'x'.repeat(5000) });

        const pageId = await cliente.crearPagina(dataSourceId, { Slug: { rich_text: [] } }, [tareaLarga]);

        const pagina = notionFalso.paginas.get(pageId)!;
        const bloque = pagina.hijos[0].bloque as { to_do: { rich_text: Array<{ text: { content: string } }> } };
        const contenido = bloque.to_do.rich_text[0].text.content;
        expect(contenido.length).toBeLessThanOrEqual(1900);
        expect(contenido.endsWith('…')).toBe(true);
    });

    test('un documento con más tareas que el tamaño del lote genera un POST de alta y los appends necesarios', async () => {
        const notionFalso = crearNotionFalsoCompleto(ESQUEMA_CORRECTO_NOTION);
        const cliente = crearClienteNotion(notionFalso.fetchFalso, 'tok', async () => {});
        const dataSourceId = await cliente.obtenerDataSourceId(notionFalso.databaseId);
        const tareas = Array.from({ length: 250 }, (_, i) => tarea({ id: `T${i + 1}`, nombre: `n${i}` }));

        const pageId = await cliente.crearPagina(dataSourceId, { Slug: { rich_text: [] } }, tareas);

        expect(notionFalso.llamadas.crearPagina).toBe(1);
        expect(notionFalso.llamadas.agregarHijos).toBe(2); // 150 restantes → lotes de 100 + 50
        expect(notionFalso.paginas.get(pageId)!.hijos).toHaveLength(250);
    });
});
