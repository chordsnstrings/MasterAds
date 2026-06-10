// Persist intake results as canonical Product rows; drive async intake jobs
// whose "reading…" status the UI polls (FLOW §4.4).
import type { Product, Repos } from "@engine/db";
import { newId } from "@engine/db";
import { intakeFromFeed } from "./feed.js";
import { intakeFromText } from "./text.js";
import { intakeFromUrl, type Fetcher } from "./url.js";
import { detectInputKind, type IntakeResult, type NormalizedProduct } from "./types.js";

async function insertProduct(
  repos: Repos,
  p: NormalizedProduct,
  catalogGroupId?: string,
): Promise<Product> {
  return repos.products.insert({
    mode: p.mode,
    title: p.title,
    description: p.description ?? null,
    price: p.price !== undefined ? p.price.toFixed(4) : null,
    currency: p.currency ?? null,
    url: p.url ?? null,
    images: p.images,
    category: p.category ?? null,
    availability: p.availability,
    status: "draft",
    sourceRef: p.sourceRef,
    rawInput: p.rawInput ?? null,
    catalogGroupId: catalogGroupId ?? null,
  });
}

export interface PersistedIntake {
  result: IntakeResult;
  productIds: string[];
  catalogGroupId?: string;
}

export async function persistIntakeResult(
  repos: Repos,
  result: IntakeResult,
): Promise<PersistedIntake> {
  if (result.kind === "unreadable") return { result, productIds: [] };
  if (result.kind === "product") {
    const row = await insertProduct(repos, result.product);
    return { result, productIds: [row.id] };
  }
  const catalogGroupId = newId("cat");
  const ids: string[] = [];
  for (const p of result.products) {
    const row = await insertProduct(repos, p, catalogGroupId);
    ids.push(row.id);
  }
  return { result, productIds: ids, catalogGroupId };
}

/** Execute one intake job end to end and complete its status row. */
export async function runIntakeJob(
  repos: Repos,
  jobId: string,
  opts: { fetcher?: Fetcher; fileContent?: Buffer } = {},
): Promise<void> {
  const job = await repos.intakeJobs.get(jobId);
  if (!job || job.status !== "reading") return;
  let result: IntakeResult;
  if (job.kind === "url") {
    result = await intakeFromUrl(job.input, opts.fetcher);
  } else if (job.kind === "text") {
    result = intakeFromText(job.input);
  } else {
    result = intakeFromFeed(opts.fileContent ?? Buffer.from(""), job.input);
  }
  const persisted = await persistIntakeResult(repos, result);
  await repos.intakeJobs.complete(
    jobId,
    result.kind === "unreadable" ? "unreadable" : "done",
    {
      kind: result.kind,
      suggestion: result.kind === "unreadable" ? result.suggestion : undefined,
      productIds: persisted.productIds,
      catalogGroupId: persisted.catalogGroupId,
      productCount: persisted.productIds.length,
    },
  );
}

export { detectInputKind };
