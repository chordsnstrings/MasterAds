// @engine/adapters — platform, LLM, creative, billing adapters (stub/live drivers).
export * from "./relay/index.js";
export { driverMode, type DriverMode } from "./env.js";
export {
  createCreativeProvider,
  FORMAT_DIMENSIONS,
  type CreativeProvider,
  type GeneratedAsset,
  type ImageBrief,
  type VideoBrief,
} from "./creative.js";
export {
  createLlmClient,
  type LlmClient,
  type LlmOperation,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type StubResponder,
  resolveProviderConfig,
} from "./llm.js";

export const ADAPTERS_VERSION = "0.1.0";
export { createPlatformAdapters, createMetaPlatform, createGooglePlatform, createTikTokPlatform, type PlatformAdapter, type InsightsReport, type PlatformAdapterOptions } from "./platforms.js";
export { createBillingChecker, type BillingChecker, type BillingHealth } from "./billing.js";
