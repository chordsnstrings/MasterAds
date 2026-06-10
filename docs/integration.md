# Sending results from your site

Your site tells the engine when something good happens — a page viewed, an item
added to a cart, a purchase, an enquiry. The engine uses these reports to learn
what's working and to spend money on the ads that cause them.

**One endpoint, one POST per action:**

```
POST https://<your-engine-host>/v1/events
Content-Type: application/json
x-api-key: <the key we gave you for this site>
```

## What to send

| Field | Required | What it is |
|---|---|---|
| `event_name` | yes | What happened. Use one of the names below. |
| `event_time` | yes | When it happened — unix **seconds**, not when you send it. Late is fine. |
| `value` | on purchases | What the sale was worth (a number). Send margin if you can, revenue otherwise. |
| `currency` | with value | Three letters, e.g. `AED`, `USD`. |
| `click_ids` | when present | The IDs below, captured when the visitor first landed. **This is the most important field for results.** |
| `hashed_identifiers` | recommended | SHA-256 of the lowercased email and/or E.164 phone. |
| `content_id` | yes | Your ID for the product or offer involved. |
| `event_id` | yes | Your unique ID for this action. Send the same one if you retry — we never double-count. |
| `source_site` | yes | The site name we registered for your key. |
| `consent_granted` | EU/UK | Whether the visitor consented to measurement. |

### Event names

Use these (common platform spellings like `CompletePayment`, `SubmitForm`,
`begin_checkout` are also accepted and mean the same thing):

- `ViewContent` — someone viewed the product page
- `AddToCart` — added to cart
- `InitiateCheckout` — started checkout
- `Purchase` — paid (requires `value` + `currency`)
- `Lead` — sent an enquiry / submitted a form
- `CompleteRegistration` — signed up / subscribed
- `Install` — installed the app

### Click IDs — capture at landing, keep for months

When an ad brings someone to your site, the address contains tracking IDs.
Read them **on the first page view**, store them with the visitor (a database
field or long-lived storage — not a short cookie), and include them in every
event for that visitor:

| In the landing URL | Send as |
|---|---|
| `fbclid=...` | `click_ids.fbclid` (or the derived `fbc`) |
| `ttclid=...` | `click_ids.ttclid` |
| `gclid=...`, `gbraid=...`, `wbraid=...` | `click_ids.gclid` / `gbraid` / `wbraid` |
| `_fbp` browser cookie | `click_ids.fbp` |

Purchases can land weeks after the click — keep these IDs at least **180 days**.
Without them, results still count but can't be tied back to the ad that caused
them, and your ads learn more slowly.

## Examples

**Purchase**

```json
{
  "event_name": "Purchase",
  "event_time": 1765432100,
  "value": 2400,
  "currency": "AED",
  "click_ids": { "fbclid": "IwAR2...", "fbp": "fb.1.1700000000.123456" },
  "hashed_identifiers": { "email_sha256": "8f4e...64 hex chars...aa" },
  "content_id": "sofa-3seat-linen",
  "event_id": "order-10293",
  "source_site": "my-shop"
}
```

**Enquiry (lead)**

```json
{
  "event_name": "Lead",
  "event_time": 1765432100,
  "click_ids": { "gclid": "EAIaIQ..." },
  "hashed_identifiers": { "phone_sha256": "1b9c...64 hex chars...07" },
  "content_id": "ev-charger-install",
  "event_id": "enquiry-5512",
  "source_site": "my-services-site"
}
```

**Add to cart**

```json
{
  "event_name": "AddToCart",
  "event_time": 1765432100,
  "click_ids": { "ttclid": "E.C.P..." },
  "content_id": "sofa-3seat-linen",
  "event_id": "cart-77821-sofa",
  "source_site": "my-shop"
}
```

## Responses

- `201` — stored.
- `200` — we'd already received this `event_id`; nothing duplicated. Safe to retry any time.
- `400` — something's malformed; the body lists exactly which fields and why.
- `401` / `403` — missing or wrong `x-api-key` for that `source_site`.

If you fire the same action from the browser **and** your server, use the same
`event_id` on both so it counts once.
