# Sending results from your site

Your site tells the engine when something good happens — a page viewed, an item
added to a cart, a purchase, an enquiry. The engine uses these reports to learn
what's working and to spend money on the ads that cause them.

## Easiest path: the pixel snippet

Add one line before `</body>` (get your site name and key from Settings →
Connected sites):

```html
<script src="https://<your-engine-host>/pixel.js" data-site="my-shop" data-key="sk_..."></script>
```

The snippet automatically captures every ad click ID (`fbclid`, `gclid`,
`gbraid`, `wbraid`, `ttclid`, `sccid`, `epik`) plus the `_fbp` cookie on
landing, stores them for **180 days**, and sends a `ViewContent` for each page
view. Report anything else from your own code:

```js
// On purchase confirmation:
window.adEngine.track("Purchase", {
  value: 2400,
  currency: "AED",
  content_id: "sofa-3seat-linen",
  event_id: "order-10293", // your order id — retries never double-count
  hashed_identifiers: { email_sha256: "..." }, // see "match quality" below
});
```

Add `data-manual="true"` to the script tag to disable the automatic page view.

### Match quality — why richer identifiers mean cheaper results

Channels match your reported results to ad viewers using the identifiers you
send. More identifiers → more matches → the channels' AI learns faster →
**15–25% better cost per result** in industry measurements. Send as many of
these as you have (each SHA-256 hashed, lowercase/trimmed before hashing):
`email_sha256`, `phone_sha256` (E.164), `first_name_sha256`,
`last_name_sha256`, `city_sha256`, `zip_sha256`, `country_sha256` (2-letter),
`external_id_sha256` (your customer id). IP and user agent are captured
automatically. Your Settings screen shows a live **Signal strength** score per
site.

### Consent (EU/UK)

Pass Consent Mode v2 signals when you have a consent banner:

```js
window.adEngine.track("Purchase", { ..., consent: { ad_user_data: true, ad_personalization: true } });
```

## Platform-specific installs

Add the site in **Settings → Connected sites**, pick your platform, and the
UI renders these exact snippets with your key filled in.

### Shopify

1. **Visits + click-ID capture** — Online Store → Themes → ⋯ → Edit code →
   `theme.liquid`, paste the pixel snippet just before `</head>`.
2. **Purchases** — Settings → Customer events → *Add custom pixel*, paste the
   `checkout_completed` subscriber the UI generates (it posts a `Purchase`
   with order id as `event_id`, value/currency from the checkout, idempotent
   on replays). Shopify's sandboxed pixel runtime allows the plain `fetch`.

### WordPress

Paste the pixel snippet into `header.php` before `</head>` (Appearance →
Theme file editor) or any "insert headers" plugin field. WooCommerce purchase
events can be posted server-side from a `woocommerce_thankyou` hook using the
server-to-server call below.

## Server-to-server (full control)

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
