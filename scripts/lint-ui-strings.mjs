#!/usr/bin/env node
// Lints all user-facing string modules against the banned platform-jargon list
// (CLAUDE.md invariant 7; UX §11; FLOW §11-12). User-facing strings live ONLY in
// files named `strings*.ts(x)` under apps/web/src and packages/core/src — this
// script scans every such file and fails on any banned term.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["apps/web/src", "packages/core/src"];

// Word-boundary terms. Case-insensitive.
const BANNED = [
  "campaign",
  "ad set",
  "adset",
  "ad group",
  "objective",
  "pixel",
  "cbo",
  "placement",
  "lookalike",
  "bid",
  "bidding",
  "token",
  "capi",
  "roas",
  "learning phase",
  "conversions api",
  "optimization event",
  "conversion event",
  "attribution",
  "retargeting",
  "audience",
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
    else yield p;
  }
}

const failures = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (!/strings[^/]*\.(ts|tsx)$/.test(file)) continue;
    const content = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const lines = content.split("\n");
    lines.forEach((line, i) => {
      for (const term of BANNED) {
        const re = new RegExp(`\\b${term.replace(/ /g, "\\s+")}s?\\b`, "i");
        if (re.test(line)) {
          failures.push(`${file}:${i + 1} contains banned term "${term}": ${line.trim()}`);
        }
      }
    });
  }
}

if (failures.length > 0) {
  console.error("Banned platform jargon found in UI strings:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("ui-strings lint: clean");
