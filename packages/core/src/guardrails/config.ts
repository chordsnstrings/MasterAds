// Guardrail configuration (SW §10.2): hard constraints, stored in
// system_settings under "guardrails", with safe defaults from first boot.
import { z } from "zod";
import type { Repos } from "@engine/db";

export const guardrailConfigSchema = z.object({
  currency: z.string().default("AED"),
  /** Spend caps (per day). */
  perCampaignDailyCap: z.number().positive().default(1000),
  perVerticalDailyCap: z.number().positive().default(3000),
  globalDailyCap: z.number().positive().default(5000),
  /** Max budget change per step, as a percentage of the current budget. */
  maxBudgetChangePct: z.number().positive().default(30),
  /** Change-frequency limit: min hours between changes to the same object. */
  minChangeIntervalHours: z.number().positive().default(6),
  /** Blast radius: max objects one decision may touch. */
  maxObjectsPerDecision: z.number().int().positive().default(5),
  /** Operating-cost caps (USD, AI inference). */
  operatingCostDailyCapUsd: z.number().positive().default(50),
  perProductOperatingCostDailyCapUsd: z.number().positive().default(10),
  /** New-account warm-up (G9): max daily-budget growth on young accounts. */
  warmupAccountAgeDays: z.number().positive().default(30),
  warmupMaxDailyBudget: z.number().positive().default(400),
});

export type GuardrailConfig = z.infer<typeof guardrailConfigSchema>;

export const DEFAULT_GUARDRAILS: GuardrailConfig = guardrailConfigSchema.parse({});

export async function getGuardrailConfig(repos: Repos): Promise<GuardrailConfig> {
  const stored = await repos.settings.get<Partial<GuardrailConfig>>("guardrails");
  return guardrailConfigSchema.parse({ ...DEFAULT_GUARDRAILS, ...(stored ?? {}) });
}

export async function setGuardrailConfig(
  repos: Repos,
  patch: Partial<GuardrailConfig>,
): Promise<GuardrailConfig> {
  const next = guardrailConfigSchema.parse({ ...(await getGuardrailConfig(repos)), ...patch });
  await repos.settings.set("guardrails", next);
  return next;
}
