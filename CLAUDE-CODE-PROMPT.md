# Claude Code Kickoff Prompt

Paste the following into Claude Code from an empty project directory containing the five documents (`CLAUDE.md`, `GOALS.md`, `autonomous-ad-engine-documentation.md`, `autonomous-ad-engine-ux-ui-documentation.md`, `autonomous-ad-engine-creation-flow-spec.md`):

---

Read CLAUDE.md, then GOALS.md, then the three design documents in this directory (autonomous-ad-engine-documentation.md, autonomous-ad-engine-creation-flow-spec.md, autonomous-ad-engine-ux-ui-documentation.md). They fully specify an autonomous multi-vertical advertising engine — Phase One.

Build it by working through GOALS.md exactly as its rules state: chunks G0 through G13, strictly sequential, every goal's tests written with it, every GATE's checks executed and passing before the next chunk begins. Mark progress with [x] in GOALS.md and append a completion note per chunk. CLAUDE.md invariants are absolute — in particular: all platform mutations through the guardrail layer, the DB-flag kill switch checked every iteration, insert-only Decision and CostEvent logs, a CostEvent on every inference call, stub/live drivers on every external integration, and zero platform jargon in UI strings.

Do not stop to ask me anything. Unspecified decisions: decide, log one line in DECISIONS.md, continue. Missing external prerequisites (API keys, ad accounts, DigitalOcean): implement against the documented contract, pass the gate in stub mode, record exactly what is needed in BLOCKED.md, continue. Phase Two items are off-limits — route them to BACKLOG.md.

Run continuously until GATE G13 passes: pnpm check and pnpm e2e:full green from a fresh clone, fresh-Postgres migrations from zero, and a repo that deploys to DigitalOcean App Platform from .do/app.yaml with no code changes once the BLOCKED.md prerequisites are supplied. When finished, give me a summary of what was built, every DECISIONS.md entry, and the BLOCKED.md list of what I must provide to go live.

---

## Notes

- Run inside the repo directory with the five files present; Claude Code will scaffold everything else.
- For long unattended runs, launch with auto-accept permissions enabled so it does not pause for tool approvals.
- After GATE G13: create the GitHub repo and DigitalOcean app (P1–P2), supply the keys (P3–P5) as App Platform encrypted env vars, flip adapters from stub to live per BLOCKED.md, and deploy staging first against sandbox ad accounts.
