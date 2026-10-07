---
ramas: ["refactor/modular-core", "feat/task-entity*", "feat/contribuyentes*", "release/v2*"]
---

# Tareas avanzadas y núcleo modular

## Tareas

- [x] **T1 — Separación en módulos sin cambio de comportamiento (PR 1a)**: mover el archivo único a core/ports/adapters/app/entrypoints, dividir los tests por capa y mantener idéntica la salida de sync:dry.
- [ ] **T2 — Descriptor de entidades (PR 1b)**: llevar esquema, textos, regla de estado y armado de fila a core/entities/feature.ts y orquestar con sincronizarEntidad sin renombrar columnas de Features.
- [ ] **T3 — Entidad Tarea desde el repo (PR 2)**: documentos en odd/tareas/*.md con feature padre opcional y NOTION_TAREAS_DB_ID opcional que saltea la entidad si falta.
- [ ] **T4 — Esquema de Notion para Tareas (PR 3)**: base de Tareas con relación a Feature, Responsable (people) propiedad de Notion que nunca se escribe y Contribuyentes (multi-select).
- [ ] **T5 — Contribuyentes desde git y PRs (PR 4)**: autores de ramas, commits ancla del frontmatter, trailers Co-authored-by y autores de PR normalizados con .mailmap.
- [ ] **T6 — Distribución pública (PR 5)**: action.yml, publicación npm, skill de documentos ODD, README es/en y versión v2.0.0.
- [ ] **QA1 — Sincronización real contra un tablero de prueba**: correr el sync con Features y Tareas sobre bases de Notion de prueba y verificar relación, Responsable intacto y Contribuyentes.

## Objetivo

Además de Features, sincronizar tareas avanzadas que nacen en el repo, con su avance, responsable asignado en Notion y contribuyentes derivados de git, dejando el núcleo listo para distribución pública (CLI, GitHub Action y, a futuro, MCP).

## Decisiones

- La tarea nace en el repo; Notion solo aporta el Responsable, que la sincronización nunca sobrescribe.
- Contribuyentes como multi-select (login de GitHub o nombre normalizado); people queda para el futuro.
- Squash merge cubierto con commits ancla en el frontmatter; identidades unificadas con .mailmap.
- Arquitectura hexagonal: core puro, ports, adapters, app y entrypoints.

## Entrega

- Estrategia: PRs encadenados (1a, 1b, 2, 3, 4, 5). Estimación: más de 400 líneas en total; el PR 1a mueve código sin cambiar lógica.

## Progreso

- T1: ruta delegada (escritor único; preparación + varios archivos no triviales). Primera versión en un solo commit (respaldo en backup/modular-core-v1); el revisor nativo la rechazó por exceder su presupuesto de contexto (10494 líneas), así que se re-cortó en 15 commits (bf8470d..0f73c31) con árbol final idéntico. Cada commit pasa typecheck y 159/159 tests; sync:dry idéntico a la línea base salvo la ruta del script.
- Revisión T1: commit 1 pasivo; commits 2-14 riesgo medio y commit 15 riesgo alto (4 lentes), todos aprobados y confirmados. El commit 12 tuvo un operation_timeout y se completó al reingresar por la misma revisión.
- Seguimientos para T2 (no bloqueantes): imports sin usar en tests/core/parse.test.ts, tests/adapters/notion-http.test.ts y tests/app/sincronizar.test.ts; el texto de --ayuda todavía menciona src/sync-tablero-features.ts; sin test para formatearFilaLegible ni para la detección de ejecución directa en src/entrypoints/cli.ts; createdTime inválido (NaN) en resolverDuplicadosPorSlug no es determinista (preexistente); CARPETA_TAREAS y RAMA_BASE_DOCUMENTO leen process.env en core/ajustes.ts; app/sincronizar.ts importa adapters directamente.

## Próximo paso

- Push y PR del PR 1a (decisión del usuario), luego T2 (descriptor de entidades).
