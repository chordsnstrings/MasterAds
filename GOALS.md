# GOALS.md — Autonomous Ad Engine, Phase One Build

**This file is the build contract.** Claude Code works through it top to bottom. It is the single source of progress truth.

---

## How to use this file (rules for Claude Code)

1. **Chunks are strictly sequential.** Do not start a chunk until the previous chunk's GATE has passed. No exceptions, no parallel chunks.
2. **Within a chunk, goals may be done in any order**, but every goal and every gate check must pass before the chunk is marked complete.
3. **Mark progress in this file.** Change `[ ]` to `[x]` as goals complete. At the end of each chunk, append a short completion note under the chunk: date, commit hash, anything deferred (deferrals require an explicit TODO ticket in `BACKLOG.md`, never silent omission).
4. **Gates are executable.** Each GATE lists commands and conditions. All must pass. If a gate cannot pass because of a missing human prerequisite (see below), implement against the documented contract with a stub/sandbox driver, make the gate pass in stub mode, and record it in `BLOCKED.md` with exactly what is needed from the human. Then continue.
5. **The four design documents are the specification.** Read them before G0 and consult them per chunk:
   - `autonomous-ad-engine-documentation.md` (software/system design — "SW")
   - `autonomous-ad-engine-ux-ui-documentation.md` (UX/UI — "UX")
   - `autonomous-ad-engine-creation-flow-spec.md` (creation flow — "FLOW")
   - `CLAUDE.md` (operating rules and invariants)
   On any conflict: CLAUDE.md invariants > SW > FLOW > UX > this file's wording. If a real contradiction is found, record it in `DECISIONS.md` with the resolution chosen and why.
6. **No human in the loop during the build.** Every decision not specified in the docs is made by Claude Code, recorded in `DECISIONS.md` (one line: decision, reason). Do not stop to ask.
7. **Tests are part of every goal.** A goal without its tests is not complete. CI (`pnpm check`) must be green at every gate.

## Human-provided prerequisites (the only human inputs)

These cannot be created by code and are the only things a human supplies. None block the build: every external dependency has a stub/sandbox mode requirement built into its chunk.

| # | Prerequisite | Needed by chunk (live mode only) |
|---|---|---|
| P1 | GitHub repo created and connected to DigitalOcean App Platform | G13 (deploy) |
| P2 | DigitalOcean managed Postgres + App Platform app | G13 (deploy) |
| P3 | Anthropic API key (classification, narration) | G5 live mode |
| P4 | Creative generation API keys (image/video provider) | G6 live mode |
| P5 | Meta / Google / TikTok ad accounts, tokens, sandbox accounts | G3, G7 live mode |
| P6 | At least one site posting real conversion events | post-launch |

---

## G0 — Repository scaffold and toolchain

- [x] Initialize a pnpm TypeScript monorepo: `apps/api`, `apps/web`, `apps/loops`, `apps/scheduler`, `packages/contracts`, `packages/db`, `packages/core`, `packages/adapters`.
- [x] TypeScript strict mode everywhere; shared `tsconfig.base.json`; ESLint + Prettier; no `any` policy (lint-enforced).
- [x] `apps/api`: Fastify app skeleton with health endpoint. `apps/web`: Vite + React + Tailwind skeleton. `apps/loops` and `apps/scheduler`: worker entrypoints with graceful shutdown.
- [x] `pnpm check` script: typecheck + lint + test across the workspace. GitHub Actions workflow running it on push.
- [x] `.do/app.yaml` App Platform spec defining the five components per SW §13.2 (api: web service; web: static site; loops + scheduler: workers; db: managed Postgres), with env var placeholders.
- [x] `.env.example` listing every secret/env var the system uses, each with a comment. No real secrets anywhere in the repo, ever.
- [x] Create `BACKLOG.md`, `BLOCKED.md`, `DECISIONS.md` (empty with header conventions).

**GATE G0:** `pnpm install && pnpm check` passes clean. All four app entrypoints start and stop without error (api responds on `/health`; workers start, log readiness, exit cleanly on SIGTERM). CI workflow is green on the initial commit.


> **G0 complete — 2026-06-10, commit 7764ee5.** Monorepo scaffold, toolchain, CI workflow, .do/app.yaml, env contract, log files. Nothing deferred.

---

## G1 — Data model and migrations

Source: SW §6 (all entities), SW §13.1 (ORM).

- [x] Choose Drizzle or Prisma (record in `DECISIONS.md`); implement the full schema: `Product`, `CampaignSpec`, `Playbook`, `Creative`, `Campaign`, `ConversionEvent`, `Decision`, `CostEvent` with every field listed in SW §6.1, plus relations per §6.2.
- [x] `Decision` and `CostEvent` are insert-only (event-sourced): no update/delete paths exposed in the data layer; enforce via repository API design.
- [x] System settings table including the **kill-switch flag** (SW §13.2: a DB flag checked by every worker iteration).
- [x] Migrations versioned in-repo; a migration runner wired as the pre-deploy step in `.do/app.yaml`; forward-only convention documented in the package README.
- [x] Typed repository layer in `packages/db` for every entity; seed script creating a demo dataset (3 products across statuses, sample decisions, conversions, costs) used by tests and UI development.
- [x] Unit tests on repositories against a real Postgres (dockerized in CI via service container).

**GATE G1:** Migrations apply from zero on a fresh Postgres. Seed runs. Repository tests pass in CI. Attempting to update or delete a `Decision`/`CostEvent` row through the repository API fails by construction.


> **G1 complete — 2026-06-10, commit 9a60669.** Drizzle + custom forward-only SQL runner; insert-only enforced by repo API and DB triggers; decision outcomes as separate insert-only stream; seed with 3 products across statuses. Nothing deferred.

---

## G2 — Conversion ingestion (the inbound contract)

Source: SW §7.1, §8.4, §8.6, FLOW §6 (destinations), Appendix A/B taxonomies.

- [x] `packages/contracts`: zod schemas for the full inbound payload per SW §7.1 — event_name (canonical taxonomy), event_time, value+currency, click_ids (fbc/fbclid, fbp, ttclid, gclid, gbraid, wbraid), hashed_identifiers (email_sha256, phone_sha256), content_id, event_id, source_site. These schemas are the single source of payload truth, imported by api, loops, and tests.
- [x] `POST /v1/events` on `apps/api`: validates, normalizes event_name to the canonical taxonomy (SW Appendix A), persists to `ConversionEvent`, computes `dedup_key`, idempotent on (source_site, event_id) — replays return 200 without duplicating.
- [x] Per-site API key auth on the endpoint; keys stored hashed.
- [x] Late/out-of-order events accepted and stored with `occurred vs received` both kept (SW self-healing posture).
- [x] Click-ID **coverage computation** (SW §8.7): per site and platform, the rolling percentage of conversion events carrying each click ID, exposed via an internal endpoint and persisted for the UI.
- [x] Cross-platform reconciliation key (SW §8.5): dedup of one real conversion claimed by multiple platforms, on event_id + identity, with tests covering the triple-claim case.
- [x] Contract documentation generated for site integrators: `docs/integration.md` with payload examples per event type, written in plain language.

**GATE G2:** Contract tests: valid payloads for every event type in the taxonomy persist correctly; malformed payloads rejected with precise errors; duplicate event_id is idempotent; the same conversion claimed via three platform paths reconciles to one canonical row; coverage numbers compute correctly on seeded fixtures. `pnpm check` green.


> **G2 complete — 2026-06-10, commit d7fcc19.** Contract tests for all event types; malformed payloads return precise field errors; replay idempotent; coverage on fixtures (50/25/0%). Nothing deferred.

---

## G3 — Platform relay (outbound conversions)

Source: SW §7.2, §8.2–8.3, Appendix B.

- [x] `packages/adapters`: a `ConversionRelay` interface; three implementations — Meta CAPI, TikTok Events API, Google (Enhanced Conversions / Data Manager) — each mapping the canonical event to the platform payload with the correct click ID, hashed identifiers, value/currency, event_id.
- [x] **Driver pattern:** every adapter runs in `live` or `stub` mode via env. Stub mode validates the exact outbound payload shape against recorded platform schemas and logs it; live mode sends. The relay code path is identical in both.
- [x] Relay runs in `apps/loops` off a Postgres-backed queue (pg-boss per SW §13.1): retries with backoff, dead-letter after N attempts, per-event relay status persisted (`relayed_to[]`).
- [x] Replay/backfill command: re-relay events in a time window (SW self-healing).
- [x] Failures raise structured log events; sustained failure per platform raises an attention record (consumed by UI in G11).

**GATE G3:** In stub mode end-to-end: an event POSTed to `/v1/events` is relayed to all three adapters with byte-correct payloads (snapshot tests), retried on injected failure, dead-lettered after max attempts, and replayable by command. Relay status visible per event. CI green.


> **G3 complete — 2026-06-10, commit 514f032.** End-to-end stub relay verified: ingest → 3 platforms, injected-failure retry, dead-letter + attention, window replay, kill-switch parking. Nothing deferred.

---

## G4 — Product intake and normalization

Source: SW §5.1, FLOW §3–4, §7.

- [x] `Product` intake service in `packages/core` with three adapters: **URL** (fetch + extract title, images, price, description; resilient to failure with a typed "couldn't read" result — never a crash), **offer text** (free text stored raw for G5 classification), **feed file** (CSV/XLSX parse, tolerant column mapping, multi-product result).
- [x] Normalization into the canonical `Product` object regardless of source; catalog vs offer `mode` set per SW §5.1.
- [x] Feed sync job in `apps/scheduler`: re-pull connected feeds on a 4–6h cadence, diffing stock/price changes and emitting typed change events (consumed in G9).
- [x] API endpoints for the three intake paths used by the UI (FLOW §4), including the "reading…" async status the UI polls.

**GATE G4:** Fixture tests: a product page HTML fixture extracts correctly; a malformed URL yields the typed fallback (not an exception); a 24-row CSV produces 24 normalized products under one catalog group; feed re-sync detects a price change and a stock-out in fixtures and emits the right events. CI green.


> **G4 complete — 2026-06-10, commit 00eb9ca.** All fixture tests green: HTML extract, typed fallback, 24-row CSV → one catalog group, re-sync detects price change + stock-out. Nothing deferred.

---

## G5 — Classification and playbooks

Source: SW §5.2–5.3, Appendix C; FLOW §4.5, §8.6.

- [x] Classifier service producing the `CampaignSpec`: vertical, business model, terminal event, funnel stages, price tier, creative angle, **policy category** (standard | restricted). LLM-backed in live mode (Anthropic API), deterministic fixture-backed in stub mode so tests never need a key.
- [x] Confidence handling: below threshold → emit the single disambiguation question (product vs service) for the UI (FLOW §4.5); never guess silently on low confidence.
- [x] Playbook engine: playbooks as versioned data (DB rows seeded from JSON in-repo), selected by classification, filling the spec per SW §5.2. Seed **four playbooks**: e-commerce physical goods, local services lead-gen, property lead-gen, restricted-finance (template flagged `requires_signoff`).
- [x] **Volume-aware optimization-event selection** (SW §5.3, Appendix C): deepest event clearing the ~50/week learning threshold given expected volume; upstream fallback chain; consolidation grouping for thin products. Pure function, exhaustively unit-tested.
- [x] Restricted gate: a `restricted` spec cannot reach launch until its playbook's one-time sign-off flag is set (SW §10.5; FLOW §8.6 maps the UX).

**GATE G5:** In stub mode: fixed product fixtures classify to expected specs (snapshot tests); low-confidence fixture triggers the disambiguation path; event-selection unit tests cover high-volume (terminal), thin-volume (fallback), and consolidation cases; a restricted product is blocked from launch until sign-off flag set. CI green.


> **G5 complete — 2026-06-10, commit 6a03d03.** Snapshot-tested classification for 4 verticals; disambiguation path; 9 event-selection unit tests incl. consolidation; restricted blocked until sign-off; classification CostEvent asserted. Nothing deferred.

---

## G6 — Creative generation pipeline

Source: SW §5.4; FLOW §5.7; UX component states.

- [x] Generation service: from `Product` + creative angle, produce copy variants (LLM) and image/video briefs dispatched to the creative provider adapter (live/stub driver pattern; stub returns deterministic placeholder assets with correct dimensions per format).
- [x] Format adaptation: every concept rendered to 1:1, 9:16, 16:9 variants; assets stored with format metadata.
- [x] `content_id` stamped on every asset and threaded to campaign construction (G7).
- [x] **Pre-flight policy screening** (Phase One step 4): a screening pass over generated copy/visual descriptors against per-platform rule lists (data-driven, in-repo, extensible); failures block submission and produce a plain-language reason.
- [x] Predictive pre-screening hook: a scoring interface (stub: heuristic score) gating which variants are launched vs held.
- [x] **CostEvent emission**: every generation call writes an `ai_inference` CostEvent with units and price (SW §6.1) — enforced in the adapter so it cannot be skipped.
- [x] Regeneration capped per product per period (SW §10.2 operating-cost caps), cap configurable.

**GATE G6:** Stub-mode pipeline: one product in → ≥3 variants × 3 formats out, all stamped with content_id; a fixture containing a banned claim is blocked with a readable reason; every generation emits a CostEvent (test asserts ledger rows); regeneration cap triggers at the configured limit. CI green.


> **G6 complete — 2026-06-10, commit 5f20cee.** Stub pipeline: 3 variants × 3 formats, content_id stamped; banned claim blocked with readable reason; CostEvent per generation asserted; cap triggers at configured limit. Nothing deferred.

---

## G7 — Platform campaign adapters and launch

Source: SW §5.5, §7.3, §12; FLOW §5, §9.

- [ ] `packages/adapters`: the uniform adapter interface of SW §7.3 (create/update/pause/resume/duplicate campaign, upload creative, read insights) implemented for Meta, Google, TikTok against their **AI campaign types** (Advantage+ / PMax / Smart+), live/stub drivers as in G3.
- [ ] Launch orchestration: `CampaignSpec` + selected creatives → platform campaign(s) created, `Campaign` rows persisted with platform IDs, lifecycle set to Launching → Learning (status machine per UX §7, exact ordered set).
- [ ] Insights pull job in `apps/scheduler`: spend, impressions, conversions per campaign on a regular cadence into Postgres; `ad_spend` CostEvents written from platform-reported spend (SW §6.1).
- [ ] Rate-limit and async-report handling per SW §12 noted per adapter; idempotent campaign creation (re-running a launch cannot double-create).

**GATE G7:** Stub-mode end-to-end: a seeded product flows intake → classify → generate → launch, producing Campaign rows in Launching state with snapshot-correct platform payloads for all three adapters; re-running launch is a no-op; the insights job ingests fixture reports and writes ad_spend CostEvents. CI green.

---

## G8 — Autonomy machinery: loops, guardrails, decisions, kill switch

Source: SW §9.3–9.4, §10; the heart of the system.

- [ ] **Guardrail layer** (`packages/core/guardrails`): deterministic, pre-action validation of every proposed mutation — spend caps (per campaign/vertical/global), max change size per step, change-frequency limits, blast-radius limits, operating-cost caps. Pure functions; every platform-mutating code path routes through it (enforced by construction: adapters accept only guardrail-approved action objects).
- [ ] **Kill switch:** DB flag; every loop iteration and every adapter write checks it first; flipping it halts all writes and inference within one iteration. Admin endpoint + one-line CLI to flip it.
- [ ] **Decision log:** every proposed action persisted as a `Decision` with rationale, predicted outcome, guardrail status, executed flag — before execution. Outcome scoring job fills actual_outcome/scored_delta later.
- [ ] **Fast loop** (`apps/loops`, deterministic, no LLM): pacing checks, spend anomaly detection (configurable z-score/threshold), zero-conversion burn pausing, circuit breakers. Runs on a minutes cadence; autonomous from first deploy per SW §9.4 rule 2.
- [ ] **Auto-promotion gate** (SW §9.4 rule 3): per campaign/vertical signal-sufficiency check that flips allocation authority automatically when the data threshold clears; status persisted and surfaced.
- [ ] Dry-run mode: any loop can run propose-only, writing Decisions with `executed=false`.

**GATE G8:** Tests: a proposed budget change exceeding a cap is blocked and logged; kill switch flipped mid-run halts all writes within one iteration (integration test); fast loop pauses a fixture campaign burning spend with zero conversions and logs the Decision with rationale; a slice crossing the signal threshold auto-promotes; dry-run writes Decisions without mutating. **Mutation-path audit:** grep/static check proving no adapter write is reachable except through the guardrail layer. CI green.

---

## G9 — Channel-keeping automations

Source: SW §14 Phase One step 6.

- [ ] **Stock/price/promo auto-actions:** stock-out event (from G4 feed diff) → pause that product's ads within the sync window; price change → flag price-bearing creatives for regeneration; promos as first-class records with end dates whose creative auto-expires. All actions flow as Decisions through guardrails.
- [ ] **Billing/connection health:** scheduled checks on platform token validity and account billing status (stub-mode fixtures); auto-refresh where possible; attention record on self-repair failure.
- [ ] **New-account warm-up:** ramp pacing rule in the fast loop capping daily spend growth on accounts younger than a configurable age.
- [ ] **Calendar pacing (minimal):** static regional events calendar (Ramadan, DSF, White Friday, Q4) in-repo as data; pacing logic consumes it to pre-adjust budgets within guardrail bounds.

**GATE G9:** Fixture-driven tests for each: stock-out pauses within one sync cycle; promo expiry pulls its creative; an expired token fixture triggers refresh-then-attention; warm-up caps a young account's budget step; a calendar window adjusts pacing and the Decision log shows why. CI green.

---

## G10 — Allocation brain and creative lifecycle

Source: SW §9.2; SW §5.3–5.4.

- [ ] **Medium loop** (daily): cross-campaign budget reallocation on **net return** (revenue ÷ [ad_spend + operating cost] from the CostEvent ledger, SW §9.1), bounded by guardrails, executed only on auto-promoted slices; propose-only (Decision with executed=false) on slices still below threshold.
- [ ] **Creative fatigue detection:** frequency/CTR-decay heuristic per creative; rotation to held variants, regeneration request when the pool is exhausted (respecting the G6 cap).
- [ ] **Event-selection re-evaluation:** periodic re-check of each product's optimization event as volume grows (deepen when terminal volume clears threshold).
- [ ] Outcome scoring job: fills Decision.actual_outcome and scored_delta after the observation window, producing the decision-quality metric (SW §11.2).

**GATE G10:** Simulation test on seeded data: the medium loop shifts budget toward the higher-net-return campaign within guardrail step limits and logs predicted outcomes; a fatigued fixture creative rotates; a thin product deepens its optimization event when fixture volume rises; scoring fills outcomes after the window. CI green.

---

## G11 — Supervision UI (responsive)

Source: UX doc in full — §4 IA, §6 screens, §7 autonomy surfacing, §8 visual language, §9 components, §10 states, §11 microcopy, §12 responsive, §13 accessibility.

- [ ] App shell: four destinations + persistent `+ Add product` + attention indicator; bottom tab bar under 640px per UX §12.
- [ ] Design tokens implemented exactly per UX §8 (palette table, type roles with monospace numerals, 8px grid, radii, elevation); dark mode per §8.1.
- [ ] **Overview**: status headline logic (worst-state), KPI tiles incl. Running cost, Return on total cost, attention area (collapses when empty), product grid. Per UX §6.1.
- [ ] **Products** + **Product detail**: cards, status chips (exact ordered lifecycle set), funnel bars, plain-language activity with expandable "why", Pause / Adjust controls. Per UX §6.2–6.3.
- [ ] **Activity**: filterable stream rendering the Decision log through the microcopy translation tables (UX §11) — no platform jargon string can appear (lint the strings file against a banned-terms list).
- [ ] **Settings**: connections with status, conversion tracking readiness + click-ID coverage (from G2), guardrails incl. kill switch, brand kit, autonomy status + restricted sign-off queue. Per UX §6.6.
- [ ] All component states from UX §10 implemented (empty/generating/launching/learning/autonomous/attention/paused/error).
- [ ] **Responsive at all three breakpoints** per UX §12 table; tables degrade to cards on `sm`; 44px targets; `prefers-reduced-motion` respected; WCAG AA contrast (automated axe checks in CI).

**GATE G11:** Component tests + Playwright e2e against the seeded API: every screen renders with seed data at 375px, 768px, 1280px viewports (screenshot tests); axe passes; the banned-terms lint passes on all UI strings; attention flow (see item → fix → clears) works e2e; kill switch togglable from Settings. CI green.

---

## G12 — Creation flow UI

Source: FLOW doc in full; this is the hero flow and must match it to the letter, including microcopy (FLOW §12 strings verbatim).

- [ ] Step 1 — Add: single input auto-detecting link/text/file; three ways presented; optional goal/budget fields with defaults; reading state; "couldn't read" graceful redirect to describe-it. FLOW §4.
- [ ] Conditional disambiguation (product vs service) only on low classifier confidence. FLOW §4.5.
- [ ] Step 2 — Review: generated plain-language plan sentence consistent with the lines below it; editable Goal (human-outcome list), Shows on (toggles + connect notes), Per day (soft floor note, non-blocking), People go to; creative previews with keep/pick/light-edit/make-new. FLOW §5.
- [ ] Destination chooser incl. hosted simple page and hosted form (minimal hosted page/form service in `apps/api` — it is also a measurement surface, so its events flow into G2 natively), WhatsApp, call. FLOW §6.
- [ ] Catalog path: multi-product confirmation copy and single launch. FLOW §7.
- [ ] Restricted path: Launch → Submit for review, In-review state, calm confirmation. FLOW §8.6.
- [ ] Launch + confirmation screen with the four reassurance lines (spend cap line pulls the real configured cap). FLOW §9.
- [ ] Fully responsive: both steps full-screen on `sm`, sticky primary action; all FLOW §13 rules.

**GATE G12:** Playwright e2e: (a) paste-link happy path to You're-live in two screens; (b) describe-it path with disambiguation and hosted-form destination, then a form submission on the hosted page produces a canonical ConversionEvent (proving the measurement loop); (c) catalog CSV path; (d) restricted product reaches Submit-for-review and is blocked from live until sign-off. Microcopy snapshot tests match FLOW §12 strings. Screenshot tests at all three viewports. CI green.

---

## G13 — Hardening, observability, deploy readiness

Source: SW §11, §13.2–13.3.

- [ ] Structured logging across all components; trace IDs from API request → queue → loop decision → adapter call.
- [ ] Operational monitoring per SW §11.3 surfaced internally: coverage, learning-phase status, EMQ placeholder, spend + operating-cost anomalies, reconciliation drift, net return.
- [ ] Full-system e2e in stub mode: seed → add product (API) → classify → generate → launch → inject conversion events → relay → insights ingest → fast loop acts → medium loop reallocates (dry-run) → UI reflects all of it. One command: `pnpm e2e:full`.
- [ ] Load sanity: ingestion endpoint handles a burst (e.g. 100 rps for 60s) without loss (queue absorbs).
- [ ] `.do/app.yaml` finalized; staging vs production env documented; `docs/runbook.md`: deploy, rollback, kill switch, replay/backfill, rotating tokens.
- [ ] `BLOCKED.md` finalized: the exact list of human prerequisites (P1–P6) with where each plugs in, so go-live is a configuration exercise, not a code change.

**GATE G13 (final):** `pnpm check` and `pnpm e2e:full` green from a fresh clone with one setup command. Fresh-Postgres migration from zero passes. The repo deploys to App Platform from `app.yaml` without code edits once P1–P5 are supplied. Every chunk above shows `[x]` with completion notes. Build complete.

---

## Definition of done (whole build)

Phase One is code-complete when GATE G13 passes. Live activation = supplying P1–P5 secrets and flipping adapters from `stub` to `live` per `BLOCKED.md` — no code changes. Phase Two items live in SW §14 and must not be built now; anything tempting from that list goes to `BACKLOG.md`.
