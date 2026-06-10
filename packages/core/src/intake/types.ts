// Product intake (SW §5.1, FLOW §3-4): three ways in, one canonical shape out.

/** Normalized product fields prior to persistence. */
export interface NormalizedProduct {
  mode: "catalog" | "offer";
  title: string;
  description?: string;
  price?: number;
  currency?: string;
  url?: string;
  images: string[];
  category?: string;
  availability: "in_stock" | "out_of_stock" | "unknown";
  sourceRef: string;
  rawInput?: string;
  externalId?: string;
}

/** Intake never crashes: failures are a typed result with the next move. */
export type IntakeResult =
  | { kind: "product"; product: NormalizedProduct }
  | { kind: "products"; products: NormalizedProduct[] }
  | { kind: "unreadable"; reason: string; suggestion: string };

export type InputKind = "url" | "text" | "file";

/** A pasted URL is read as a link; anything else typed is a description. */
export function detectInputKind(input: string): "url" | "text" {
  const trimmed = input.trim();
  if (/^https?:\/\/\S+$/i.test(trimmed)) return "url";
  if (/^www\.\S+\.\S+$/i.test(trimmed)) return "url";
  return "text";
}
