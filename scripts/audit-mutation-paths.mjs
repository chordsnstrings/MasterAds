#!/usr/bin/env node
// Mutation-path audit (GATE G8): statically prove that no adapter write is
// reachable except through the guardrail layer.
//
// Checks (over src/ code only — tests may exercise internals):
//  1. `approveAction(` is invoked ONLY inside packages/core/src/guardrails/
//     (the approval brand cannot be minted anywhere else).
//  2. Every write method in packages/adapters/src/platforms.ts guards with
//     assertApproved + kill switch via the shared preWrite.
//  3. No file outside packages/adapters/src calls platform write endpoints
//     directly (graph.facebook.com / googleads / business-api.tiktok.com).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC_ROOTS = [
  "packages/contracts/src",
  "packages/db/src",
  "packages/core/src",
  "packages/adapters/src",
  "apps/api/src",
  "apps/loops/src",
  "apps/scheduler/src",
  "apps/web/src",
];

function* walk(dir) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|mts)$/.test(p)) yield p;
  }
}

const failures = [];

// 1. approveAction invocations only in the guardrail layer.
const APPROVE_ALLOWED = [
  "packages/core/src/guardrails/approval.ts",
  "packages/core/src/guardrails/execute.ts",
];
for (const root of SRC_ROOTS) {
  for (const file of walk(root)) {
    const content = readFileSync(file, "utf8");
    // invocation, not import/export/type reference
    if (/(?<!["'`\w])approveAction\s*\(/.test(content) && !APPROVE_ALLOWED.includes(file)) {
      // ignore import lines
      const lines = content.split("\n").filter(
        (l) => /approveAction\s*\(/.test(l) && !/^\s*(import|export)/.test(l) && !l.trim().startsWith("//") && !l.trim().startsWith("*"),
      );
      if (lines.length > 0) {
        failures.push(`${file}: approveAction() invoked outside the guardrail layer`);
      }
    }
  }
}

// 2. Adapter writes guard with assertApproved + kill switch.
const platforms = readFileSync("packages/adapters/src/platforms.ts", "utf8");
if (!/assertApproved\(action\)/.test(platforms)) {
  failures.push("platforms.ts: preWrite no longer calls assertApproved");
}
if (!/killSwitch\.isEngaged\(\)/.test(platforms)) {
  failures.push("platforms.ts: preWrite no longer checks the kill switch");
}
const writeMethods = ["createCampaign", "updateCampaign", "pauseCampaign", "resumeCampaign", "duplicateCampaign", "uploadCreative"];
for (const m of writeMethods) {
  const re = new RegExp(`async ${m}\\(approved\\)\\s*\\{\\s*\\n?\\s*await preWrite\\(approved\\);`);
  if (!re.test(platforms)) {
    failures.push(`platforms.ts: write method ${m} does not start with preWrite(approved)`);
  }
}

// 3. Platform write endpoints only inside packages/adapters/src.
const ENDPOINT_RE = /(graph\.facebook\.com|googleads\.googleapis\.com|business-api\.tiktok\.com)/;
for (const root of SRC_ROOTS) {
  if (root === "packages/adapters/src") continue;
  for (const file of walk(root)) {
    if (ENDPOINT_RE.test(readFileSync(file, "utf8"))) {
      failures.push(`${file}: direct platform endpoint reference outside packages/adapters`);
    }
  }
}

if (failures.length > 0) {
  console.error("mutation-path audit FAILED:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
console.log("mutation-path audit: clean (adapter writes reachable only via guardrail-approved actions)");
