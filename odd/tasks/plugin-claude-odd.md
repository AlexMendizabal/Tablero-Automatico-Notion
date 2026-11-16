---
ramas: ["feat/plugin-claude-odd"]
---

# Plugin de Claude Code y formato ODD compatible con Gentle

**Objetivo:** entregar el tablero como extensión (plugin) de Claude Code y definir un formato único de documento ODD que cumpla el contrato de Gentle y el del sync, con estados de tarea de Gentle.
**Rama:** feat/plugin-claude-odd (desde main 7be259c). **Estrategia de entrega:** commits por unidad de trabajo. **Tests:** `npm test` (jest) y `npm run typecheck`.

## Specs

- **S1 — Extensión para Claude.** Pedido: "tiene que ser un extencion para claude que usamos ahora odd que es una carpeta de tareas". Un plugin de Claude Code en este repositorio, instalable desde un marketplace del propio repo ("Marketplace en este repo": `.claude-plugin/marketplace.json`, `/plugin marketplace add AlexMendizabal/Tablero-Automatico-Notion`).
- **S2 — Formato híbrido único.** Pedido: "revisa gentle para que no se pisen y tenga todo bien definido". Elección: "Formato híbrido único (recomendado)": un solo documento en `odd/tasks/<slug>.md` que cumple los dos contratos: frontmatter `ramas` + título `# ` + cabecera de Gentle + `## Specs` + `## Tasks` con checkboxes `**T1 — Nombre**` (y a continuación `S#`, ruta y commit) + `## Log`. El skill del plugin lo enseña ("Skill del formato ODD").
- **S3 — Marcadores de estado.** Elección: "[ ] [/] [!] [-] [x] (recomendado)": pending, in_progress, blocked, dropped, done. Ejemplo verbatim:
  `- [ ] **T1 — Pendiente**` / `- [/] **T2 — En curso**` / `- [!] **T3 — Bloqueada**: espera API de pagos` / `- [-] **T4 — Descartada**` / `- [x] **T5 — Hecha**`.
  `[ ]` y `[x]`/`[X]` siguen igual.
- **S4 — Bloqueada.** Elección: "Nuevo estado Bloqueada/Blocked (recomendado)": "Si alguna tarea no descartada está [!], la feature queda Bloqueada (salvo Terminada). Notion crea la opción del select sola."
- **S5 — Descartadas.** Elección: "Fuera del total (recomendado)": "Progreso = hechas / (total − descartadas). Una feature con todo hecho o descartado y 0 PRs abiertos queda Terminada. Todas descartadas = Terminada 0/0."
- **S6 — Validación rápida.** Elección: "Sí, --validar (recomendado)": "Solo lee y parsea odd/tasks y odd/tareas (sin .env, sin Notion, sin git/gh). No detecta commits inexistentes; eso queda para --dry-run."
- **S7 — Comandos.** "Comandos /tablero:validar y /tablero:sync": "Slash commands que corren el dry-run o el sync real." (`/tablero:validar` usa `--validar`, ver S6).
- **S8 — Hook.** "Hook de validación": "Al editar odd/tasks u odd/tareas, corre el dry-run y avisa si el doc quedó mal formado." (usa `--validar`, ver S6).
- **S9 — Documentación.** README es/en, CHANGELOG y la ayuda del CLI describen el plugin, el formato híbrido, los estados y `--validar`.

## Tasks

- [/] **T1 — Estados de tarea en parser, estado y cuerpo**: S3-S5, worker + parent (idioma del cuerpo en sincronizar.ts), commit 9c87e68; espera verificación independiente.
- [x] **T2 — Flag --validar**: S6, worker, commit 270c125.
- [x] **T3 — Plugin de Claude Code (manifest, marketplace, skill, comandos, hook)**: S1-S2, S7-S8, worker, commit 68d3785.
- [x] **T4 — Documentación README/CHANGELOG**: S9, inline (README.md) + worker (README.en.md, CHANGELOG; context backstop), commit de este cambio.

## Log

- L1 (usuario): "tiene que ser un extencion para claude que usamos ahora odd que es una carpeta de tareas revisa gentle para que no se pisen y tenga todo bien definido"
- L2 (usuario, contexto previo): "revisa el proyecto lo quiero para todos mis proyecto monorepo y api-microservices" → elección "A un table por repo" (guía de monorepo/microservicios ya commiteada en 8c95adb).
- L3 (evidencia): Gentle escribe `odd/tasks/<feature>.md` con cabecera, `## Specs` (S#), `## Tasks` (ID, S#, ruta, estado, commit) y `## Log`, sin frontmatter ni checkboxes, con estados pending/in_progress/blocked/dropped/done; no usa `odd/tareas`. Un doc de Gentle "puro" falla el parser (falta `---`/`ramas`, título, checkboxes `**ID — Nombre**`). Hoy `- [-]`, `- [/]`, `- [!]` se ignoran en silencio.
- L4 (decisiones de diseño para T1): precedencia del estado: Terminada (todas las no descartadas hechas y 0 PRs abiertos) > Bloqueada > QA pendiente > Sin empezar (ninguna hecha ni en curso) > En curso. "Pendiente" = primera tarea no hecha y no descartada. La huella de `[ ]`/`[x]` no cambia (no reescribe cuerpos existentes); los estados nuevos sí entran en la huella. En el cuerpo de Notion solo `[x]` va tildado; en curso, bloqueada y descartada llevan un prefijo en el idioma del tablero ("(en curso)", "(bloqueada)", "(descartada)" / "(in progress)", "(blocked)", "(dropped)").
- L5 (decisión T3): el skill vive en `skill/SKILL.md` (publicado en npm) y se copia idéntico al plugin; un test exige que ambas copias sean iguales. El hook es un script Node (funciona en Windows) que corre `tablero-notion --validar` local o, si no hay, vía `npx`.
- L7 (T3): 17 tests del plugin + 1 del parent (hook con un `tablero-notion` publicado sin `--validar` avisa y sale 0 en vez de bloquear). Corte de slice: tras 68d3785 la rama supera ~400 líneas; T1 (riesgo ítem 3) va en su propio commit para revisión aislada.
- L8 (T1/T2): `--validar --dry-run` es error (exit 1). Todas descartadas con PRs abiertos → "Sin empezar" (sale de la precedencia). El idioma del tablero se conecta al cuerpo en `sincronizar.ts` (test RED→GREEN en tests/app/sincronizar.test.ts). Suite: 511/511, typecheck 0.
- L6 (rutas): T1, T2 y T3 son unidades independientes con superficies disjuntas → escritores en paralelo. T4 inline al final. Riesgo: T1 cambia el contrato de formato que consumen los documentos y el tablero (ítem 3) → verificador independiente.
