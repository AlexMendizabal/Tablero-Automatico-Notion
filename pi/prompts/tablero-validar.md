---
description: Validate the ODD documents (odd/tasks, odd/tareas) with tablero-notion --validar and explain any format error
---

Validate the format of this repository's ODD documents with `tablero-notion --validar`. It only reads and parses `odd/tasks` and `odd/tareas` (no `.env`, no Notion, no git/gh) and is fast. It does not detect missing commit anchors; that is `--dry-run`'s job (`/tablero-sync`).

1. Pick the runner, in this order:
   - if the `TABLERO_NOTION_BIN` environment variable is set (a local build, e.g. `<clone>/dist/entrypoints/cli.js`): `node "$TABLERO_NOTION_BIN" --validar`;
   - if `node_modules/tablero-automatico-notion/dist/entrypoints/cli.js` exists: `node node_modules/tablero-automatico-notion/dist/entrypoints/cli.js --validar`;
   - else if `node_modules/.bin/tablero-notion` exists: `npx --no-install tablero-notion --validar`;
   - else: `npx -y -p tablero-automatico-notion tablero-notion --validar`.
2. Run it once from the repository root and capture the exit code and output.
3. Exit 0: report that every document is valid.
4. Non-zero: list each error grouped by slug, and for each one explain the cause and the exact fix according to the `tablero-odd-documents` skill (hybrid ODD format: frontmatter `ramas`, `# ` title, one `## Tasks`/`## Tareas` section, task lines `- [M] **T1 — Name**: …` with markers `[ ]` `[/]` `[!]` `[-]` `[x]`). Do not edit the documents unless the user asks.

$ARGUMENTS
