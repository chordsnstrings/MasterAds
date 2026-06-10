# Autonomous Advertising Engine — Ad Creation Flow Specification

**Detailed Interaction Specification**

| | |
|---|---|
| **Document type** | Flow / interaction specification |
| **Status** | Design baseline (pre-build) |
| **Expands** | UX/UI Documentation §5.2 (hero flow) and §6.4 (Add product) |
| **Governing constraint** | A non-technical person must be able to complete it unaided and launch a safe, sensible result |

---

## Table of Contents

1. [Purpose and Governing Constraint](#1-purpose-and-governing-constraint)
2. [Flow Shape](#2-flow-shape)
3. [The Three Ways to Add](#3-the-three-ways-to-add)
4. [Step 1 — Add](#4-step-1--add)
5. [Step 2 — Review the Plan](#5-step-2--review-the-plan)
6. [Where People Go](#6-where-people-go)
7. [Catalog vs. Single Product, Made Invisible](#7-catalog-vs-single-product-made-invisible)
8. [In-Flow States and Edge Cases](#8-in-flow-states-and-edge-cases)
9. [Launch and Confirmation](#9-launch-and-confirmation)
10. [After Launch](#10-after-launch)
11. [What the User Never Sees](#11-what-the-user-never-sees)
12. [Microcopy Reference](#12-microcopy-reference)
13. [Accessibility and Mobile](#13-accessibility-and-mobile)

---

## 1. Purpose and Governing Constraint

This flow is how a user turns a thing they sell into live, self-optimizing advertising. It is the most important flow in the product and the one that must hold up for someone who has never run an ad before.

**The governing constraint:** a non-technical person — a shop owner, a clinic manager, an agent — must be able to complete this flow alone and end up with safe, sensible ads running, without making a single expert decision and without seeing a single platform term. Everything below is in service of that.

Three rules enforce it:

- **Never require an expert decision.** The engine proposes; the user confirms. The only required action is putting in *something* about what they sell.
- **Never show a platform concept.** No objectives, audiences, placements, bidding, pixels, or events. The user works in outcomes they recognize ("more sales," "more enquiries") and the product translates.
- **Always be launchable untouched.** Every option has a safe default. A user can put in one thing, tap Launch, and get a sound result.

---

## 2. Flow Shape

Two steps, plus at most one or two simple questions that appear **only when genuinely needed**. This is deliberately not a six-step wizard; the common path is short, and extra questions surface only for the cases that can't be answered safely by default.

```
                         ┌─ (only if input is ambiguous) ─┐
   Step 1: Add  ─────────┤  "Selling a product or a       ├────────► Step 2: Review ──► Launch ──► You're live
   link / describe /     │   service?"  one tap            │         (plan + creative,
   upload                └────────────────────────────────┘          edits optional)
```

- **Common path** (a link or a description, with a website to send people to): Add → Review → Launch. Two screens, one decision.
- **Conditional questions** appear inline only when the product cannot safely assume an answer: a product-vs-service disambiguation when classification is unsure, and a "where should people go" choice when there's no link to send traffic to (§6).

---

## 3. The Three Ways to Add

The user does **not** choose a "mode." They put in whatever they have, and the engine works out what it is. The screen presents three equally weighted, plain options.

| The user has… | They do this | What happens | Best for |
|---|---|---|---|
| A web page for the thing | Pastes the link | The product reads the page — image, name, price, details — and builds from it | Anyone with a product page or website |
| Nothing to paste | Types what they sell, in their own words | The product reads the description and builds from it | Non-technical users with no web page — the lifeline path |
| A list of many products | Drags in a file (or connects their store) | The product reads all the products and advertises them together | Shops and e-commerce with a catalog |

The "describe it in your own words" path is the one that makes this work for people without a website. It must be as prominent and trusted as pasting a link — not a fallback buried under "advanced."

**File path guidance:** the file option states plainly what it accepts ("a spreadsheet or product file, or connect your store") and is forgiving about format. A non-technical user is unlikely to reach for it; it must never be in their way, but it must be obvious to someone who has a catalog.

---

## 4. Step 1 — Add

### 4.1 Layout

One screen, one job: get something in. A single large input, the three ways to add presented around it, and two optional fields below that most users will leave alone.

```
┌────────────────────────────────────────────────────┐
│  Add something to advertise                     ✕   │
│                                                      │
│  Paste a link, describe it, or add a list.           │
│  ┌────────────────────────────────────────────────┐ │
│  │  Paste a link  ·  or type what you sell…         │ │
│  └────────────────────────────────────────────────┘ │
│         🔗 Paste a link    ✎ Describe it    ⬆ Add a list │
│                                                      │
│  What do you want from this?     How much per day?   │
│  [ We'll choose the best  ▾ ]   [ We'll suggest  ▾ ] │
│                                                      │
│                                  [ Continue → ]      │
└────────────────────────────────────────────────────┘
```

### 4.2 The single input

- Accepts a pasted URL, free-typed text, or a dragged/selected file in the same field area.
- Detects type automatically: a URL is read as a link; text is read as a description; a file triggers the list path.
- Placeholder is an instruction, not a label: "Paste a link · or type what you sell…".
- No format rules shown. The user is never told "enter a valid URL."

### 4.3 The two optional fields

Both default to "the engine decides" and require no input.

- **"What do you want from this?"** — defaults to **We'll choose the best**. If opened, shows plain outcomes (§5.3), never platform objectives.
- **"How much per day?"** — defaults to **We'll suggest**. If opened, a simple amount control (§5.4).

### 4.4 States

- **Empty:** the default. `Continue` is available the moment anything is in the input.
- **Reading:** after a link or file, a calm "Reading that…" with a gentle progress indication, not a spinner that implies an error if slow.
- **Couldn't read it:** if a link can't be opened or a file can't be parsed, the product does not throw an error — it offers the next move: "We couldn't open that link. Tell us what you sell instead, in your own words." and focuses the input for typing. (See §8.)

### 4.5 Disambiguation (conditional)

If the engine can't confidently tell what kind of thing this is (e.g., a vague description), it asks **one** plain question before Review rather than guessing wrong:

> **Is this closer to…**  ◯ Selling a product  ◯ Offering a service

One tap, then straight to Review. This question never appears when the engine is confident.

---

## 5. Step 2 — Review the Plan

This is where a non-technical user gains confidence. The engine has done the work; this screen shows the result as something a person can read and trust, with everything adjustable but nothing required.

### 5.1 Layout

```
┌────────────────────────────────────────────────────┐
│  Here's the plan                                ✕   │
│                                                      │
│  We'll advertise your sofa to people likely to buy   │
│  it, on Instagram, Facebook, and TikTok, for about   │
│  AED 500 a day. We'll start small and put more money │
│  behind whatever works.                              │
│                                                      │
│  Goal          More sales                       ✎    │
│  Shows on      Instagram · Facebook · TikTok    ✎    │
│  Per day       AED 500  (suggested)             ✎    │
│  People go to  yourshop.com/sofa                ✎    │
│                                                      │
│  Your ads                                            │
│  ┌──────┐ ┌──────┐ ┌──────┐                          │
│  │  ▢   │ │  ▢   │ │  ▢   │   We made 3.  [See all]   │
│  └──────┘ └──────┘ └──────┘   Keep all, or pick.      │
│                                                      │
│  You can pause or change anything later.             │
│                                  [ Launch ]          │
└────────────────────────────────────────────────────┘
```

### 5.2 The plain-language summary

The top paragraph restates the whole plan in one sentence a non-technical person can read aloud and understand. It is generated from the same values shown in the list below, so the two never disagree. It always includes the reassurance that the engine starts small and backs what works — this is what makes spending money feel safe.

### 5.3 Goal — editable, in human terms

Tapping `✎` on Goal reveals plain outcomes, not platform objectives:

| The user picks | What the engine does (hidden) |
|---|---|
| **We'll choose the best** (default) | Engine selects the optimization event from the product type |
| More sales | Optimizes toward purchases, with a sensible fallback when sales volume is thin |
| More enquiries | Optimizes toward leads / form submissions |
| More bookings | Optimizes toward booking completions |
| More app installs | Optimizes toward installs |
| More website visits | Optimizes toward visits (offered, but the product gently notes that a sales or enquiry goal usually works better) |

The control is a simple list of these phrases. The platform mechanics behind each never appear.

### 5.4 Shows on — editable, with logos

Defaults to the platforms the engine chose, shown by name with familiar logos ("Instagram · Facebook · TikTok"). Editing reveals simple on/off toggles per platform, each greyed with a one-line note if that platform isn't connected yet ("Connect to use TikTok"). No placements, no networks, no audience settings.

### 5.5 Per day — editable, with a gentle floor

Defaults to a suggested daily amount. Editing reveals a simple amount control (stepper or slider) with the current figure in plain numerals. If the user sets it very low, the product shows a soft, non-blocking note rather than an error: "Below about AED 150 a day it's harder for us to learn what works, so results may be slower." The user can proceed anyway.

### 5.6 People go to — editable; the no-website case lives here

Defaults to the link the user gave. If there is no link (the "describe it" path), this line shows **Choose** and must be resolved before Launch — handled by §6 inline, not as a separate screen.

### 5.7 Your ads — previews and light edits

- The product shows a few generated variants as thumbnails.
- Copy reassures and instructs: "We made 3. Keep all, or pick your favorites."
- The user can: keep all (default), select/deselect variants, tap one to make a light edit (change the words, swap the picture), or ask for fresh ones ("Make new ones").
- Light editing means plain controls — an editable headline and body text, and a "Replace picture" action — never a creative-spec editor with per-placement dimensions.
- No action is required here; keeping all is a valid, common choice.

### 5.8 Launch

A single primary button. Its label matches the result it produces: **Launch**. For a restricted vertical it becomes **Submit for review** (§8.6). The reassurance line above it ("You can pause or change anything later.") removes the fear of commitment.

---

## 6. Where People Go

A non-technical user may have no website and no idea what "landing page" means. This flow must still work for them, and where people land is also how results get measured — so it is handled here in plain terms.

When the `People go to` line needs a choice, the user sees:

```
┌────────────────────────────────────────────────────┐
│  When someone taps your ad, where should they go?    │
│                                                      │
│  ◯  My website or page         (paste the link)      │
│  ◯  A simple page we make for you                    │
│  ◯  A form we make for you      (collect enquiries)  │
│  ◯  WhatsApp                    (chat with you)      │
│  ◯  Call you                    (tap to call)        │
│                                                      │
│                                  [ Use this ]        │
└────────────────────────────────────────────────────┘
```

- **My website or page** — the user pastes their link. Measuring results here needs their site to send data back; the product guides that setup separately and plainly ("connect your site so we can see what's working"), and flags it as an attention item if it isn't done.
- **A simple page we make for you** and **A form we make for you** — the product hosts a lightweight page or form. This is the easiest path for non-technical users *and* it lets the product measure results natively, because it controls that destination. For most non-technical users, this should be the recommended default.
- **WhatsApp** / **Call you** — for service businesses with no site. The product notes plainly that results here are harder to measure precisely, and still tracks what it can (taps through to chat or call).

> **Design note (reconciliation with the engine architecture):** the engine does not generally own landing pages; sites report results to it. The hosted page/form is a deliberate exception for users who have no site of their own — it gives them a destination the product can both run and measure, which is what makes the no-website case viable. Users with their own site take the "connect your site" path instead.

---

## 7. Catalog vs. Single Product, Made Invisible

The engine treats a single product and a multi-product catalog differently under the hood, but the user is never asked to know which they are.

- **One thing** (a link or a description): the product builds ads for that one thing, pointing to the chosen destination. This is the flow specified above.
- **Many things** (a file or connected store): after reading the file, Review opens with a plain confirmation instead of a single-product summary:

> "We found **24 products**. We'll advertise them together and show each person the ones they're most likely to buy. About **AED 800 a day** across all of them."

The user does not build or edit ads per product. They confirm the goal, the daily amount across the set, and where people go, then Launch. Per-product creative is handled automatically. Everything else on the Review screen behaves as specified.

---

## 8. In-Flow States and Edge Cases

Each is handled in the product's own plain voice, with a clear next move. Errors never apologize and are never vague (per the UX doc's copy rules).

| Situation | What the user sees and does |
|---|---|
| **Reading a link/file** | "Reading that…" with calm progress. No action needed. |
| **Link can't be opened** | "We couldn't open that link. Tell us what you sell instead." The input refocuses for typing. Not an error dialog. |
| **File can't be read** | "We couldn't read that file. You can describe what you sell, or connect your store instead." |
| **Unsure what it is** | The one-tap product-vs-service question (§4.5). |
| **No place connected to advertise** | Before Review: "First, choose where to advertise." with one-tap connect for Instagram/Facebook, TikTok, Google. The user returns to exactly where they were. |
| **No website to send people to** | The `People go to` choice (§6), recommending the hosted page/form. |
| **Daily amount set very low** | A soft, non-blocking note (§5.5). The user may proceed. |
| **Restricted business (finance, health, etc.)** | Handled in §8.6. |
| **Creating in progress** | After Launch: "Setting up your ads — this takes a minute." Then the confirmation screen. |

### 8.6 Restricted businesses, handled gently

Some categories (financial services, health, and similar) require a check before ads can run. A non-technical user must not be alarmed or blocked confusingly. At the Launch step the product shows:

> "Ads for **financial services** need a quick check before they go live. We'll handle it and let you know when they're approved — usually within **a day**."

The button changes from **Launch** to **Submit for review**. After submitting, the product shows a calm confirmation ("Submitted — we'll email you when your ads are approved.") and the product appears in an **In review** state. The user does nothing further; the compliance step happens behind the scenes (and maps to the one-time playbook sign-off in the software doc).

---

## 9. Launch and Confirmation

`Launch` does three things and then reassures.

1. Commits the plan; the engine begins creating the campaigns.
2. Moves the product into the **Launching → Learning** lifecycle (no further user action).
3. Shows a confirmation screen built for non-technical confidence:

```
┌────────────────────────────────────────────────────┐
│   ✓  You're live.                                    │
│                                                      │
│   We're showing your ads and learning what works.    │
│   You don't need to do anything.                     │
│                                                      │
│   • We start small and put more behind what works.   │
│   • We'll never spend more than AED 500 a day.       │
│   • We'll tell you only if we need you.              │
│   • You can pause anytime.                            │
│                                                      │
│             [ See how it's doing ]                   │
└────────────────────────────────────────────────────┘
```

The four reassurance lines do real work: they tell a first-time advertiser that they can't be surprised by runaway spend, that they won't be pestered, and that they're in control. The button leads to the product's detail screen.

For a restricted business, the confirmation reads "Submitted for review" with the same calm tone and the same reassurances, framed for the pending state.

---

## 10. After Launch

Changing anything later stays in the same plain language and never reopens a creation wizard:

- **Change the goal or daily amount** — from the product's detail screen, the same plain controls from §5.3–5.5.
- **Pause** — one tap, clearly labeled, with one-tap resume. The engine stops spending while paused.
- **See what's happening** — the funnel and the engine's plain-language activity, as specified in the UX doc (§6.3, §7).

No re-build, no re-approval (unless the change re-triggers a restricted-category check), no re-entry into this flow.

---

## 11. What the User Never Sees

The discipline that keeps this usable. Every concept on the left is the engine's internal model; the user only ever encounters the plain equivalent on the right.

| Hidden (engine / platform concept) | What the user sees instead |
|---|---|
| Campaign / ad set / ad hierarchy | "Your ads" for a product |
| Objective selection | "What do you want from this?" |
| Audiences, lookalikes, targeting | (nothing — the engine decides) |
| Placements, networks | "Shows on Instagram · Facebook · TikTok" |
| Bidding strategy, optimization event | (nothing — the engine decides) |
| Budget mode (daily/lifetime), pacing | "How much per day?" |
| Pixel, conversion event, tracking setup | "Where people go" + "connect your site so we can see what's working" |
| Learning phase | "We're learning what works." |
| Creative specs, per-placement formats | "Your ads," with simple word/picture edits |
| Catalog / dynamic product ads | "We found 24 products… we'll show each person the ones they're most likely to buy." |
| Policy / compliance review | "A quick check before they go live." |

---

## 12. Microcopy Reference

Copy is the primary tool for non-technical usability, so the key strings are specified, not left to build time. Voice: a competent, plain-spoken colleague. Sentence case, active voice, no jargon, button verbs that match their result.

| Moment | String |
|---|---|
| Add screen title | Add something to advertise |
| Add input placeholder | Paste a link · or type what you sell… |
| Add ways | Paste a link · Describe it · Add a list |
| Goal field default | We'll choose the best |
| Budget field default | We'll suggest |
| Continue button | Continue |
| Reading state | Reading that… |
| Link failed | We couldn't open that link. Tell us what you sell instead. |
| Disambiguation | Is this closer to selling a product, or offering a service? |
| Review title | Here's the plan |
| Review reassurance | We'll start small and put more money behind whatever works. |
| Low-budget note | Below about AED 150 a day it's harder for us to learn what works, so results may be slower. |
| Creative help | We made 3. Keep all, or pick your favorites. |
| Make new creatives | Make new ones |
| Pre-launch reassurance | You can pause or change anything later. |
| Launch button | Launch |
| Destination question | When someone taps your ad, where should they go? |
| No account connected | First, choose where to advertise. |
| Restricted notice | Ads for financial services need a quick check before they go live. We'll handle it and let you know when they're approved — usually within a day. |
| Restricted button | Submit for review |
| Confirmation title | You're live. |
| Confirmation body | We're showing your ads and learning what works. You don't need to do anything. |
| Spend reassurance | We'll never spend more than AED 500 a day. |
| Confirmation button | See how it's doing |

---

## 13. Accessibility and Mobile

This flow, more than any other, is where non-technical and on-the-go users land, so the quality floor is strict.

- **One job per screen.** Add asks for one thing; Review shows one plan; the destination question asks one question. Nothing competes.
- **Mobile-first.** Both steps are full-screen on a phone; the single input and the primary button are always within thumb reach; the primary action sticks to the bottom.
- **Big, obvious targets.** 44px minimum; the primary button is unmistakable on every screen.
- **Readable.** Plain language at a comfortable size; the plan summary reads as a sentence, not a form.
- **Forgiving.** No format errors; every dead end offers the next move. The "describe it" path means there is always a way forward, even with nothing prepared.
- **Keyboard and screen reader.** Fully operable without a pointer; the plan summary and each editable line read as clear, labeled controls; reduced motion respected.

---

*End of document.*
