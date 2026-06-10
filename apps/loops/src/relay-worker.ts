// Conversion relay worker (SW §7.2, GOALS G3): consumes relay queues, sends
// through the platform relay adapters, tracks per-event relay status on
// conversion_events.relayed_to, retries with backoff via pg-boss, dead-letters
// after max attempts, and raises an attention record on dead-letter.
import type PgBoss from "pg-boss";
import type { ConversionRelay } from "@engine/adapters";
import { relayQueueName, type RelayJobData } from "@engine/core";
import type { RelayRecord, Repos } from "@engine/db";

export interface RelayWorkerOptions {
  /** Total attempts before dead-letter (default 4). */
  maxAttempts?: number;
  /** pg-boss retry delay seconds (default 5, exponential backoff). */
  retryDelaySeconds?: number;
  pollingIntervalSeconds?: number;
}

function log(msg: string, extra: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: "loops", msg, ...extra }));
}

export async function handleRelayJob(
  boss: Pick<PgBoss, "send">,
  repos: Repos,
  relay: ConversionRelay,
  eventId: string,
  opts: RelayWorkerOptions = {},
): Promise<void> {
  const maxAttempts = opts.maxAttempts ?? 4;

  // Kill switch halts all platform writes (invariant 2): park the job, retry later.
  if (await repos.killSwitch.isEngaged()) {
    log("relay parked: kill switch engaged", { platform: relay.platform, eventId });
    await boss.send(relayQueueName(relay.platform), { eventId }, { startAfter: 30 });
    return;
  }

  const event = await repos.conversions.get(eventId);
  if (!event) {
    log("relay job for unknown event", { platform: relay.platform, eventId });
    return;
  }

  const records: RelayRecord[] = event.relayedTo.filter((r) => r.platform !== relay.platform);
  const existing = event.relayedTo.find((r) => r.platform === relay.platform);
  const rec: RelayRecord = existing ?? {
    platform: relay.platform,
    status: "pending",
    attempts: 0,
    at: new Date().toISOString(),
  };
  // Idempotent: terminal statuses are never re-sent by the queue path.
  if (rec.status === "sent" || rec.status === "skipped" || rec.status === "dead_letter") return;

  const built = relay.buildPayload(event);
  if (built.kind === "skip") {
    rec.status = "skipped";
    rec.lastError = built.reason;
    rec.at = new Date().toISOString();
    await repos.conversions.setRelayedTo(event.id, [...records, rec]);
    return;
  }

  try {
    await relay.send(built.payload);
    rec.status = "sent";
    rec.attempts += 1;
    rec.at = new Date().toISOString();
    delete rec.lastError;
    await repos.conversions.setRelayedTo(event.id, [...records, rec]);
  } catch (err) {
    rec.attempts += 1;
    rec.lastError = String(err);
    rec.at = new Date().toISOString();
    log("relay send failed", {
      platform: relay.platform,
      eventId,
      attempt: rec.attempts,
      error: rec.lastError,
    });
    if (rec.attempts >= maxAttempts) {
      rec.status = "dead_letter";
      await repos.conversions.setRelayedTo(event.id, [...records, rec]);
      log("relay dead-lettered", { platform: relay.platform, eventId, attempts: rec.attempts });
      await repos.attention.raise({
        kind: "relay_failure",
        severity: "error",
        message: `Results stopped reaching one of your channels (${relay.platform}). Recent results are queued and will be sent once the connection recovers.`,
        fixHint: "Check the connection in Settings, then replay the affected window.",
        targetRef: `platform:${relay.platform}`,
      });
      return; // consume the job; replay command can resurrect
    }
    rec.status = "failed";
    await repos.conversions.setRelayedTo(event.id, [...records, rec]);
    throw err; // pg-boss retries with backoff
  }
}

export async function startRelayWorker(
  boss: PgBoss,
  repos: Repos,
  relays: ConversionRelay[],
  opts: RelayWorkerOptions = {},
): Promise<void> {
  for (const relay of relays) {
    const queue = relayQueueName(relay.platform);
    await boss.createQueue(queue, {
      name: queue,
      retryLimit: (opts.maxAttempts ?? 4) + 1,
      retryDelay: opts.retryDelaySeconds ?? 5,
      retryBackoff: true,
    });
    await boss.work<RelayJobData>(
      queue,
      { pollingIntervalSeconds: opts.pollingIntervalSeconds ?? 2 },
      async (jobs) => {
        for (const job of jobs) {
          if (job.data.traceId) {
            log("relay job", { platform: relay.platform, eventId: job.data.eventId, traceId: job.data.traceId });
          }
          await handleRelayJob(boss, repos, relay, job.data.eventId, opts);
        }
      },
    );
  }
}

/** Replay/backfill (SW self-healing): re-relay canonical events in a window. */
export async function replayWindow(
  boss: Pick<PgBoss, "send">,
  repos: Repos,
  args: { from: Date; to: Date; platform?: "meta" | "google" | "tiktok" },
): Promise<number> {
  const events = await repos.conversions.listWindow(args.from, args.to);
  let enqueued = 0;
  for (const event of events) {
    if (!event.canonical) continue;
    const platforms = args.platform ? [args.platform] : (["meta", "google", "tiktok"] as const);
    const kept = event.relayedTo.filter(
      (r) => !platforms.includes(r.platform as (typeof platforms)[number]),
    );
    await repos.conversions.setRelayedTo(event.id, kept); // reset → eligible again
    for (const platform of platforms) {
      await boss.send(relayQueueName(platform), { eventId: event.id } satisfies RelayJobData);
      enqueued++;
    }
  }
  log("replay enqueued", { from: args.from.toISOString(), to: args.to.toISOString(), enqueued });
  return enqueued;
}
