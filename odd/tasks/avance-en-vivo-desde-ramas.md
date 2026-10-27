---
ramas: ["feat/live-branch-progress"]
---

# Avance de tareas en vivo desde las ramas

**Objetivo:** que el tablero muestre el avance de cada documento ODD según la versión editada más recientemente entre `main` y las ramas vivas, sin esperar al merge.
**Rama:** feat/live-branch-progress (desde main 7b7d346). **Estrategia de entrega:** ask-on-risk (pronóstico ~350–450 líneas). **Tests:** `npm test` (jest) y `npm run typecheck`.

## Specs

- **S1 — Avance en vivo.** Pedido del usuario: "ver el avance de tareas en vivo". Regla elegida: "La editada más reciente": "Gana la versión cuyo último commit sobre ese archivo sea el más nuevo, sin importar en qué rama esté." Aplica a Features (`odd/tasks`) y a Tareas (`odd/tareas`). Ante un empate, gana el checkout.
- **S2 — Documentos que solo existen en una rama.** Aparecen en el tablero. Viene de la propuesta aceptada: "De paso aparecen las features cuyo documento todavía no llegó a `main`."
- **S3 — Qué rama puede hablar por un documento.** *Supuesto de diseño:* una versión de una rama se considera solo si esa rama coincide con las `ramas` que declara esa misma versión, o si es la rama base. Así una rama ajena (por ejemplo de dependabot) nunca pisa el documento. Si la versión de la rama tiene errores de formato, se ignora y se avisa.
- **S4 — Enlace "Documento".** Cuando la versión publicada viene de una rama, el enlace apunta a esa rama. Si no, apunta a la rama base, como hasta ahora.
- **S5 — Disparo en vivo.** El workflow sincroniza con cada push a cualquier rama que toque `odd/tasks/**` u `odd/tareas/**`. El job de sincronización siempre ejecuta el código de la rama por defecto: el push de una rama solo despierta el sync.
- **S6 — Falla de git.** Si no se pueden leer las versiones de las ramas, se avisa y se usan solo los documentos del checkout. El comportamiento es idéntico al de hoy.
- **S7 — Documentación.** README es/en (sección de automatización y regla de versiones) y CHANGELOG.

## Tareas

- [x] **T1 — Versiones de los documentos en las ramas (adaptador git)**: puerto `versionesEnRamas`, `ls-tree`/`show`/`log` por ref, sin leer los blobs idénticos al checkout; soporte en el ejecutar falso y tests.
- [x] **T2 — Elección de la versión más reciente y enlace a su rama**: función pura en core, cableado en la orquestación para Features y Tareas, enlace "Documento" y fecha del documento de la versión ganadora; tests.
- [x] **T3 — Workflow en vivo y documentación**: push a cualquier rama con checkout de la rama por defecto; README es/en y CHANGELOG.

## Log

- L1 (2026-10-27, usuario): "Ok nuestsro proyecto funciona solo con la rama main? Solo actualiza tablero si actualizmos PR a main? Si tenemos un equipo y estos actualizan su propia rama no tenemos seguimiento de eso?"
- L2 (2026-10-27, usuario): "ver el avance de tareas en vivo". Elección de versión: "La editada más reciente (Recommended)".
- L3: rutas. T1–T3 inline (sin motivo de escritor delegado). El cambio de workflow es de riesgo alto (ítem 5: CI): lleva un verificador independiente al final de la feature.
- L4: limitación conocida. Si una rama vieja sin borrar declara un documento que después se borró de `main`, ese documento vuelve a aparecer mientras la rama exista.
- T1 (7c76d19): adaptador `obtenerVersionesEnRamas` + puerto + falso. RED por compilación (función inexistente). Tests 421 → 426. Revisión RDD de riesgo alto (resiliencia y confiabilidad): aprobada y confirmada. Hallazgos no bloqueantes: versiones duplicadas local/origin (resuelto en T2: una por slug), salto sin fecha sin test (agregado en T2), todo-o-nada ante una falla de git (decisión: se avisa y se usa el checkout), cantidad de procesos git por rama y fechas en clones superficiales (el workflow usa fetch-depth: 0).
- T2: las ramas se leen recién después de validar la configuración (idioma, ID de base, credenciales), para respetar el contrato "ninguna llamada a git antes de un error de configuración". Limitación: si el checkout no tiene ningún documento de Tareas, las Tareas que solo existen en ramas no se ven hasta el primer merge. Prueba de punta a punta con git real: una rama temporal `feat/ejemplo-feature-live` que marca T2 de `ejemplo-feature` la lleva de 1/3 a 2/3 ("QA pendiente"); al borrar la rama, vuelve a 1/3. Tests 426 → 442.
- T2 (52b00e2). T3: workflow con push a cualquier rama salvo `dependabot/**` (no reciben los secrets de Actions: el job quedaría en rojo) y checkout de la rama por defecto; README es/en (disparadores, ejemplo de la Action, sección "Avance en vivo desde las ramas", límites conocidos) y CHANGELOG. Tests 443.
- T3 (4409550). Verificación independiente (toda la feature, probes con git real en un clon temporal): S1-S6 PASS; un bloqueante. Una versión más nueva en una rama declarada tapaba un documento mal formado del checkout (sync:dry salía 0, así que un PR quedaba en verde), y por eso S7 fallaba en la afirmación "el PR la marca en rojo". Corrección: un checkout mal formado nunca se reemplaza. RED en core y app, después GREEN. Recheck con git real: exit 1 y el error se informa. Docs: precisión sobre "sin commitear" y dos límites nuevos (las ramas anteriores al cambio no disparan el push; borrar una rama no dispara el sync). Tests 445.
