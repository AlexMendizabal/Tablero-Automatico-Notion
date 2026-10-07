# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Advanced tasks: a second synchronizable entity, **Tarea**, read from
  `odd/tareas/*.md` (folder configurable with `TABLERO_CARPETA_TAREAS`). Same
  document format as features plus an optional `feature: "<slug>"` parent key;
  a missing parent is reported as a warning, not an error. Tasks are synced
  after features into their own Notion database (`NOTION_TAREAS_DB_ID`, ID or
  URL; same columns as the board, with the title column named `Tarea`/`Task`).
  Without `NOTION_TAREAS_DB_ID` they are skipped with an informational line;
  without a tasks folder nothing changes. `--dry-run` without credentials
  prints a second `Tareas:` block with the parent feature slug.
- Tasks database: `Feature` relation to the Features database, written from
  each task's parent (the page that already existed or was just created; an
  empty relation, with a warning, when the parent has no page). The sync
  validates that the relation targets the Features data source. When the
  Features sync does not finish, tasks skip Notion so relations are never
  cleared on partial information. `--dry-run` with credentials shows the
  resolved relation per task.
- Tasks database: `Responsable` (`Assignee` in `en`) person property, managed
  by hand in Notion. The sync validates it and never writes or overwrites it.

### Fixed

- Without `NOTION_TAREAS_DB_ID` (or with it empty), task documents are still
  parsed and validated: format errors make the exit code non-zero and parent
  warnings are printed; only Notion is skipped.
- Parent feature warnings are now also printed when a run stops early because
  of a shallow clone or git not being available.

### Changed

- `TABLERO_CARPETA_TAREAS` empty or equal to `TABLERO_CARPETA` (after
  normalization) is now a configuration error, reported before any Notion
  call.
- The task frontmatter `feature` must be a valid document slug (no
  whitespace, `/`, `\`, `..` or characters a file name cannot hold);
  otherwise it is a format error of that task.
- Internal refactor: the single sync script is split into `src/core`,
  `src/ports`, `src/adapters`, `src/app` and `src/entrypoints` (entry point:
  `src/entrypoints/cli.ts`), with tests split by layer. No behavior change.
- Internal refactor: entity descriptor (`src/core/entities/`). The Feature
  schema (`TIPOS_PROPIEDAD`), texts (`TEXTOS_POR_IDIOMA`), status rule and row
  building now live in `src/core/entities/feature.ts`. No behavior change.
- `--ayuda` now shows the real commands (`npm run sync -- …` and
  `npx tsx src/entrypoints/cli.ts …`) instead of the removed
  `src/sync-tablero-features.ts`.

### Fixed

- Duplicate-slug resolution is now deterministic when a Notion page has an
  unparseable `created_time`: it is treated like a missing one (sorted last).

## [1.1.0] - 2026-10-06

### Added

- Community health files: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`
  (Contributor Covenant 2.1), `SECURITY.md`, issue forms and a pull request
  template.
- CI workflow (`.github/workflows/ci.yml`) running typecheck and tests on
  pushes to `main` and on pull requests.
- Dependabot configuration for npm and GitHub Actions (weekly).
- Bilingual documentation: English `README.md` and Spanish `README.es.md`,
  with badges and a demo GIF.
- `repository`, `bugs`, `homepage` and `keywords` metadata in `package.json`.
- Board language setting `BOARD_LANGUAGE` (`es` by default, or `en`): picks
  the Notion property names (e.g. `Estado`/`Status`, `Huella`/`Fingerprint`),
  status values (`Terminada`/`Done`, `QA pendiente`/`QA pending`,
  `Sin empezar`/`Not started`, `En curso`/`In progress`) and progress text
  (`2/3 tareas`/`2/3 tasks`). Unset or `es` keeps existing boards unchanged;
  an invalid value is a configuration error. The sync workflow reads it from
  the `BOARD_LANGUAGE` repository variable.
- Feature documents accept English keywords at all times: `branches` as an
  alternative to the `ramas` frontmatter key and `## Tasks` as an alternative
  to `## Tareas`. Using both spellings in one document is a format error.

### Changed

- **Breaking for forks that customized the schema:** `ESQUEMA_ESPERADO` is
  replaced by `TIPOS_PROPIEDAD` (property types) and `TEXTOS_POR_IDIOMA`
  (names per language). Move any customization to those settings.
- Dependencies: `dotenv` 18 and `ts-jest` 29.4.14.

## [1.0.0] - 2026-10-06

### Added

- Sync script (`src/sync-tablero-features.ts`) that reads every ODD feature
  document in `odd/tasks/*.md` and creates or updates one Notion database row
  per feature. It never deletes pages; pages without a matching document are
  reported as orphans.
- Status derived from task checkboxes and open pull requests
  (`Terminada`, `QA pendiente`, `Sin empezar`, `En curso`), with `QA`-prefixed
  IDs marking manual tests.
- Computed columns: progress, next pending task, open pull requests, live
  branches, last update and days without activity (via `git` and `gh`).
- Document format contract: required `ramas` glob patterns in the
  frontmatter, optional full-hash `commits` anchors, a single `## Tareas`
  section, and code blocks ignored during parsing.
- Activity date from branch commits, pull request merge/close/open dates and
  commit anchors; GitHub's pull request `updatedAt` is never used.
- Schema validation against the expected Notion properties
  (`ESQUEMA_ESPERADO`), and database ID normalization from a full Notion URL.
- Page body rewrite with a fingerprint property (`Huella`) to detect and repair
  out-of-date or partially written pages.
- `sync:dry` mode: without credentials it only validates documents; with
  credentials it also prints the full plan against Notion without writing.
- Optional `TABLERO_CARPETA` and `TABLERO_RAMA_BASE` settings.
- GitHub Actions workflow (disabled by default in the template) that syncs on
  push, daily schedule and manual dispatch, and validates documents on pull
  requests.
- Example feature document (`odd/tasks/ejemplo-feature.md`) and test suite.

[Unreleased]: https://github.com/AlexMendizabal/Tablero-Automatico-Notion/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/AlexMendizabal/Tablero-Automatico-Notion/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/AlexMendizabal/Tablero-Automatico-Notion/releases/tag/v1.0.0
