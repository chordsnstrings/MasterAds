# BLOCKED.md

Human-supplied prerequisites the build cannot create (GOALS P1–P6). The system
is code-complete and passes every gate in **stub mode** with zero secrets.
**Go-live is a configuration exercise — no code changes.** For each item:
what to provide, where it plugs in, and what flips.

## P1 — GitHub repo connected to DigitalOcean App Platform
- **Provide:** push this repo to GitHub; in DO, create an App from `.do/app.yaml`
  (it references `chordsnstrings/MasterAds`; adjust branch if needed). Create a
  second app from the `staging` branch for staging.
- **Plugs in:** `.do/app.yaml` defines all five components (api, web, loops,
  scheduler, db) and the pre-deploy migration job. Auto-deploy on push.

## P2 — DigitalOcean managed Postgres + App Platform app
- **Provide:** the `db` component is declared in `app.yaml`; DO provisions it on
  app creation. Nothing else needed — `DATABASE_URL` is injected via
  `${db.DATABASE_URL}` bindings already present in the spec.
- **Plugs in:** api/loops/scheduler/migrate components.

## P3 — LLM API key (classification, narration, copy)
- **Provider is selectable** via `LLM_PROVIDER`: `anthropic` (default) |
  `openai` | `deepseek` | `llama` (any OpenAI-compatible host: Groq, Together,
  Fireworks, vLLM, Ollama). One key for the chosen provider is enough.
- **Provide (encrypted env vars on `api` and `loops`):**
  - Anthropic: `ANTHROPIC_API_KEY` (+ `ANTHROPIC_MODEL`, default claude-sonnet-4-6)
  - OpenAI: `OPENAI_API_KEY` (+ `OPENAI_MODEL`, default gpt-4o-mini)
  - DeepSeek: `DEEPSEEK_API_KEY` (+ `DEEPSEEK_MODEL`, default deepseek-chat)
  - Llama: `LLAMA_BASE_URL` required (+ `LLAMA_MODEL`; `LLAMA_API_KEY` optional
    for unauthenticated local endpoints)
  - Optional: `LLM_INPUT_PRICE_PER_MTOK` / `LLM_OUTPUT_PRICE_PER_MTOK` so the
    cost ledger prices the chosen model correctly (per-provider defaults exist).
- **Flip:** `LLM_MODE=live`.
- **Stub meanwhile:** deterministic keyword classifier + canned copy; identical
  code path; every call still writes a CostEvent — for every provider.

## P4 — Creative generation API key (image/video provider)
- **Provide:** `CREATIVE_API_KEY` + `CREATIVE_PROVIDER`; the live driver calls
  the documented contract in `packages/adapters/src/creative.ts`
  (`POST /v1/images {prompt,width,height} → {url}`); swap the base URL/shape
  there if the chosen provider differs (single file, ~20 lines).
- **Flip:** `CREATIVE_MODE=live`.
- **Stub meanwhile:** deterministic placeholder assets with correct dimensions
  per format; CostEvents emitted.

## P5 — Meta / Google / TikTok ad accounts, tokens, sandbox accounts
- **Provide (per platform, staging first with sandbox accounts):**
  - Meta: `META_ACCESS_TOKEN` (system user, ads_management/ads_read/
    business_management), `META_AD_ACCOUNT_ID`, `META_DATASET_ID`. Requires
    Business app + Marketing API access tier review for production volume.
  - Google: `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`,
    `GOOGLE_OAUTH_CLIENT_ID/SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`. Note RMF
    (Required Minimum Functionality) review before broad production use.
  - TikTok: `TIKTOK_ACCESS_TOKEN`, `TIKTOK_ADVERTISER_ID`, `TIKTOK_PIXEL_CODE`.
- **Flip:** `META_MODE/GOOGLE_MODE/TIKTOK_MODE=live` (campaigns + insights),
  and the same flags govern the conversion relay; `BILLING_MODE=live`.
- **Stub meanwhile:** snapshot-validated payloads, deterministic campaign ids,
  deterministic insights — the entire loop machinery runs.
- **Note:** live `update/pause/resume/duplicate/uploadCreative` calls and the
  insights pull are implemented to the documented platform contracts in
  `packages/adapters/src/platforms.ts`; wire the per-platform HTTP endpoints in
  that one file when sandbox credentials exist (the stub/live seam is already
  in place, guarded by the same approval + kill-switch checks).

## P6 — At least one site posting real conversion events (post-launch)
- **Provide:** a site integrated per `docs/integration.md`; create its API key:
  `repos.siteKeys.create(site, key)` or via a one-off script; share the key.
- **Plugs in:** `POST /v1/events`. Click-ID capture/persistence on the site is
  the one responsibility that cannot live in the engine (SW §8.3); coverage
  monitoring (Settings → Results tracking) is the early-warning system.
- **Meanwhile:** the hosted page/form destinations measure natively, so
  no-website users are live without P6.

## Go-live order (recommended)
1. P1 + P2 → staging app deploys green in all-stub mode.
2. P3 (LLM live) → classification/copy quality check on staging.
3. P5 sandbox → `staging` flips platform modes live against sandbox accounts;
   verify snapshot payloads against real API responses; canary spend.
4. P4 → live creative assets.
5. Promote to production (`main`), real ad accounts, P6 sites onboarded.
