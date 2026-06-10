import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { closeDb, type Db } from "@engine/db";
import { resetTestDb } from "@engine/db/src/testing.js";
import { buildApp } from "../src/app.js";

let db: Db;
let app: FastifyInstance;

beforeAll(async () => {
  db = await resetTestDb();
  app = await buildApp({ db });
}, 30_000);

afterAll(async () => {
  await app.close();
  await closeDb(db);
});

describe("api skeleton", () => {
  it("responds on /health", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok" });
  });
});
