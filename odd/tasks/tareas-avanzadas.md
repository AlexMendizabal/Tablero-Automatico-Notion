---
ramas: ["refactor/modular-core", "refactor/entity-descriptor", "feat/task-entity*", "feat/task-relation*", "feat/contribuyentes*", "release/v2*"]
---

# Tareas avanzadas y núcleo modular

## Tareas

- [x] **T1 — Separación en módulos sin cambio de comportamiento (PR 1a)**: mover el archivo único a core/ports/adapters/app/entrypoints, dividir los tests por capa y mantener idéntica la salida de sync:dry.
- [x] **T2 — Descriptor de entidades (PR 1b)**: llevar esquema, textos, regla de estado y armado de fila a core/entities/feature.ts y orquestar con sincronizarEntidad sin renombrar columnas de Features.
- [x] **T3 — Entidad Tarea desde el repo (PR 2)**: documentos en odd/tareas/*.md con feature padre opcional y NOTION_TAREAS_DB_ID opcional que saltea la entidad si falta.
- [x] **T4 — Esquema de Notion para Tareas (PR 3)**: base de Tareas con relación a Feature, Responsable (people) propiedad de Notion que nunca se escribe y Contribuyentes (multi-select).
- [x] **T5 — Contribuyentes desde git y PRs (PR 4)**: autores de ramas, commits ancla del frontmatter, trailers Co-authored-by y autores de PR normalizados con .mailmap.
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

- Estrategia: PRs encadenados (1a, 1b, 2, 3, 4, 5), apilados: el PR 1a contra main y cada PR siguiente sobre la rama del anterior.
- PR 1a: #8 (refactor/modular-core → main), mergeado en 1e85a6c.
- PR 1b: #9 (refactor/entity-descriptor → main), mergeado.
- PR 2: #10 (feat/task-entity → main), mergeado. Fix de CI 0602e74: los tests aíslan GITHUB_REPOSITORY.
- PR 3: #11 (feat/task-relation → main), mergeado.
- PR 4: rama feat/contribuyentes desde main.

## Progreso

- T1: ruta delegada (escritor único; preparación + varios archivos no triviales). Primera versión en un solo commit (respaldo en backup/modular-core-v1); el revisor nativo la rechazó por exceder su presupuesto de contexto (10494 líneas), así que se re-cortó en 15 commits (bf8470d..0f73c31) con árbol final idéntico. Cada commit pasa typecheck y 159/159 tests; sync:dry idéntico a la línea base salvo la ruta del script.
- Revisión T1: commit 1 pasivo; commits 2-14 riesgo medio y commit 15 riesgo alto (4 lentes), todos aprobados y confirmados. El commit 12 tuvo un operation_timeout y se completó al reingresar por la misma revisión.
- Seguimientos de T1: resueltos en T2 (imports sin usar, --ayuda, test de formatearFilaLegible y de esInvocacionDirecta, NaN en createdTime, process.env fuera de core, app sin imports de adapters).
- T2: ruta delegada (escritor único). 8 commits 7712b4f..234ca24; tests 159 → 190; typecheck limpio; sync:dry idéntico en las filas comunes (comparado lado a lado con la base). RED observado para el fix de NaN, la exclusión de propiedades de Notion y esInvocacionDirecta.
- Revisión T2: 3 tramos de riesgo medio (113f4c9..5c5472c, ..db5cd8f, ..234ca24), aprobados y confirmados.
- Seguimientos de T2: resueltos en T3 (listarDocumentos recibe la carpeta del descriptor; ajustes explícitos y URL de Documento con carpetas propias).
- T3: ruta delegada (escritor único). 8 commits 0d23141..ed3a1e3; tests 190 → 233; typecheck limpio; sin carpeta de tareas la salida de sync:dry es idéntica a la base. RED observado como error de compilación (API inexistente) en cada comportamiento nuevo; los tests de seguimiento fijan comportamiento existente (validados rompiendo la URL a propósito).
- Revisión T3: 3 tramos de riesgo medio (8edb740..9efc5d7, ..6b0cfda, ..ed3a1e3), aprobados y confirmados.
- Seguimientos de T3: resueltos en T4 (tareas siempre validadas aunque falte NOTION_TAREAS_DB_ID; avisos en retornos tempranos; validación de carpeta de tareas y del slug padre; tests de lectura no-ENOENT, id vacío y cantidad de páginas).
- T4: ruta delegada (escritor único). 10 commits f163b0d..689ba86; tests 233 → 294 (también con GITHUB_REPOSITORY y BOARD_LANGUAGE=en); cada commit verificado por separado. RED por aserción en cada comportamiento nuevo; los tests que fijan comportamiento existente se validaron rompiendo el código a propósito.
- Revisión T4: tramos c57527f..54bdfb5, ..d5cfa81, ..9f762e4, conjunto ..9f762e4 y seguimientos ..689ba86, todos aprobados y confirmados. Correcciones derivadas de la revisión: slugs con espacios o puntos internos válidos; Tareas desactivadas (no error) cuando solo la carpeta por defecto coincide con la de Features.
- Cierre de T4 tras la revisión del conjunto: README alineado con la regla real del slug (fefc0a1); una tarea nunca se vincula a una página huérfana de Features (bf69bcc); sin lista de documentos de Features no se filtran relaciones (e8c6f69). 296 tests; todo aprobado y confirmado.
- Seguimientos de T4: resueltos en T5 (comparación de carpetas con mayúsculas, ".." y rutas absolutas; test de página vinculada con slugs duplicados).
- T5: ruta delegada (escritor único). 14 commits e1644f5..d886a9a; tests 296 → 409 (también con GITHUB_REPOSITORY y BOARD_LANGUAGE=en). Contribuyentes desde ramas vivas (base..rama), commits ancla, Co-authored-by, autor de cada PR y autores de los commits de cada PR mergeado (decisión del usuario: opción 2, una llamada gh pr view por PR mergeado y por corrida). Columna opcional: si falta, se informa y no se escribe. Si git o gh fallan para un documento, se conservan los contribuyentes de Notion (no se envía la propiedad) y se avisa.
- Revisión T5: tramos y conjunto aprobados. La revisión del conjunto hasta 6ba6ead quedó aprobada sin confirmación porque la rama avanzó durante la revisión; los commits posteriores se revisaron y confirmaron aparte.
- Seguimientos para T6 (no bloqueantes): la validación de forma de gh pr view es todo-o-nada (un commit sin authors deja el PR como desconocido; elección conservadora).

## Próximo paso

- PR 4 en revisión; luego T6 (distribución pública: action.yml, npm, skill, CI, v2.0.0) en una rama desde main. Publicar en npm requiere confirmación explícita del usuario.
