# Autonomous Advertising Engine — UX/UI Documentation

**Design Specification**

| | |
|---|---|
| **Document type** | UX/UI design specification |
| **Status** | Design baseline (pre-build) |
| **Companion to** | Autonomous Multi-Vertical Advertising Engine — Software Design Documentation |
| **Design direction** | Minimal, modern, calm; radically simpler than traditional ad managers |

---

## Table of Contents

1. [Overview and Design Thesis](#1-overview-and-design-thesis)
2. [Design Principles](#2-design-principles)
3. [Mental Model: Brief and Supervise](#3-mental-model-brief-and-supervise)
4. [Information Architecture and Navigation](#4-information-architecture-and-navigation)
5. [Core Flows](#5-core-flows)
6. [Screen Specifications](#6-screen-specifications)
7. [Surfacing Autonomy: Legibility, Trust, Control](#7-surfacing-autonomy-legibility-trust-control)
8. [Visual Language](#8-visual-language)
9. [Component Library](#9-component-library)
10. [State Design](#10-state-design)
11. [Microcopy and Tone](#11-microcopy-and-tone)
12. [Responsive and Mobile](#12-responsive-and-mobile)
13. [Accessibility](#13-accessibility)
14. [Appendix A: Flow Comparison vs. Traditional Ad Managers](#appendix-a-flow-comparison-vs-traditional-ad-managers)

---

## 1. Overview and Design Thesis

The interface fronts an engine that creates, launches, and optimizes advertising autonomously across Meta, Google, and TikTok. Because the engine does the operational work, the UI's job is **not** to expose ad-operations controls. Traditional ad managers are hard precisely because they surface every lever — objective, audience, placements, bidding, budget, schedule, creative-per-placement — across a three-level hierarchy, turning a single campaign into dozens of decisions. This product removes that surface.

**Thesis:** the user *briefs and supervises* the engine; they do not *operate* it. The interface is intent-in, outcomes-out. The default state of the screen is a calm status surface that shows what matters and gets out of the way. Difficulty is removed not by prettifying the old workflow but by deleting most of it: the user adds a product and sets intent; the engine does the rest; the user watches and intervenes only when asked.

This is the difference between driving a car and directing a chauffeur. The old tools put you in the driver's seat with forty controls. This one seats you in the back with a clear view of the road and a way to say where you want to go.

---

## 2. Design Principles

1. **Intent over operation.** The user expresses what they want (a product advertised, a goal, a budget ceiling); the engine decides how. No control exists for anything the engine should decide itself.
2. **Outcomes first.** Screens lead with results — spend, conversions, return — not configuration. Knobs are the exception, surfaced only where human judgment is genuinely required.
3. **Legible autonomy.** Every autonomous action is visible and explainable in plain language. The user can always see what the engine did and why. A system you cannot see is a system you cannot trust.
4. **Calm by default, depth on demand.** The surface is quiet. Detail is one tap away, never in your face. Progressive disclosure throughout.
5. **Reversible and bounded.** Anything the engine does can be paused or undone in one action. Hard limits (spend caps, kill switch) are always present and always honored.
6. **Attention is earned.** The product interrupts the user only for the few things that need a human. Everything else runs silently.
7. **Plain language, no platform jargon.** The interface names things by what the user controls and recognizes, never by how the platforms are built.

---

## 3. Mental Model: Brief and Supervise

The product has exactly two modes of user engagement, and the IA is built around them.

**Brief** (active, occasional): add a product, set or accept a goal and a budget, set guardrails once. This is the only "input" work, and it is deliberately minimal.

**Supervise** (passive, ongoing): glance at health, read what the engine did, respond to the rare item that needs attention. Most sessions are supervision and last seconds.

Everything a traditional ad manager calls "campaign management" — building ad sets, adjusting bids, reallocating budget, rotating creative, pausing losers — happens inside the engine and surfaces here only as **narrated activity** and **status**, never as required work.

| Traditional ad manager | This product |
|---|---|
| Operate the platform | Direct the engine |
| Configure every lever | Set intent and constraints |
| Manage a campaign hierarchy | Add products |
| Read dashboards full of knobs | Read a calm status surface |
| Continuous manual tending | Occasional supervision |

---

## 4. Information Architecture and Navigation

The IA is intentionally shallow. Four primary destinations, one persistent primary action.

```
Overview   ·   Products   ·   Activity   ·   Settings           [ + Add product ]
```

- **Overview** — the default landing. Portfolio state in one glance: a plain-language status headline, key metrics, anything that needs attention, and the product grid.
- **Products** — the catalog of what is being advertised. Drilling into a product shows its funnel, status, results, and the engine's activity for it. Adding a product is the primary recurring action and is reachable from anywhere.
- **Activity** — the chronological, plain-language stream of every decision the engine has made, filterable by product, platform, or type. This is the trust surface.
- **Settings** — connected accounts, conversion tracking status, guardrails, brand kit, and the restricted-vertical approval queue.

There is no "Campaigns" tab, no "Ad sets," no "Audiences," no "Bidding." Those concepts are the engine's internal model, not the user's. They never appear in navigation.

**Persistent elements:** the top bar carries the four destinations, the `+ Add product` action, an attention indicator (a dot with a count when items need the user), and account access. Nothing else competes for space.

---

## 5. Core Flows

### 5.1 First-run setup (one time)

A short, guided sequence, each step skippable-and-resumable:

1. **Connect ad accounts** — Meta, Google, TikTok via their connect flows. At least one required to launch.
2. **Confirm conversion tracking** — connect the site(s) that report conversions. The product checks that events arrive with the required attribution keys and shows a live readiness signal (see §7 and the companion software doc, §8). Presented as "connect your site so the engine can see what's working," not as a CAPI/click-ID configuration.
3. **Set brand kit** — logo, colors, fonts, and a one-line tone description, used by creative generation.
4. **Set guardrails** — a global daily spend cap and an optional return target. Sensible defaults provided; the user can launch without touching these.

Setup ends on the empty Overview with a single call to action: add the first product.

### 5.2 Add a product — the hero flow

This is the flow that delivers "easier than usual." It is two screens and one decision.

**Step 1 — Add.** A single input accepts any of: a product URL, an uploaded feed, or a typed offer description. Two optional fields sit below: a goal (defaults to "let the engine decide") and a budget (defaults to a recommended figure). Nothing but the input is required.

**Step 2 — Review.** The engine classifies the product and presents a plan: detected category and business model, the recommended goal and its fallback event, the chosen platforms, a recommended budget, and generated creative previews. Every line is editable; nothing must be changed. One action — **Launch** — commits it.

After launch, the product appears in the grid in the **Launching** state, then **Learning**, then **Autonomous**, with no further user action required.

Contrast: a single Meta Ads Manager campaign requires objective selection, then campaign-level settings, then an ad set (audience, placements, budget, schedule, optimization, bidding), then an ad (format, media, primary text, headline, description, link, call-to-action, tracking), then review — across three nested levels. See [Appendix A](#appendix-a-flow-comparison-vs-traditional-ad-managers).

### 5.3 Monitor (ongoing, passive)

The user opens Overview, reads the status headline and metrics, and leaves — or drills into a product to see its funnel and the engine's recent moves. No action is expected. Sessions are short by design.

### 5.4 Intervene (rare)

Three intervention types, all lightweight:

- **Respond to attention** — an item in the attention area (a tracking gap, an anomaly, a restricted-vertical approval) with a clear single fix.
- **Adjust intent** — change a product's goal or budget, or a global guardrail. The engine adapts; no rebuild.
- **Pause** — stop a product or everything (kill switch) in one tap. Always reversible.

### 5.5 Review (periodic)

Results by product, vertical, and platform; the engine's learnings; and incremental-return (iROAS) readouts when holdouts complete. Read-only, oriented toward understanding rather than action.

---

## 6. Screen Specifications

Wireframes below are layout intent, not visual comps. Numerals render in the monospace face (see §8).

### 6.1 Overview / Home

The default screen. Answers, top to bottom: is everything okay, how are we doing, does anything need me, what's running.

```
┌──────────────────────────────────────────────────────────────┐
│  ◐ Engine        Overview   Products   Activity   ⚙     ● 2    │
├──────────────────────────────────────────────────────────────┤
│                                                                │
│  Everything is running.                                        │
│  12 products · 2 in learning · 2 need attention                │
│                                                                │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐  │
│  │ Spend 7d   │ │ Conversions│ │ Return     │ │ Incremental│  │
│  │ AED 84,200 │ │   1,247    │ │   3.1×     │ │   2.3×     │  │
│  │ ▁▂▃▅▆▇      │ │ ▁▂▃▄▆▇      │ │ ▇▆▅▅▆▇      │ │  ── 4 wk   │  │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘  │
│                                                                │
│  Needs attention                                               │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ ⚠  Storefront-2 stopped reporting purchases.          │    │
│  │    The engine is optimizing on partial data. [Fix]    │    │
│  ├──────────────────────────────────────────────────────┤    │
│  │ ◔  Finance offer needs a compliance check before it   │    │
│  │    can launch. [Review]                                │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                                │
│  Products                                      [ + Add ]       │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐           │
│  │ Sofa range   │ │ EV charger   │ │ Villa lease  │           │
│  │ ● Autonomous │ │ ◐ Learning   │ │ ● Autonomous │           │
│  │ AED 12.4k    │ │ AED 3.1k     │ │ AED 9.0k     │           │
│  │ 312 buys 3.4×│ │ 18 leads     │ │ 41 leads     │           │
│  └──────────────┘ └──────────────┘ └──────────────┘           │
└──────────────────────────────────────────────────────────────┘
```

The status headline is plain language and reflects the worst current state (running / learning / needs attention). When nothing needs attention, the attention area collapses entirely.

The Spend tile shows ad spend; a fifth tile, **Running cost**, sits alongside it and shows what it costs to create and manage the ads (the engine's own AI cost), always in money and never in "tokens." The **Return** figure is calculated on total cost — ad spend plus running cost — so it reflects true profitability rather than a number that ignores what the system itself costs to run. Whether running cost is shown to a given operator at all depends on the pricing model (absorbed, metered, or bundled); when it is shown, this is its plain-language home.

### 6.2 Products

A grid (or list, toggleable) of product cards, sortable by status, spend, or results, filterable by platform and vertical. The `+ Add product` action is prominent. Each card shows name, status chip, spend, and primary outcome. No per-card knobs.

### 6.3 Product detail

Everything about one product on a single scrollable screen: outcomes, funnel, and the engine's activity for it. Controls are limited to pause and adjust-intent.

```
┌──────────────────────────────────────────────────────────────┐
│  ← Products / Sofa range                        ● Autonomous   │
│                                                                │
│  AED 12,400 spent · AED 290 running · 312 buys · 3.4× net │
│  Meta · TikTok                                                 │
│                                                                │
│  Funnel — last 7 days                                          │
│  Views        ████████████████████  18,200                     │
│  Add to cart  ████▏                  2,140                     │
│  Checkout     ██                       980                     │
│  Purchase     ▊                        312                     │
│                                                                │
│  What the engine did                                           │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ 2h ago   Raised budget AED 200 → 320/day.        [why]│    │
│  │          Checkout rate up 22% over 5 days.            │    │
│  │ 1d ago   Replaced 2 tired creatives with fresh   [why]│    │
│  │          variants.                                     │    │
│  │ 3d ago   Finished learning. Now optimizing for        │    │
│  │          purchases.                                    │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                                │
│  [ Pause ]              [ Adjust goal & budget ]               │
└──────────────────────────────────────────────────────────────┘
```

### 6.4 Add product

Specified in §5.2. Rendered as a focused two-step panel (modal on desktop, full-screen on mobile).

```
Step 1                              Step 2
┌──────────────────────────┐        ┌──────────────────────────┐
│ Add a product         ✕  │        │ Here's the plan       ✕  │
│                          │        │ Home furnishings ·        │
│ Paste a link, upload a   │        │ E-commerce                │
│ feed, or describe it.    │        │                           │
│ ┌──────────────────────┐ │        │ Goal     Purchases     ✎  │
│ │ https://…            │ │   →    │ Backup   Add to cart      │
│ └──────────────────────┘ │        │ Platforms Meta·TikTok  ✎  │
│                          │        │ Budget   AED 500/day   ✎  │
│ Goal      Budget         │        │                           │
│ [decide▾] [default▾]     │        │ Creative  ▢ ▢ ▢  +12      │
│                          │        │                           │
│         [ Continue → ]   │        │         [ Launch ]        │
└──────────────────────────┘        └──────────────────────────┘
```

### 6.5 Activity

A reverse-chronological, plain-language stream of every decision across all products, with filters (product, platform, type: budget / creative / status / experiment). Each entry expands to show the data behind it — the metric that moved, the window observed, and where the budget went. This screen is the literal rendering of the engine's decision log (software doc, §6.1) translated into human language.

### 6.6 Settings and Guardrails

Grouped, calm, mostly set-once:

- **Connected accounts** — Meta / Google / TikTok, each with a connection status and reconnect action.
- **Conversion tracking** — per site: a readiness signal, click-ID coverage percentage, and a setup guide. Falling coverage raises an attention item (§7).
- **Guardrails** — global daily spend cap, per-product cap, maximum change per step, an optional return floor, and the kill switch. These are the engine's hard bounds and persist at every autonomy level.
- **Brand kit** — logo, colors, fonts, tone.
- **Autonomy** — mostly informational: a one-line explanation that allocation goes autonomous per product once it has enough data, the current per-product autonomy status, and the queue of restricted-vertical playbooks awaiting a one-time compliance sign-off.

---

## 7. Surfacing Autonomy: Legibility, Trust, Control

An autonomous system that does everything risks leaving the user feeling blind and powerless. The product earns trust by being legible and steerable without being operable. These patterns are the heart of the design.

**Plain-language decision narration.** The engine speaks in outcomes and reasons, never in platform mechanics. "Moved budget toward what's converting," not "executed CBO reallocation." Every entry in Activity and on product detail follows this rule.

**A "why" on every action.** Each autonomous move expands to the evidence: the metric that changed, over what window, and the resulting reallocation — including, where relevant, predicted versus actual outcome. Nothing the engine does is a black box.

**Status legibility.** Each product carries one clear status from a fixed, ordered set: Draft → Launching → Learning → Autonomous → Needs attention → Paused. The status tells the user exactly where a product is in its lifecycle and whether anything is expected of them.

**Learning is explained, not hidden.** A product in Learning shows a plain note ("gathering enough conversions to optimize reliably") rather than a featureless spinner. This sets expectations and prevents the user from mistaking a normal cold-start for a failure.

**Attention-only escalation.** The system interrupts the user only for the few situations a human must handle — a tracking gap, a spend anomaly, a restricted-vertical approval, an account disconnection. Each attention item states what happened and offers one clear fix. Everything else runs silently.

**Reversibility everywhere.** Pause (per product) and the kill switch (everything) are always one tap away. Intent changes take effect without a rebuild. The user can always stop or steer.

**Set intent, not levers.** The control surface is goals, budgets, and guardrails — never bids, audiences, or placements. This is what keeps the product simpler than an ad manager: the things a user can touch are the things only a human should decide.

**No surprises.** Large moves (defined by the guardrail thresholds) are surfaced proactively. The user is never startled by a change they could not have seen coming.

---

## 8. Visual Language

The aesthetic is grounded in the subject: a calm instrument for supervising an autonomous system that runs money on signal. Not a dense dashboard of widgets (that is the complexity being rejected), and not a marketing-bright SaaS skin. The feeling is quiet confidence — the machine is handling it; you have a clear, unhurried view.

### 8.1 Palette

A cool, near-white canvas with ink text, one measured accent for the engine's voice and primary actions, and desaturated semantics so status never shouts.

| Token | Hex | Use |
|---|---|---|
| `canvas` | `#F7F8FA` | App background (cool neutral, deliberately not warm cream) |
| `surface` | `#FFFFFF` | Cards, panels |
| `ink` | `#16181D` | Primary text |
| `ink-muted` | `#697079` | Secondary text, labels |
| `hairline` | `#E7E9ED` | Borders, dividers |
| `accent` | `#2F4BDA` | Primary actions, the engine's active/"thinking" state |
| `accent-soft` | `#EEF1FE` | Accent backgrounds, selected states |
| `positive` | `#2E7D5B` | Healthy / up / autonomous |
| `attention` | `#B5791F` | Needs attention / learning |
| `critical` | `#B23A48` | Errors / stopped / disconnected |

Semantic colors are muted on purpose: a calm surface makes the rare loud moment (a real problem) legible. Dark mode inverts canvas/surface to a cool charcoal (`#15171C` / `#1D2026`) with the same accent.

### 8.2 Typography

Three roles, chosen to avoid neutral defaults and to make the numerics — the product's actual substance — a deliberate feature.

- **UI / display:** a humanist grotesque with character but high legibility (e.g., *General Sans*, *Geist*, or *Söhne*; system fallback `ui-sans-serif`). Used for headlines, labels, and body. Set with generous line height and a clear, restrained scale.
- **Numerals / data:** a refined monospace (e.g., *Geist Mono*, *Söhne Mono*, or *JetBrains Mono*; fallback `ui-monospace`). All money, percentages, counts, and identifiers render here. This is the **signature move**: a system that runs on signal shows its numbers in a face built for them, and tabular figures align cleanly in tiles and tables.
- **Type scale (rem):** 2.0 / 1.5 / 1.25 / 1.0 / 0.875 / 0.75. Weights kept to three: regular, medium, semibold. Hierarchy comes from size and weight, never from decoration.

### 8.3 Spacing, radius, elevation

- **Grid:** 8px base; 4px for fine adjustments. Generous padding inside cards (24px) and between sections (40–64px). Whitespace is the primary structuring device.
- **Radius:** a single soft radius (12px for cards, 8px for controls). Consistent, not playful.
- **Elevation:** flat by default. Hairline borders define surfaces; a single soft shadow is reserved for genuinely raised elements (the add-product panel, menus). No layered drop shadows.

### 8.4 Iconography and data visualization

- **Icons:** one consistent line set, 1.5px stroke, used sparingly and only where they aid recognition. No decorative icons.
- **Data viz:** the minimum that carries the meaning. Sparklines for trend in KPI tiles, a single horizontal bar set for the funnel, simple line/bar for detail. No gridlines beyond a baseline, no 3D, no gratuitous color. The funnel — views narrowing to purchase — is the one recurring chart and should read instantly.

### 8.5 Motion

Restrained and purposeful. State transitions (Launching → Learning → Autonomous) animate gently. The engine's "working" state is a slow, calm pulse on the accent, never a busy spinner. New attention items slide in once; they do not blink or nag. All motion respects `prefers-reduced-motion`.

### 8.6 Signature

The product's memorable identity is two things working together: the **plain-language activity stream** (the engine narrates its decisions like a competent colleague) rendered on a **calm instrument surface with monospace numerics**. Where every other ad tool is remembered for its wall of controls, this one is remembered for telling you, simply, what it did and why — and for getting out of the way.

---

## 9. Component Library

| Component | Description | Key states |
|---|---|---|
| **App shell** | Top bar with four destinations, `+ Add product`, attention indicator, account menu | default; attention-present |
| **Status chip** | Fixed lifecycle states with semantic color | Draft, Launching, Learning, Autonomous, Needs attention, Paused |
| **KPI tile** | A single metric with monospace value, label, and sparkline | up / flat / down; loading; no-data |
| **Product card** | Name, status chip, spend, primary outcome | per status; attention overlay |
| **Funnel bars** | Horizontal bars for view → cart → checkout → purchase (or view → lead) | populated; learning (partial); empty |
| **Activity item** | Timestamp, plain-language action, expandable "why" with evidence | collapsed; expanded |
| **Attention card** | Icon, what happened, single fix action | warning; approval; error |
| **Creative preview tile** | Generated asset thumbnail with format badge | generating; ready; selected |
| **Add-product input** | Single field accepting URL / feed / description | empty; detecting; error |
| **Intent control** | Goal selector and budget control (the only real "settings") | default; recommended; custom |
| **Guardrail control** | Cap fields, return floor, kill switch | within bounds; at limit |
| **Primary button** | `Launch`, `Fix`, `Review`, `Pause` — verb matches the result | default; loading; disabled |
| **Empty state** | An invitation to act, never a dead end | per screen |

All interactive components meet the accessibility floor in §13.

---

## 10. State Design

Every screen and component is specified for these states. States are direction, not decoration (per §11).

- **Empty (first run):** "No products yet. Add one to start." with the `+ Add product` action front and center. The empty Overview is an invitation, not a blank.
- **Generating:** during creative generation, preview tiles show a calm working state with an estimated readiness, not an indeterminate spinner.
- **Launching:** the product is being created on the platforms; a brief transitional state on the card.
- **Learning:** a plain note — "Gathering enough conversions to optimize reliably." The funnel shows partial data; no alarm.
- **Autonomous:** the steady state. Status chip positive; activity accrues; no action expected.
- **Needs attention:** the card and Overview surface the issue with one fix. The status chip turns to the attention color.
- **Paused:** clearly marked, with a one-tap resume. The engine takes no actions while paused.
- **Error:** account disconnected, tracking broken, or an ad rejected. Stated plainly with the corrective step (see §11). Errors never apologize and are never vague.

---

## 11. Microcopy and Tone

Words are design material here as much as spacing. The register is plain, active, and confident — a competent colleague, not a salesperson and not a machine.

**Rules:** name things by what the user controls; use plain verbs in sentence case; a button's verb matches the result it produces; an action keeps its name through the whole flow. No platform jargon ever reaches the surface.

**Translation examples** (engine model → user-facing copy):

| Internal / platform term | User-facing copy |
|---|---|
| InitiateCheckout event | Checkout started |
| Purchase / CompletePayment | Purchase |
| CBO budget reallocation | Moved budget toward what's converting |
| Exited learning phase | Finished learning — now optimizing for purchases |
| Creative fatigue → rotation | Replaced tired creatives with fresh ones |
| Click-ID coverage dropped | Storefront-2 stopped reporting purchases reliably |
| Ad disapproved (policy) | This ad wasn't approved — here's why and how to fix it |
| iROAS holdout result | Incremental return (the sales the ads actually caused) |
| AI inference cost / tokens | Running cost (what it costs to create and manage your ads) |

**Failure and emptiness as direction:** "Tracking on Storefront-2 stopped reporting purchases. Reconnect it so the engine optimizes on complete data." — what happened, then the fix, in the interface's voice. Empty states tell the user what to do next.

---

## 12. Responsive and Mobile

The supervision use case is mobile-first by nature — the user glances at health and clears attention items on the go. Every screen is specified for full responsiveness; there is no desktop-only surface.

**Breakpoints and layout adaptation:**

| Breakpoint | Width | Layout |
|---|---|---|
| `sm` (phone) | < 640px | Single column. Nav collapses to a bottom tab bar (Overview, Products, Activity, Settings) with `+ Add` as a floating action. KPI tiles 2-up. Primary actions sticky at the bottom, thumb-reachable. |
| `md` (tablet) | 640–1024px | Two-column grids; top nav returns; product grid 2–3 up; panels render as full-height sheets. |
| `lg` (desktop) | > 1024px | Full layout per the wireframes: top nav, KPI tiles 4–5 up, product grid 3–4 up, add-product as a centered modal. Content max-width 1200px, centered. |

**Rules:** layouts are fluid between breakpoints (no fixed pixel layouts); all data tables degrade to stacked cards on `sm`; charts (sparklines, funnel bars) scale to container width; tap targets never shrink below 44px at any width; the activity stream and funnel are identical in content across widths — responsiveness never hides information, only reflows it.

- **Overview on mobile:** status headline, attention items, KPI tiles in a 2-up grid, then the product list. Single column.
- **Product detail on mobile:** outcomes, funnel, activity stack vertically; pause and adjust as a sticky footer.
- **Add product on mobile:** the two steps become full-screen; the single input and the `Launch` action remain the only required touchpoints.
- **Activity on mobile:** the stream is naturally vertical; filters collapse into a single control.

Targets are touch-sized (44px minimum), and the primary action is always reachable within thumb range.

---

## 13. Accessibility

A non-negotiable quality floor:

- **Contrast:** text and interactive elements meet WCAG AA against their backgrounds; semantic states are distinguished by more than color (icon + label, not color alone).
- **Keyboard:** every flow is fully operable by keyboard with visible focus states; the add-product flow and attention fixes are reachable without a pointer.
- **Screen readers:** status chips, funnel bars, and metrics carry text equivalents; the activity stream reads as a coherent narrative.
- **Motion:** `prefers-reduced-motion` removes transitions and the working-state pulse.
- **Targets:** 44px minimum touch targets across the product.

---

## Appendix A: Flow Comparison vs. Traditional Ad Managers

The product's central promise — easier than the usual ad creation — made concrete.

**Launching one product on a traditional ad manager (representative path):**

1. Choose a campaign objective.
2. Configure campaign settings (name, special category, budget strategy).
3. Build an ad set: audience (age, gender, location, languages, detailed targeting, custom audiences, lookalikes, exclusions), placements (or automatic), optimization goal, bid strategy, budget, schedule.
4. Build an ad: format, media per placement, primary text, headline, description, destination URL, call-to-action, tracking parameters.
5. Review and publish.
6. Repeat steps 3–4 per audience or creative variant being tested.
7. Return daily to monitor, adjust bids and budgets, rotate creative, and pause underperformers.

**Launching one product here:**

1. Paste a link, upload a feed, or describe the offer. (Optionally set a goal and budget; both default.)
2. Review the engine's plan and creative previews.
3. Launch.

Ongoing tending — the recurring cost of step 7 above — does not exist for the user. It is the engine's job and surfaces only as narrated activity. The user's control surface is reduced from dozens of fields across three nested levels to one input and one decision, with all genuine human judgment (goals, budgets, guardrails, restricted-vertical approvals) preserved and everything else removed.

---

*End of document.*
