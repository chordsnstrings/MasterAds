# @engine/db

Schema, forward-only migrations, and the typed repository layer.

## Migration convention (binding)

- Migrations are plain SQL files in `migrations/`, applied in filename order by
  `src/migrate.ts` (`pnpm --filter @engine/db run migrate`).
- **Forward-only.** An applied migration file is never edited or deleted; every
  change is a new numbered file. Additive changes ship before destructive ones,
  so a code rollback never strands the schema (SW §13.3).
- Migrations run as the PRE_DEPLOY job in `.do/app.yaml`, so schema and code
  ship together.

## Insert-only streams

`decisions`, `decision_outcomes`, and `cost_events` are event-sourced and
insert-only: the repository API exposes no update/delete for them, and DB
triggers (`forbid_mutation`) reject UPDATE/DELETE at the database level.
Decision outcomes are recorded as separate `decision_outcomes` rows rather than
mutating the original decision.

## Kill switch

`system_settings` key `kill_switch` is created in migration 0001 so it can
never be missing. Flip it with `pnpm kill-switch on|off|status`.
