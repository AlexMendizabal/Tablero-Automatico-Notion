# Security Policy

## Supported versions

Only the latest release on the `main` branch receives security fixes.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report them privately through GitHub Security Advisories: go to the
repository's **Security** tab and click **Report a vulnerability**
(<https://github.com/AlexMendizabal/Tablero-Automatico-Notion/security/advisories/new>).

Include a description of the issue, steps to reproduce, and its possible
impact. You should receive a first response within a few days.

## Handling secrets

This tool uses a Notion integration token (`NOTION_TOKEN`) and, in CI, a
GitHub token. **Never post a Notion token, database ID, `.env` file or
unredacted log in an issue, pull request or discussion.** If a token was
exposed, revoke it immediately in <https://www.notion.so/developers> and
create a new one.
