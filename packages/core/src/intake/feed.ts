// Feed-file intake: CSV/XLSX parse with tolerant column mapping, multi-product
// result under one catalog group (FLOW §7).
import { parse as parseCsv } from "csv-parse/sync";
import * as XLSX from "xlsx";
import type { IntakeResult, NormalizedProduct } from "./types.js";

const COLUMN_ALIASES: Record<string, keyof FeedRow> = {
  title: "title",
  name: "title",
  product: "title",
  product_name: "title",
  item: "title",
  description: "description",
  desc: "description",
  details: "description",
  price: "price",
  amount: "price",
  cost: "price",
  sale_price: "price",
  currency: "currency",
  url: "url",
  link: "url",
  product_url: "url",
  image: "image",
  image_url: "image",
  image_link: "image",
  picture: "image",
  category: "category",
  type: "category",
  availability: "availability",
  stock: "availability",
  in_stock: "availability",
  status: "availability",
  id: "externalId",
  sku: "externalId",
  product_id: "externalId",
  content_id: "externalId",
};

interface FeedRow {
  title?: string;
  description?: string;
  price?: string;
  currency?: string;
  url?: string;
  image?: string;
  category?: string;
  availability?: string;
  externalId?: string;
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function mapRow(raw: Record<string, string>): FeedRow {
  const row: FeedRow = {};
  for (const [key, value] of Object.entries(raw)) {
    const target = COLUMN_ALIASES[normalizeHeader(key)];
    if (target && value !== undefined && String(value).trim() !== "") {
      row[target] = String(value).trim();
    }
  }
  return row;
}

function parseAvailability(raw: string | undefined): NormalizedProduct["availability"] {
  if (raw === undefined) return "in_stock";
  const v = raw.toLowerCase();
  if (["0", "no", "false", "out", "out_of_stock", "out of stock", "oos"].includes(v))
    return "out_of_stock";
  if (/^\d+$/.test(v)) return Number(v) > 0 ? "in_stock" : "out_of_stock";
  return "in_stock";
}

export function rowsToProducts(rows: Record<string, string>[], sourceRef: string): NormalizedProduct[] {
  const products: NormalizedProduct[] = [];
  for (const raw of rows) {
    const row = mapRow(raw);
    if (!row.title) continue;
    products.push({
      mode: "catalog",
      title: row.title,
      description: row.description,
      price: row.price !== undefined ? Number(row.price.replace(/[^\d.]/g, "")) : undefined,
      currency: row.currency?.toUpperCase(),
      url: row.url,
      images: row.image ? [row.image] : [],
      category: row.category,
      availability: parseAvailability(row.availability),
      sourceRef,
      externalId: row.externalId,
    });
  }
  return products;
}

export function intakeFromFeed(
  content: Buffer | string,
  filename: string,
): IntakeResult {
  try {
    let rows: Record<string, string>[];
    if (/\.xlsx?$/i.test(filename)) {
      const wb = XLSX.read(content, { type: typeof content === "string" ? "string" : "buffer" });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) throw new Error("empty workbook");
      rows = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets[sheetName]!, {
        raw: false,
        defval: "",
      });
    } else {
      rows = parseCsv(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      }) as Record<string, string>[];
    }
    const products = rowsToProducts(rows, filename);
    if (products.length === 0) {
      return {
        kind: "unreadable",
        reason: "no_products_found",
        suggestion:
          "We couldn't read that file. You can describe what you sell, or connect your store instead.",
      };
    }
    return { kind: "products", products };
  } catch {
    return {
      kind: "unreadable",
      reason: "file_unreadable",
      suggestion:
        "We couldn't read that file. You can describe what you sell, or connect your store instead.",
    };
  }
}
