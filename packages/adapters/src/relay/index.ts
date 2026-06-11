export type { ConversionRelay, RelayBuildResult, Platform } from "./types.js";
export { createMetaRelay, metaCapiSchema } from "./meta.js";
export { createTikTokRelay, tiktokEventsSchema } from "./tiktok.js";
export { createGoogleRelay, googleConversionSchema } from "./google.js";
export { createSnapchatRelay, snapchatConversionSchema } from "./snapchat.js";
export { createPinterestRelay, pinterestEventsSchema } from "./pinterest.js";

import type { DriverMode } from "../env.js";
import { createGoogleRelay } from "./google.js";
import { createMetaRelay } from "./meta.js";
import { createPinterestRelay } from "./pinterest.js";
import { createSnapchatRelay } from "./snapchat.js";
import { createTikTokRelay } from "./tiktok.js";
import type { ConversionRelay } from "./types.js";

export function createRelays(opts?: { mode?: DriverMode }): ConversionRelay[] {
  return [
    createMetaRelay(opts),
    createGoogleRelay(opts),
    createTikTokRelay(opts),
    createSnapchatRelay(opts),
    createPinterestRelay(opts),
  ];
}
