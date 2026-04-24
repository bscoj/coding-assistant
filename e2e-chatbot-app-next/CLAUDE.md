# Databricks Chat App Agent Map

Use this file as a map, not an encyclopedia. For deep details, read the source
of truth files it points to.

## Start Here

1. Read `README.md` for setup, local dev, deployment, and optional database
   modes.
2. Read `package.json` for the actual workspace commands.
3. Read `databricks.yml` before any deployment changes.
4. Read the package-level files you are changing instead of relying on this file
   alone.

## What This Project Is

- npm workspaces monorepo
- React + Vite frontend in `client/`
- Express + TypeScript backend in `server/`
- shared packages in `packages/`
- Databricks-oriented chat UI with optional Lakebase/Postgres persistence
- Biome is the formatter/linter, not ESLint + Prettier

## Working Agreements

- Prefer small, package-scoped changes over cross-monorepo churn.
- Add dependencies to the correct workspace, not blindly at the repo root.
- Preserve the existing visual language and deployment assumptions unless the
  task explicitly changes them.
- For database changes:
  1. update `packages/db/src/schema.ts`
  2. run `npm run db:generate`
  3. review the generated SQL
  4. run `npm run db:migrate`
- Do not use `db:push` for production-style changes.
- For frontend work, preserve streaming chat behavior and loading/approval UX.

## High-Signal Paths

- `README.md`: setup, deployment, database modes, local dev
- `package.json`: workspace commands
- `client/src/`: frontend UI
- `server/src/routes/chat.ts`: main chat proxy route and request headers
- `server/src/lib/`: backend helpers and local settings/profile state
- `packages/db/src/schema.ts`: database schema
- `databricks.yml`: app deployment config
- `playwright.config.ts`: test configuration
- `.claude/skills/quickstart/SKILL.md`: interactive quickstart flow

## Common Commands

```bash
npm run dev
npm run build
npm run lint
npm test
npm run db:generate
npm run db:migrate
```

## When You Need More Context

- Architecture and setup: `README.md`
- Deployment behavior: `databricks.yml`
- Database behavior: `packages/db/` plus generated migrations
- Frontend behavior: `client/src/components/`, `client/src/pages/`
- Backend behavior: `server/src/routes/`, `server/src/lib/`
- Tests and mocks: `tests/`

## LLM Guidance

- Prefer repo files and package-local context over broad monorepo guesses.
- If the task is localized, inspect only the relevant workspace/package first.
- Treat this file as startup guidance only. Pull deeper context from the code and
  docs on demand.
