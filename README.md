# Autonomous Multi-Vertical Advertising Engine — Phase One

Products in → self-optimizing advertising out, across Meta, Google, and TikTok,
with full-funnel server-side conversion tracking, net-return optimization, and
hard guardrails. Specified by the four documents in this repo (`CLAUDE.md`,
`autonomous-ad-engine-documentation.md`, `…-creation-flow-spec.md`,
`…-ux-ui-documentation.md`); built by working through `GOALS.md` G0–G13.

## Quickstart (fresh clone, one setup command)

Prerequisites: Node 22+, pnpm 10, PostgreSQL 16 running locally
(`postgres:postgres@127.0.0.1:5432`).

```bash
./scripts/setup.sh    # install deps, create DBs, migrate, seed, install browsers
pnpm check            # typecheck + lint + ui-strings lint + mutation audit + tests
pnpm e2e:full         # full-system pipeline e2e in stub mode + load sanity
pnpm e2e:ui           # Playwright UI suites (creation flow + supervision)
```

Run it:

```bash
pnpm --filter @engine/api run dev        # API on :3000
pnpm --filter @engine/web run dev        # UI on :5173 (proxies to API)
pnpm --filter @engine/loops run start    # relay + fast loop worker
pnpm --filter @engine/scheduler run start # cron jobs
```

Everything runs in **stub mode** with zero secrets: deterministic LLM
classification, placeholder creative, snapshot-validated platform payloads,
deterministic insights. `BLOCKED.md` lists exactly what a human supplies to go
live — no code changes.

## Layout

```
apps/api        Fastify: ingestion (/v1/events), intake/plan/launch, hosted pages, internal UI API
apps/web        Vite+React supervision UI + creation flow (Playwright e2e)
apps/loops      pg-boss relay worker, fast loop, e2e:full, replay CLI
apps/scheduler  feed sync, insights pull, medium loop, billing health, promos, calendar pacing, scoring
packages/contracts  zod conversion contract (single source of payload truth)
packages/db     schema, forward-only migrations, repos (insert-only Decision/CostEvent), seed
packages/core   intake, classification, playbooks, creative pipeline, guardrails, loops, automations
packages/adapters   platform/LLM/creative/billing adapters (stub|live drivers)
```

## Invariants (CLAUDE.md — enforced by construction and CI)

- Every platform mutation passes the guardrail layer (unforgeable approved
  actions; `pnpm audit:mutations` proves it statically).
- Kill switch: DB flag checked every worker iteration and before every adapter
  write (`pnpm kill-switch on|off|status`).
- `Decision`/`CostEvent` are insert-only (repo API + DB triggers); decisions
  written before execution; every inference call writes a CostEvent.
- Optimization evaluates net return — revenue ÷ (ad spend + operating cost).
- The fast loop contains no LLM calls.
- No platform jargon in UI strings (`pnpm lint:ui-strings`).

Operations: `docs/runbook.md`. Site integration: `docs/integration.md`.
Decisions log: `DECISIONS.md`. Deferred Phase Two: `BACKLOG.md`.
