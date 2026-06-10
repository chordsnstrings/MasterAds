// Creative generation provider adapter (stub/live driver, invariant 10).
// Every generation call writes an ai_inference CostEvent — enforced here in
// the adapter so it cannot be skipped (invariant 4).
import { createHash } from "node:crypto";
import type { Repos } from "@engine/db";
import { driverMode, type DriverMode } from "./env.js";

export type CreativeFormat = "1:1" | "9:16" | "16:9";

export const FORMAT_DIMENSIONS: Record<CreativeFormat, { width: number; height: number }> = {
  "1:1": { width: 1080, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
};

export interface ImageBrief {
  productId: string;
  prompt: string;
  format: CreativeFormat;
}

export interface VideoBrief {
  productId: string;
  prompt: string;
  format: CreativeFormat;
  durationSeconds: number;
}

export interface GeneratedAsset {
  assetRef: string;
  width: number;
  height: number;
  durationSeconds?: number;
}

export interface CreativeProvider {
  readonly mode: DriverMode;
  generateImage(brief: ImageBrief): Promise<GeneratedAsset>;
  generateVideo(brief: VideoBrief): Promise<GeneratedAsset>;
}

const IMAGE_PRICE_USD = 0.04;
const VIDEO_PRICE_PER_SECOND_USD = 0.1;

export function createCreativeProvider(opts: { repos: Repos; mode?: DriverMode }): CreativeProvider {
  const mode = opts.mode ?? driverMode("CREATIVE_MODE");
  const { repos } = opts;
  const provider = process.env.CREATIVE_PROVIDER ?? "stub-creative";

  return {
    mode,
    async generateImage(brief: ImageBrief): Promise<GeneratedAsset> {
      const { width, height } = FORMAT_DIMENSIONS[brief.format];
      let assetRef: string;
      if (mode === "stub") {
        const hash = createHash("sha256").update(brief.prompt).digest("hex").slice(0, 12);
        assetRef = `stub://image/${hash}/${width}x${height}`;
      } else {
        const apiKey = process.env.CREATIVE_API_KEY;
        if (!apiKey) throw new Error("CREATIVE_API_KEY required in live mode");
        // Documented contract (P4): POST {prompt, width, height} → {url}.
        const res = await fetch("https://api.creative-provider.example/v1/images", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ prompt: brief.prompt, width, height }),
        });
        if (!res.ok) throw new Error(`creative provider ${res.status}`);
        assetRef = ((await res.json()) as { url: string }).url;
      }
      await repos.costs.insert({
        costType: "ai_inference",
        operation: "creative_image",
        providerOrPlatform: mode === "stub" ? "stub-creative" : provider,
        model: mode === "stub" ? "stub-image-1" : (process.env.CREATIVE_IMAGE_MODEL ?? "image-1"),
        units: { images: 1 },
        unitPrice: IMAGE_PRICE_USD.toFixed(8),
        amount: IMAGE_PRICE_USD.toFixed(6),
        currency: "USD",
        productId: brief.productId,
        occurredAt: new Date(),
      });
      return { assetRef, width, height };
    },

    async generateVideo(brief: VideoBrief): Promise<GeneratedAsset> {
      const { width, height } = FORMAT_DIMENSIONS[brief.format];
      let assetRef: string;
      if (mode === "stub") {
        const hash = createHash("sha256").update(brief.prompt).digest("hex").slice(0, 12);
        assetRef = `stub://video/${hash}/${width}x${height}/${brief.durationSeconds}s`;
      } else {
        const apiKey = process.env.CREATIVE_API_KEY;
        if (!apiKey) throw new Error("CREATIVE_API_KEY required in live mode");
        const res = await fetch("https://api.creative-provider.example/v1/videos", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            prompt: brief.prompt,
            width,
            height,
            duration: brief.durationSeconds,
          }),
        });
        if (!res.ok) throw new Error(`creative provider ${res.status}`);
        assetRef = ((await res.json()) as { url: string }).url;
      }
      const amount = VIDEO_PRICE_PER_SECOND_USD * brief.durationSeconds;
      await repos.costs.insert({
        costType: "ai_inference",
        operation: "creative_video",
        providerOrPlatform: mode === "stub" ? "stub-creative" : provider,
        model: mode === "stub" ? "stub-video-1" : (process.env.CREATIVE_VIDEO_MODEL ?? "video-1"),
        units: { video_seconds: brief.durationSeconds },
        unitPrice: VIDEO_PRICE_PER_SECOND_USD.toFixed(8),
        amount: amount.toFixed(6),
        currency: "USD",
        productId: brief.productId,
        occurredAt: new Date(),
      });
      return { assetRef, width, height, durationSeconds: brief.durationSeconds };
    },
  };
}
