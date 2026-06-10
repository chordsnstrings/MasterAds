# DECISIONS.md

One line per decision not specified by the docs: `YYYY-MM-DD — decision — reason`.

- 2026-06-10 — Drizzle ORM (not Prisma) — SQL-first migrations fit the forward-only convention and event-sourced tables; no codegen step in CI.
- 2026-06-10 — Vitest for unit/integration tests, Playwright for e2e — fast TS-native runner; Playwright required for viewport/axe gates.
- 2026-06-10 — Node apps run via tsx at runtime (no per-package tsc build) — single-language monorepo, App Platform builds from source; typecheck enforced by `pnpm check`.
- 2026-06-10 — Package scope `@engine/*` — short, neutral, avoids product naming in imports.
- 2026-06-10 — ESLint flat config with typescript-eslint, `no-explicit-any` as error — enforces the no-`any` policy by lint.
