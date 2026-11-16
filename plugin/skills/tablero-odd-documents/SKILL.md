---
name: tablero-odd-documents
description: "Trigger: ODD document, odd/tasks, odd/tareas, feature doc, task doc, Gentle ODD, Notion board sync, tablero-notion. Write and maintain the single hybrid ODD document that satisfies Gentle's ODD contract and the tablero-notion sync."
license: MIT
metadata:
  author: "AlexMendizabal"
  version: "3.0"
---

## Activation Contract

Use when creating, editing, or fixing Markdown documents that `tablero-notion` (npm `tablero-automatico-notion`) syncs to a Notion board: features in `odd/tasks/*.md`, tasks in `odd/tareas/*.md`. Folders can be overridden with `TABLERO_CARPETA` / `TABLERO_CARPETA_TAREAS`.

There is ONE document format (the hybrid ODD document). It satisfies both contracts at once:

- **Gentle's ODD contract**: `odd/tasks/<feature>.md` with a 2-3 line header (objective, branch, delivery strategy, test runner), `## Specs` with numbered `S#` quoting the user's exact words, `## Tasks` with one line per task (ID, linked `S#`, route, status, commit), and `## Log` last, whose `L1` is the user's original request verbatim.
- **The sync contract**: frontmatter, a `# ` title, exactly one task section with checkbox lines `- [M] **T1 — Name**: rest`.

A "pure" Gentle document (no frontmatter, no checkboxes, status written as a word) FAILS the sync: missing `---`/`ramas`, missing title, or no `**ID — Name**` checkboxes. Always write the hybrid form.

## Hard Rules

- The file name without `.md` is the slug (the upsert key in Notion). Never rename a synced document unless you accept a new page plus an orphan.
- Line 1 is exactly `---`; the frontmatter closes with `---`. Allowed keys, one per line, each value JSON with double quotes:
  - `ramas:` (or `branches:`, never both) — required JSON array of branch globs; `*` matches any sequence including `/`. Example: `ramas: ["feat/login*"]`.
  - `commits:` — optional JSON array of FULL 40-char lowercase hashes (squash-merge anchors). Abbreviated hashes are errors.
  - `feature:` — task documents in `odd/tareas/` only, optional JSON string with the parent feature slug: `feature: "login"`.
- Exactly one `# Title` and exactly one `## Tasks` or `## Tareas` section, outside code fences. `## Specs` and `## Log` are free-form for the sync; keep `## Log` as the last section.
- Every task line in that section: `- [M] **T1 — Name**: S1-S2, route, commit` where `M` is a status marker (see below). The separator is an em dash `—`, never `-`. IDs match `^[A-Z]+\d+$`; IDs starting with `QA` are QA tasks.
- After the `**ID — Name**:` put Gentle's task fields: linked `S#`, route (`inline`, `worker`, …) and commit (short hash or `commit pending`). The status is the marker, never a word in the line.
- Never write feature status, progress, or contributors in the document: they are derived.

## Status markers

| Gentle state | Marker | Sync effect |
|--------------|--------|-------------|
| `pending` | `- [ ]` | Pending |
| `in_progress` | `- [/]` | In progress |
| `blocked` | `- [!]` | The feature becomes `Blocked` / `Bloqueada` (unless it is already Done) |
| `dropped` | `- [-]` | Left out of the progress total |
| `done` | `- [x]` (or `[X]`) | Done |

```markdown
- [ ] **T1 — Pending**
- [/] **T2 — In progress**
- [!] **T3 — Blocked**: waiting for the payments API
- [-] **T4 — Dropped**
- [x] **T5 — Done**
```

Progress = done / (total − dropped). A feature whose tasks are all done or dropped and has 0 open PRs is `Done`; all dropped is `Done` 0/0.

## Decision Gates

| Need | Action |
|------|--------|
| New feature | `odd/tasks/<slug>.md` in the hybrid format with `ramas` |
| Sub-task with its own branches | `odd/tareas/<slug>.md` with `feature: "<feature-slug>"` (same task-line rules) |
| Work squash-merged or without a live branch | Add its full 40-char hash to `commits` |
| Task state changes | Change only its marker; the board updates on the next sync |

## Example document

`odd/tasks/plugin-claude-odd.md`:

```markdown
---
ramas: ["feat/plugin-claude-odd"]
---

# Claude Code plugin and Gentle-compatible ODD format

**Objective:** ship the board as a Claude Code plugin and define one ODD document format that meets Gentle's contract and the sync's.
**Branch:** feat/plugin-claude-odd (from main 7be259c). **Delivery strategy:** one commit per work unit. **Tests:** `npm test` (jest) and `npm run typecheck`.

## Specs

- **S1 — Claude extension.** Request: "it has to be a Claude extension". A Claude Code plugin installable from a marketplace in this repository.
- **S2 — Single hybrid format.** Request: "review gentle so they do not clash". One document that meets both contracts.

## Tasks

- [x] **T1 — Task states in the parser**: S2, worker, a1b2c3d.
- [ ] **T2 — Claude Code plugin**: S1, worker, commit pending.
- [ ] **QA1 — Manual install check**: S1, inline, commit pending.

## Log

- L1 (user): "it has to be a Claude extension, review gentle so they do not clash"
- L2 (decision): the skill is copied verbatim into the plugin.
```

## Execution Steps

1. Write or edit the document following the Hard Rules; set each task's marker from its Gentle state.
2. Validate the format (fast, no `.env`, no Notion, no git/gh): `tablero-notion --validar` (or `npx -y -p tablero-automatico-notion tablero-notion --validar`). Exit code 1 lists each format error per slug. In Claude Code, `/tablero:validar` runs it.
3. `--validar` does not check commit anchors; to see the full plan, including missing commits, run `tablero-notion --dry-run` (`/tablero:sync` runs the dry run first and only syncs after confirmation).
4. Fix every reported error before committing.

Derived values: status `Done` when every non-dropped task is done and no PR is open; `Blocked` when any non-dropped task is `[!]`; `QA pending` when only `QA*` tasks remain; `Not started` with nothing done or in progress; otherwise `In progress` (Spanish board: Terminada, Bloqueada, QA pendiente, Sin empezar, En curso). Contributors come from git authors of matching branches and anchor commits, `Co-authored-by` trailers, and PR authors (normalized with `.mailmap`).

Common errors: a pure Gentle document without frontmatter or checkboxes; `-` instead of `—`; lowercase or missing ID (`t1`, `Task 1`); two task sections; `ramas` not a JSON array (`ramas: feat/x`); single quotes in JSON; short hashes in `commits`. A `feature` slug with no matching feature document is only a warning: the relation stays empty.

## Output Contract

Report the documents created or changed and the observed `--validar` (or dry-run) result: exit code and any format errors.

## References

- https://github.com/AlexMendizabal/Tablero-Automatico-Notion#readme — full document contract, Notion schema, and status rules.
