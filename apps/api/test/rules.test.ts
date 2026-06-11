// W9: rules CRUD — validation through the shared schema; toggle and delete.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { closeDb, createRepos, type Db, type Repos } from "@engine/db";
import { resetTestDb } from "@engine/db/src/testing.js";
import { buildApp } from "../src/app.js";

let db: Db;
let repos: Repos;
let app: FastifyInstance;

beforeAll(async () => {
  db = await resetTestDb();
  repos = createRepos(db);
  app = await buildApp({ db, jobs: null });
}, 30_000);

afterAll(async () => {
  await app.close();
  await closeDb(db);
});

describe("automation rules API (W9)", () => {
  it("create → list → toggle → delete", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/internal/rules",
      payload: {
        name: "Cap the burn",
        metric: "cost_per_result",
        window_days: 3,
        comparator: "gt",
        threshold: 50,
        action: "pause",
      },
    });
    expect(created.statusCode).toBe(201);
    const { id } = created.json() as { id: string };

    const listed = await app.inject({ method: "GET", url: "/internal/rules" });
    const rules = (listed.json() as { rules: { id: string; enabled: boolean; threshold: number }[] }).rules;
    expect(rules.some((r) => r.id === id && r.enabled && r.threshold === 50)).toBe(true);

    const toggled = await app.inject({
      method: "PATCH",
      url: `/internal/rules/${id}`,
      payload: { enabled: false },
    });
    expect(toggled.statusCode).toBe(200);
    expect((await repos.automationRules.list()).find((r) => r.id === id)?.enabled).toBe(false);

    const deleted = await app.inject({ method: "DELETE", url: `/internal/rules/${id}` });
    expect(deleted.statusCode).toBe(200);
    expect((await repos.automationRules.list()).some((r) => r.id === id)).toBe(false);
  });

  it("rejects bad metric / window / scope combinations", async () => {
    for (const payload of [
      { name: "x", metric: "clicks", window_days: 3, comparator: "gt", threshold: 1, action: "pause" },
      { name: "x", metric: "spend", window_days: 4, comparator: "gt", threshold: 1, action: "pause" },
      { name: "x", metric: "spend", window_days: 3, comparator: "gt", threshold: 1, action: "pause", scope: "product" },
      { name: "x", metric: "spend", window_days: 3, comparator: "gt", threshold: -5, action: "pause" },
    ]) {
      const res = await app.inject({ method: "POST", url: "/internal/rules", payload });
      expect(res.statusCode).toBe(400);
    }
  });
});
