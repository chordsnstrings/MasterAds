// Relay queue names + enqueue helper, shared by api (producer) and loops
// (consumer). Postgres-backed via pg-boss (SW §13.1); this module is
// queue-implementation-agnostic so core carries no pg-boss dependency.
export const RELAY_PLATFORMS = ["meta", "google", "tiktok", "snapchat", "pinterest"] as const;
export type RelayPlatform = (typeof RELAY_PLATFORMS)[number];

export function relayQueueName(platform: RelayPlatform): string {
  return `relay-${platform}`;
}

export interface JobSender {
  send(
    name: string,
    data: object,
    options?: { startAfter?: number },
  ): Promise<string | null>;
}

export interface RelayJobData {
  eventId: string;
  /** Trace id from the originating API request (request → queue → adapter). */
  traceId?: string;
}

/** Fan one ingested conversion out to all three platform relay queues. */
export async function enqueueRelay(
  sender: JobSender,
  eventId: string,
  traceId?: string,
): Promise<void> {
  for (const platform of RELAY_PLATFORMS) {
    await sender.send(relayQueueName(platform), { eventId, traceId } satisfies RelayJobData);
  }
}
