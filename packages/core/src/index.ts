// @engine/core — intake, classification, playbooks, guardrails, loop logic.
export * from "./ingestion.js";
export * from "./coverage.js";
export * from "./relayQueue.js";
export * from "./intake/index.js";
export * from "./classify/classifier.js";
export * from "./classify/eventSelection.js";
export * from "./classify/spec.js";
export * from "./classify/launchGate.js";
export * from "./playbooks/index.js";
export * from "./creative/policy.js";
export * from "./creative/scoring.js";
export * from "./creative/generate.js";

export const CORE_VERSION = "0.1.0";
