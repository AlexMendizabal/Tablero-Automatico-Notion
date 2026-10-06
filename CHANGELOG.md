# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Changed

- `package.json` is no longer marked as `private`.

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

[Unreleased]: https://github.com/AlexMendizabal/Tablero-Automatico-Notion/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/AlexMendizabal/Tablero-Automatico-Notion/releases/tag/v1.0.0
