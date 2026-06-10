# DECISIONS.md

One line per decision not specified by the docs: `YYYY-MM-DD — decision — reason`.

- 2026-06-10 — Drizzle ORM (not Prisma) — SQL-first migrations fit the forward-only convention and event-sourced tables; no codegen step in CI.
- 2026-06-10 — Vitest for unit/integration tests, Playwright for e2e — fast TS-native runner; Playwright required for viewport/axe gates.
- 2026-06-10 — Node apps run via tsx at runtime (no per-package tsc build) — single-language monorepo, App Platform builds from source; typecheck enforced by `pnpm check`.
- 2026-06-10 — Package scope `@engine/*` — short, neutral, avoids product naming in imports.
- 2026-06-10 — ESLint flat config with typescript-eslint, `no-explicit-any` as error — enforces the no-`any` policy by lint.
- 2026-06-10 — Decision outcomes stored in separate insert-only `decision_outcomes` table — resolves SW "fills actual_outcome later" vs invariant 3 (insert-only Decisions); the Decision row is never mutated.
- 2026-06-10 — Insert-only enforced by DB triggers in addition to repository API — defense in depth, "by construction" at the database level.
- 2026-06-10 — Custom forward-only SQL migration runner (`schema_migrations` table) instead of drizzle-kit journal — deterministic, no codegen, matches the forward-only convention.
- 2026-06-10 — Product carries a UI lifecycle `status` column — UX §7 needs a per-product status; deriving it from campaigns would be ambiguous pre-launch.
- 2026-06-10 — Conversion relay status kept on `conversion_events.relayed_to` jsonb (updatable) — only Decision/CostEvent are insert-only per invariant 3.
- 2026-06-10 — Reconciliation key = canonical event_name + event_id + (email|phone hash|anon) — GOALS G2 specifies "event_id + identity"; first claim wins canonical, later claims stored non-canonical.
- 2026-06-10 — event_time validated as unix seconds (rejects millisecond timestamps) — SW §7.1 requires occurrence time; ms values are a silent integration bug.
