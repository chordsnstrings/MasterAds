# Runbook

Operational procedures for the Autonomous Ad Engine on DigitalOcean App Platform.

## Deploy

- `main` auto-deploys to **production**; `staging` auto-deploys to the staging
  app (own database, **sandbox ad accounts** — money-touching code is never
  first exercised in production).
- CI (`pnpm check`) runs on every push; a failing check blocks the deploy branch.
- Migrations run as the `migrate` PRE_DEPLOY job in `.do/app.yaml`, so schema
  and code ship together. Migrations are **forward-only** (additive before
  destructive): a code rollback never strands the schema.

### Staging vs production environment

| | staging | production |
|---|---|---|
| Branch | `staging` | `main` |
| Database | own managed PG | own managed PG |
| Ad accounts | sandbox/test (P5 sandbox creds) | live accounts |
| Driver modes | start `stub`, flip per adapter | `live` after staging soak |
| PUBLIC_BASE_URL | staging app URL | production app URL |

Every env var is documented in `.env.example`. Real values live ONLY in App
Platform encrypted env vars.

## Rollback

1. App Platform → Deployments → roll back to the previous deployment.
2. Do **not** roll back migrations; they are forward-only and additive first.
3. If bad data was written, prefer a forward migration or targeted repair.

## Kill switch (halt everything)

The kill switch is a DB flag checked at the top of every worker iteration and
before every adapter write — it works even when a deploy is wedged.

- UI: Settings → Spending limits → **Stop everything**.
- API: `curl -X POST $API/internal/kill-switch -H 'content-type: application/json' -d '{"engaged": true}'`
- CLI (any machine with DATABASE_URL): `pnpm kill-switch on` / `off` / `status`
- Direct SQL (last resort):
  `UPDATE system_settings SET value='{"engaged": true}' WHERE key='kill_switch';`

Effect: all platform writes and inference halt within one loop iteration.
Relay jobs are parked (not lost) and resume when disengaged.

## Replay / backfill conversions

Re-relay canonical events in a window (e.g., after a platform outage or a
dead-letter alert):

```
pnpm --filter @engine/loops run replay -- --from 2026-06-01 --to 2026-06-10 [--platform meta]
```

Ingestion is idempotent on (source_site, event_id); platforms deduplicate on
event_id — replays cannot double-count.

## Rotating platform tokens

1. Generate the new token (system user / OAuth) on the platform.
2. Update the encrypted env var in App Platform → component → Environment.
3. Redeploy the affected components (loops, scheduler).
4. The billing-health job verifies validity within 6h; or force-check via
   `GET /internal/monitoring`.

Token expiry is self-detected: the connection-health job attempts refresh and
raises an attention item only when self-repair fails.

## Monitoring

- `GET /internal/monitoring` — coverage, learning status (stuck >14d flagged),
  EMQ (live mode), spend/operating-cost anomalies, reconciliation drift,
  net return, kill-switch state, open attention count.
- Logs are structured JSON on every component; `traceId` follows an API
  request through the relay queue to the adapter call; `decisionId` correlates
  guardrail decisions to executions.
- The Decision log (`/internal/activity`, Activity screen) is the complete
  audit trail: every proposal, guardrail status, execution flag, and outcome.

## Common situations

| Symptom | Action |
|---|---|
| Spend anomaly attention item | Campaign already paused by the circuit breaker. Investigate insights, resume from product detail. |
| Relay dead-letter attention | Check platform status/token, then replay the window. |
| Coverage falling | Site stopped sending click IDs — see docs/integration.md with the site owner. |
| Campaign stuck in learning >14d | Volume too thin: event selection will consolidate/fall back on next re-evaluation; consider budget or creative changes. |
| Runaway creative regeneration | Bounded by the per-product cap (settings `creative_caps`) and operating-cost guardrails; check `/internal/monitoring` anomalies. |
