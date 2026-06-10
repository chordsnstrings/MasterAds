export type DriverMode = "stub" | "live";

export function driverMode(envVar: string): DriverMode {
  const v = process.env[envVar];
  if (v === "live") return "live";
  return "stub";
}
