# BACKLOG.md

Deferred items and Phase Two temptations (SW §14 parking lot). Each entry: item, source, why deferred.

Built during the 2026-06 audit sprint (restriction lifted by owner — see DECISIONS.md):
~~Offline conversion / lead-quality loop (CRM outcomes)~~ — built (W3: `/v1/leads/outcome`, closed leads relay as purchases).
~~Self-updating playbooks~~ — built (W3: daily playbook-priors job credits conversions to hook types).

Still parked:

- LTV-based conversion values — SW §14 Phase Two — needs longitudinal purchase history per customer; revisit once external_id adoption is real.
- Comment management — SW §14 Phase Two — needs per-platform comment APIs and moderation policy.
- Competitor monitoring — SW §14 Phase Two — needs ad-library scraping/API access decisions.
- Fraud gating beyond basics — SW §14 Phase Two — needs traffic-quality data sources.
- Diagnosis runbooks (auto-diagnosis/remediation) — SW §14 Phase Two — operational maturity first.
- Live EMQ via Meta Dataset Quality API — audit 2026-06 — requires live Meta credentials (P5); signal-quality score stands in meanwhile.
- Server-side tag gateway (GTM server container) — audit 2026-06 — for sites that can't add the site snippet; the hosted destinations cover no-website users today.
- Additional channels: LinkedIn, Reddit, X, Amazon/retail media, CTV, DOOH, programmatic DSPs — audit 2026-06 — see docs/audit-2026-06.md channel-fit table; Snapchat + Pinterest were built first.
- Multi-tenancy / user accounts — audit 2026-06 — single-operator deployment is the current model; OPERATOR_TOKEN gates the UI.
- Arabic / RTL localization — audit 2026-06 — high value for UAE SMBs; needs full RTL design pass, not just string swaps.
- Chat-style ops agent (AdAmigo-style natural-language control) — audit 2026-06 round 2 — needs LLM tool-calling surface over the internal API; the guardrail layer already constrains what it could do.
- Avatar/UGC-style video provider selection (Arcads/Creatify-class) — audit 2026-06 round 2 — the CreativeProvider video seam + per-second pricing is ready; pick provider at P4.
- Object storage (DO Spaces/CDN) for uploaded media — audit 2026-06 round 2 — in-DB base64 is fine at current volume; move when uploads grow.
