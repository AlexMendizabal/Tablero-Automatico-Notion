---
description: Sync the ODD documents to the Notion board with tablero-notion (dry run first, real sync only after confirmation)
allowed-tools: Bash(npx:*), Bash(node:*), Bash(test:*), Bash(ls:*), Read
---

Sync this repository's ODD documents (`odd/tasks`, `odd/tareas`) to the Notion board with `tablero-notion`.

1. Pick the runner, in this order:
   - if the `TABLERO_NOTION_BIN` environment variable is set (a local build, e.g. `<clone>/dist/entrypoints/cli.js`): `node "$TABLERO_NOTION_BIN"`;
   - if `node_modules/tablero-automatico-notion/dist/entrypoints/cli.js` exists: `node node_modules/tablero-automatico-notion/dist/entrypoints/cli.js`;
   - else if `node_modules/.bin/tablero-notion` exists: `npx --no-install tablero-notion`;
   - else: `npx -y -p tablero-automatico-notion tablero-notion`.
2. Run the runner with `--dry-run` from the repository root. It writes nothing to Notion and also reports missing commit anchors.
3. If the dry run exits non-zero, show the errors grouped by slug with their fix (see the `tablero-odd-documents` skill) and stop: do not sync.
4. Otherwise show the plan as a short summary (features and tasks to create or update, status, progress, warnings).
5. Ask the user to confirm the real sync. Only after an explicit yes, run the runner without `--dry-run` (it needs `NOTION_TOKEN` and the board configuration in the environment or `.env`; never print or read secrets). Report the exit code and the result.

$ARGUMENTS
