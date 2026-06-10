# CLAUDE.md — Operating Rules for This Repository

You are building the **Autonomous Multi-Vertical Advertising Engine**, Phase One. This file is loaded in every session. It encodes the invariants; the four documents below are the full specification.

## Document order of authority

1. `CLAUDE.md` (this file — invariants)
2. `autonomous-ad-engine-documentation.md` (system design)
3. `autonomous-ad-engine-creation-flow-spec.md` (creation flow)
4. `autonomous-ad-engine-ux-ui-documentation.md` (UX/UI)
5. `GOALS.md` (build sequence and gates)

Work strictly through `GOALS.md`: sequential chunks, executable gates, mark progress in the file, never advance past a failing gate. Decisions not covered by the docs: make them, log one line in `DECISIONS.md`, keep moving. Do not stop to ask a human.

## Invariants (never violate, never "temporarily" bypass)

1. **Every platform mutation goes through the guardrail layer.** No adapter write is reachable except via a guardrail-approved action object. This is enforced by construction, not convention.
2. **The kill switch is a database flag checked at the top of every worker iteration and before every adapter write.** It halts writes and inference. It must work even when a deploy is wedged.
3. **`Decision` and `CostEvent` are insert-only.** No update or delete paths, ever. Decisions are written *before* execution.
4. **Every AI inference call emits a `CostEvent`** with units and price, enforced inside the calling adapter so it cannot be skipped. Money is the unit; "tokens" never reach the UI.
5. **Optimization evaluates net return** — revenue ÷ (ad spend + operating cost) — never ad spend alone.
6. **The fast loop contains no LLM calls.** Pacing, anomalies, circuit breakers, zero-conversion pausing are deterministic code.
7. **No platform jargon in any user-facing string.** The translation tables in UX §11 and FLOW §11–12 are binding; UI strings are linted against a banned-terms list (campaign, ad set, objective, pixel, CBO, placement, lookalike, bid, token...). FLOW §12 strings are used verbatim.
8. **The conversion contract is sacred.** Inbound payloads validate against `packages/contracts` zod schemas (the single source of payload truth). Click IDs, hashed identifiers, content_id, event_id are first-class; ingestion is idempotent on (source_site, event_id).
9. **Restricted-category specs cannot launch** until their playbook's sign-off flag is set. The UI path is Submit for review, never Launch.
10. **Stub/live driver pattern on every external adapter** (platforms, LLM, creative, billing checks). Stub mode is deterministic and CI-runnable with zero secrets; the surrounding code path is identical in both modes.
11. **No secrets in the repo.** `.env.example` documents every variable; real values live only in App Platform encrypted env vars. You never handle production credentials.
12. **Forward-only migrations**, additive before destructive; migrations run pre-deploy so schema and code ship together.

## Stack (fixed)

TypeScript strict on Node.js, pnpm monorepo (`apps/api` Fastify, `apps/web` Vite+React+Tailwind, `apps/loops`, `apps/scheduler`; `packages/contracts|db|core|adapters`). PostgreSQL via the chosen ORM; pg-boss for queues. Deploys to DigitalOcean App Platform from `.do/app.yaml`; `main` → production, `staging` → staging. **No PHP. No MySQL. No Redis until a concrete need is recorded in `DECISIONS.md`.**

## Working conventions

- Tests are part of every goal; `pnpm check` (typecheck + lint + tests) green at every gate. Snapshot-test outbound platform payloads.
- Event taxonomy and click-ID mappings come from SW Appendices A and B — never improvise event names.
- UI: design tokens exactly per UX §8; responsive at 375/768/1280 per UX §12; WCAG AA with axe in CI; 44px targets; `prefers-reduced-motion` respected.
- Plain-language narration: the Decision log renders to users through the translation tables; "why" expansions show the evidence (metric, window, result).
- When something external is missing (keys, accounts), implement against the documented contract in stub mode, pass the gate in stub mode, record the need in `BLOCKED.md`, continue. The build never blocks on a human.
- Phase Two items (SW §14 parking lot: CRM/offline conversions, LTV, self-updating playbooks, comments, competitor monitoring, fraud gating, runbooks) are **not to be built** — route temptation to `BACKLOG.md`.
