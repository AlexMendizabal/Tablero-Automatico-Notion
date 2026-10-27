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
- [ ] **T2 — Elección de la versión más reciente y enlace a su rama**: función pura en core, cableado en la orquestación para Features y Tareas, enlace "Documento" y fecha del documento de la versión ganadora; tests.
- [ ] **T3 — Workflow en vivo y documentación**: push a cualquier rama con checkout de la rama por defecto; README es/en y CHANGELOG.

## Log

- L1 (2026-10-27, usuario): "Ok nuestsro proyecto funciona solo con la rama main? Solo actualiza tablero si actualizmos PR a main? Si tenemos un equipo y estos actualizan su propia rama no tenemos seguimiento de eso?"
- L2 (2026-10-27, usuario): "ver el avance de tareas en vivo". Elección de versión: "La editada más reciente (Recommended)".
- L3: rutas. T1–T3 inline (sin motivo de escritor delegado). El cambio de workflow es de riesgo alto (ítem 5: CI): lleva un verificador independiente al final de la feature.
- L4: limitación conocida. Si una rama vieja sin borrar declara un documento que después se borró de `main`, ese documento vuelve a aparecer mientras la rama exista.
