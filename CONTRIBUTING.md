# Contributing

Thanks for your interest in improving this project! Issues and pull requests
are welcome in **English or Spanish**.

## Before you start

- For bugs and ideas, open an issue first using the templates. For small
  fixes (typos, docs), a pull request directly is fine.
- Read the [README](README.md): it is the source of truth for behavior, the
  document format and how the status is derived.
- By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Local setup

Requirements: Node.js 22 or later, `git`, and (to read pull requests) the
[`gh`](https://cli.github.com/) CLI authenticated with `gh auth login`.

```bash
git clone https://github.com/AlexMendizabal/Tablero-Automatico-Notion.git
cd Tablero-Automatico-Notion
npm ci
```

## Checks

Run these before opening a pull request; CI runs the first two on every push to `main`
and pull request:

```bash
npm run typecheck   # TypeScript, no emit
npm test            # Jest test suite
npm run sync:dry    # Validates odd/tasks/*.md without writing to Notion
```

`npm run sync:dry` works without credentials: it only computes the rows and
reports format errors. You do **not** need a Notion workspace to contribute,
and you should never commit a `.env` file or paste a Notion token anywhere.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/):
  `feat: ...`, `fix: ...`, `docs: ...`, `test: ...`, `refactor: ...`,
  `chore: ...`, `ci: ...`.
- Keep each pull request focused on one change, with its tests and docs.
- Behavior changes need tests in `tests/`.
- If you change behavior or setup, update both `README.md` (Spanish) and
  `README.en.md` (English). If you cannot write one of the languages, say so
  in the pull request and a maintainer will help.
- The Notion property names (`Estado`, `Progreso`, `Huella`, ...) are part of
  the contract with existing databases. Renaming them is a breaking change.
- Add a line under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for
  user-visible changes.

## Flow

1. Fork the repository and create a branch from `main`
   (for example `fix/branch-glob-matching`).
2. Make the change, with tests, and run the checks above.
3. Open a pull request using the template and link the related issue.
4. A maintainer reviews it; once CI is green and feedback is addressed, it is
   merged.
