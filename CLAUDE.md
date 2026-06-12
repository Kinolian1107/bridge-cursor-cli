# bridge-cursor-cli

This is a pure Node.js / JavaScript CLI project (Cursor↔Claude bridge).

## Active rule scopes

Only the following global rule sets apply to this project:
- `common/*` — general development workflow, coding style, testing, security
- `typescript/*` — TypeScript/JavaScript patterns

## Ignored rule scopes

The following global rule sets are **NOT applicable** to this project and should be disregarded:
- `web/*` — frontend/browser rules (CSP, Core Web Vitals, bento layouts, Playwright E2E)
- `csharp/*` — C# / .NET rules
- `python/*` — Python rules

## Documentation conventions

1. **README is a landing page, not a manual.** Keep `README.md` / `README.zh-TW.md` short and in this order: what the project can do → quick start → a simple example → a hierarchical "Documentation" index linking to `docs/*.md`. Advanced/deep content (API reference, configuration, models, integrations, internals) lives in `docs/`, never inline in the README.
2. **All non-README markdown lives in `docs/`.** This includes `docs/CHANGELOG.md`, `docs/CHANGELOG.zh-TW.md`, `docs/todo.md`, topic docs (`api.md`, `configuration.md`, `models.md`, `integrations.md`, `how-it-works.md`, `hermes-setup.md`) and `docs/research/`. Do not create new top-level `.md` files (CLAUDE.md and the two READMEs are the only exceptions).
3. Every doc is bilingual: `<name>.md` (English) + `<name>.zh-TW.md` mirror, cross-linked via the standard header line (`[English](<name>.md) | [繁體中文](<name>.zh-TW.md)`). When updating one language, update the other.
