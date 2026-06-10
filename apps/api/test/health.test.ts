import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("api skeleton", () => {
  it("responds on /health", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok" });
    await app.close();
  });
});
