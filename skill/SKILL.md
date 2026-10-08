---
name: tablero-odd-documents
description: "Trigger: ODD document, odd/tasks, odd/tareas, feature doc, task doc, Notion board sync, tablero-notion. Write and maintain ODD documents that tablero-notion syncs to Notion."
license: MIT
metadata:
  author: "AlexMendizabal"
  version: "2.0"
---

## Activation Contract

Use when creating, editing, or fixing Markdown documents that `tablero-notion` (npm `tablero-automatico-notion`) syncs to a Notion board: features in `odd/tasks/*.md`, tasks in `odd/tareas/*.md`. Folders can be overridden with `TABLERO_CARPETA` / `TABLERO_CARPETA_TAREAS`.

## Hard Rules

- The file name without `.md` is the slug (the upsert key in Notion). Never rename a synced document unless you accept a new page plus an orphan.
- Line 1 is exactly `---`; the frontmatter closes with `---`. Allowed keys, one per line, each value JSON with double quotes:
  - `ramas:` (or `branches:`, never both) — required JSON array of branch globs; `*` matches any sequence including `/`. Example: `ramas: ["feat/login*"]`.
  - `commits:` — optional JSON array of FULL 40-char lowercase hashes (squash-merge anchors). Abbreviated hashes are errors.
  - `feature:` — tasks only, optional JSON string with the parent feature slug: `feature: "login"`.
- Exactly one `# Title` and exactly one `## Tareas` or `## Tasks` section, outside code fences.
- Every checkbox in that section: `- [ ] **T1 — Name**: description` (`[x]` when done). The separator is an em dash `—`, never `-`. IDs match `^[A-Z]+\d+$`; IDs starting with `QA` are QA tasks.
- Never write status, progress, or contributors in the document: they are derived.

## Decision Gates

| Need | Action |
|------|--------|
| New feature | `odd/tasks/<slug>.md` with `ramas` and its task list |
| Sub-task with its own branches | `odd/tareas/<slug>.md` with `feature: "<feature-slug>"` |
| Work squash-merged or without a live branch | Add its full hash to `commits` |
| Work finished | Tick `[x]`; the status updates on the next sync |

## Execution Steps

1. Write or edit the document following the Hard Rules.
2. Derived values: status `Done` when every task is ticked and no PR is open; `QA pending` when only `QA*` tasks remain; `Not started` with zero ticked; otherwise `In progress` (Spanish board: Terminada, QA pendiente, Sin empezar, En curso). Progress is `done/total`. Contributors come from git authors of matching branches and anchor commits, `Co-authored-by` trailers, and PR authors (normalized with `.mailmap`).
3. Validate without writing to Notion: `npx -p tablero-automatico-notion tablero-notion --dry-run` (or `npm run sync:dry` inside this repo). Exit code 1 lists each format error per slug.
4. Fix every reported error before committing.

Common errors: `-` instead of `—`; lowercase or missing ID (`t1`, `Task 1`); two task sections; `ramas` not a JSON array (`ramas: feat/x`); single quotes in JSON; short hashes in `commits`. A `feature` slug with no matching feature document is only a warning: the relation stays empty.

## Output Contract

Report the documents created or changed and the observed dry-run result (exit code and any format errors).

## References

- `../README.md` — full document contract, Notion schema, and status rules.
