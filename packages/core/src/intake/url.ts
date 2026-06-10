// URL intake: fetch + extract title, images, price, description.
// Resilient to failure with a typed "couldn't read" result — never a crash.
import * as cheerio from "cheerio";
import type { IntakeResult, NormalizedProduct } from "./types.js";

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text: string }>;

const defaultFetcher: Fetcher = async (url) => {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "ad-engine-intake/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  return { ok: res.ok, status: res.status, text: res.ok ? await res.text() : "" };
};

const UNREADABLE: IntakeResult = {
  kind: "unreadable",
  reason: "link_unreadable",
  suggestion: "We couldn't open that link. Tell us what you sell instead.",
};

function parsePrice(raw: string | undefined): { price?: number; currency?: string } {
  if (!raw) return {};
  const currencyMatch = raw.match(/\b(AED|USD|EUR|GBP|SAR|QAR|KWD|BHD|OMR|EGP|INR)\b/i);
  const numMatch = raw.replace(/[,\s]/g, "").match(/(\d+(?:\.\d+)?)/);
  return {
    price: numMatch ? Number(numMatch[1]) : undefined,
    currency: currencyMatch ? currencyMatch[1]!.toUpperCase() : undefined,
  };
}

/** Pure extraction from HTML — used directly by fixture tests. */
export function extractProductFromHtml(html: string, url: string): IntakeResult {
  const $ = cheerio.load(html);

  // JSON-LD Product blocks are the highest-fidelity source.
  let ld: Record<string, unknown> | undefined;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).text()) as Record<string, unknown> | Record<string, unknown>[];
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item["@type"] === "Product") ld = item;
      }
    } catch {
      /* tolerate malformed blocks */
    }
  });

  const ldOffer = (ld?.offers ?? {}) as Record<string, unknown>;
  const title =
    (ld?.name as string | undefined) ??
    $('meta[property="og:title"]').attr("content") ??
    $("title").first().text().trim() ??
    "";
  if (!title) return UNREADABLE;

  const description =
    (ld?.description as string | undefined) ??
    $('meta[property="og:description"]').attr("content") ??
    $('meta[name="description"]').attr("content") ??
    undefined;

  const images: string[] = [];
  const ldImage = ld?.image;
  if (typeof ldImage === "string") images.push(ldImage);
  if (Array.isArray(ldImage)) images.push(...ldImage.filter((i): i is string => typeof i === "string"));
  const ogImage = $('meta[property="og:image"]').attr("content");
  if (ogImage && !images.includes(ogImage)) images.push(ogImage);

  let price: number | undefined;
  let currency: string | undefined;
  if (ldOffer.price !== undefined) {
    price = Number(ldOffer.price);
    currency = typeof ldOffer.priceCurrency === "string" ? ldOffer.priceCurrency : undefined;
  } else {
    const metaPrice =
      $('meta[property="product:price:amount"]').attr("content") ??
      $('meta[property="og:price:amount"]').attr("content");
    const metaCurrency =
      $('meta[property="product:price:currency"]').attr("content") ??
      $('meta[property="og:price:currency"]').attr("content");
    if (metaPrice) {
      price = Number(metaPrice);
      currency = metaCurrency ?? undefined;
    } else {
      const text = $('[class*="price" i]').first().text() || $("body").text().slice(0, 2000);
      const parsed = parsePrice(text);
      price = parsed.price;
      currency = parsed.currency;
    }
  }

  const availabilityRaw = String(ldOffer.availability ?? "").toLowerCase();
  const availability: NormalizedProduct["availability"] = availabilityRaw.includes("outofstock")
    ? "out_of_stock"
    : availabilityRaw.includes("instock")
      ? "in_stock"
      : "unknown";

  return {
    kind: "product",
    product: {
      mode: "catalog",
      title: title.trim(),
      description: description?.trim(),
      price: Number.isFinite(price) ? price : undefined,
      currency,
      url,
      images,
      availability,
      sourceRef: url,
    },
  };
}

export async function intakeFromUrl(
  rawUrl: string,
  fetcher: Fetcher = defaultFetcher,
): Promise<IntakeResult> {
  const url = /^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`;
  try {
    const res = await fetcher(url);
    if (!res.ok || !res.text) return UNREADABLE;
    return extractProductFromHtml(res.text, url);
  } catch {
    return UNREADABLE;
  }
}
