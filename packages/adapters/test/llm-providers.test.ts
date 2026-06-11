// Multi-provider LLM driver: provider/pricing resolution, live-mode key
// guards, and the CostEvent invariant across providers (no network calls).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createRepos, type Db, type Repos } from "@engine/db";
import { resetTestDb } from "@engine/db/src/testing.js";
import { createLlmClient, resolveProviderConfig } from "../src/index.js";

let db: Db;
let repos: Repos;

beforeAll(async () => {
  db = await resetTestDb();
  repos = createRepos(db);
}, 30_000);

afterAll(async () => {
  await closeDb(db);
});

describe("provider configuration", () => {
  it("defaults to anthropic with claude-sonnet-4-6 at $3/$15 per MTok", () => {
    const c = resolveProviderConfig({});
    expect(c.provider).toBe("anthropic");
    expect(c.model).toBe("claude-sonnet-4-6");
    expect(c.inputPricePerTok).toBeCloseTo(3 / 1_000_000);
    expect(c.outputPricePerTok).toBeCloseTo(15 / 1_000_000);
  });

  it("resolves openai, deepseek and llama with their endpoints and models", () => {
    const openai = resolveProviderConfig({ LLM_PROVIDER: "openai" });
    expect(openai.baseUrl).toBe("https://api.openai.com/v1");
    expect(openai.model).toBe("gpt-4o-mini");

    const deepseek = resolveProviderConfig({ LLM_PROVIDER: "deepseek" });
    expect(deepseek.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(deepseek.model).toBe("deepseek-chat");

    const llama = resolveProviderConfig({
      LLM_PROVIDER: "llama",
      LLAMA_BASE_URL: "https://api.groq.com/openai/v1",
      LLAMA_MODEL: "llama-3.3-70b-versatile",
    });
    expect(llama.baseUrl).toBe("https://api.groq.com/openai/v1");
    expect(llama.model).toBe("llama-3.3-70b-versatile");
  });

  it("price overrides apply to whichever provider is active", () => {
    const c = resolveProviderConfig({
      LLM_PROVIDER: "deepseek",
      LLM_INPUT_PRICE_PER_MTOK: "0.5",
      LLM_OUTPUT_PRICE_PER_MTOK: "2",
    });
    expect(c.inputPricePerTok).toBeCloseTo(0.5 / 1_000_000);
    expect(c.outputPricePerTok).toBeCloseTo(2 / 1_000_000);
  });

  it("rejects unknown providers", () => {
    expect(() => resolveProviderConfig({ LLM_PROVIDER: "gemini" })).toThrow(/unknown LLM_PROVIDER/);
  });
});

describe("live-mode guards (no network)", () => {
  it("openai/deepseek without an API key fail fast with the env var named", async () => {
    delete process.env.OPENAI_API_KEY;
    const client = createLlmClient({ repos, mode: "live", provider: "openai" });
    await expect(
      client.complete({ operation: "classification", prompt: "x" }),
    ).rejects.toThrow(/OPENAI_API_KEY required/);

    delete process.env.DEEPSEEK_API_KEY;
    const ds = createLlmClient({ repos, mode: "live", provider: "deepseek" });
    await expect(ds.complete({ operation: "classification", prompt: "x" })).rejects.toThrow(
      /DEEPSEEK_API_KEY required/,
    );
  });

  it("llama without a base URL fails fast (key optional for local endpoints)", async () => {
    delete process.env.LLAMA_BASE_URL;
    delete process.env.LLAMA_API_KEY;
    const client = createLlmClient({ repos, mode: "live", provider: "llama" });
    await expect(client.complete({ operation: "narration", prompt: "x" })).rejects.toThrow(
      /base URL/,
    );
  });
});

describe("stub mode is provider-independent and still meters every call", () => {
  it("emits an ai_inference CostEvent regardless of configured provider", async () => {
    const before = (await repos.costs.list({ costType: "ai_inference" })).length;
    const client = createLlmClient({ repos, mode: "stub", provider: "openai" });
    const res = await client.complete({
      operation: "classification",
      prompt: "title: Sofa\ndescription: a comfy sofa\nmode: catalog",
    });
    expect(res.text).toContain("ecommerce_physical_goods");
    const after = await repos.costs.list({ costType: "ai_inference" });
    expect(after.length).toBe(before + 1);
    expect(Number(after[0]?.amount)).toBeGreaterThan(0);
  });
});
