// Operator notifications (W5, FLOW §8.6): attention alerts, restricted
// sign-off confirmation ("your ads are approved"), weekly digest. Rows are
// queued in the notifications outbox (deduped) and dispatched through the
// email adapter — plain language only, no platform jargon (invariant 7).
import type { Repos } from "@engine/db";

export interface NotificationEmailer {
  send(message: { to: string; subject: string; body: string }): Promise<void>;
}

export function operatorEmail(): string {
  return process.env.OPERATOR_EMAIL ?? "operator@localhost";
}

/** Queue alerts for open attention items that need a person (error/approval). */
export async function queueAttentionNotifications(
  repos: Repos,
): Promise<{ queued: number }> {
  const open = await repos.attention.listOpen();
  let queued = 0;
  for (const item of open) {
    if (item.severity !== "error" && item.severity !== "approval") continue;
    const row = await repos.notifications.queue({
      kind: "attention",
      dedupKey: `attention:${item.id}`,
      subject:
        item.severity === "approval"
          ? "Something is waiting for your approval"
          : "Something needs your attention",
      body: `${item.message}${item.fixHint ? `\n\nWhat to do: ${item.fixHint}` : ""}\n\nOpen the Overview screen to act on this.`,
    });
    if (row) queued += 1;
  }
  return { queued };
}

/** FLOW §8.6: the user is emailed when reviewed ads are approved to run. */
export async function queueSignoffNotification(
  repos: Repos,
  playbook: { id: string; vertical: string },
): Promise<void> {
  await repos.notifications.queue({
    kind: "ads_approved",
    dedupKey: `signoff:${playbook.id}`,
    subject: "Your ads are approved",
    body:
      "Good news — the ads that were waiting for review have been approved and can now start running. " +
      "You can follow their progress on the Overview screen.",
  });
}

function isoWeekKey(date = new Date()): string {
  // ISO week number (Thursday trick) so one digest per calendar week.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-w${String(week).padStart(2, "0")}`;
}

/** Queue the weekly results summary (deduped per ISO week). */
export async function queueWeeklyDigest(
  repos: Repos,
  now = new Date(),
): Promise<{ queued: boolean }> {
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const products = await repos.products.list();
  if (products.length === 0) return { queued: false };
  const conversions = await repos.conversions.listCanonicalSince(since);
  const revenue = conversions.reduce((s, e) => s + (e.value !== null ? Number(e.value) : 0), 0);
  const { adSpend, operatingCost } = await repos.costs.globalSums(since);
  const totalCost = adSpend + operatingCost;
  const netReturn = totalCost > 0 ? revenue / totalCost : null;
  const open = await repos.attention.listOpen();

  const lines = [
    "Your week at a glance:",
    "",
    `Products advertised: ${products.length}`,
    `Results this week: ${conversions.length}`,
    `Spend this week: ${adSpend.toFixed(2)}`,
    `Running cost this week: ${operatingCost.toFixed(2)}`,
    netReturn !== null
      ? `Net return: ${netReturn.toFixed(1)}× (money back per unit of total cost)`
      : "Net return: not enough data yet",
    open.length > 0
      ? `Items waiting for you: ${open.length} — see the Overview screen`
      : "Nothing is waiting on you right now.",
  ];
  const row = await repos.notifications.queue({
    kind: "weekly_digest",
    dedupKey: `digest:${isoWeekKey(now)}`,
    subject: "Your weekly results summary",
    body: lines.join("\n"),
  });
  return { queued: row !== undefined };
}

/** Send pending outbox rows through the email adapter. */
export async function dispatchNotifications(
  repos: Repos,
  email: NotificationEmailer,
  to = operatorEmail(),
): Promise<{ sent: number; failed: number }> {
  const pending = await repos.notifications.listPending();
  let sent = 0;
  let failed = 0;
  for (const n of pending) {
    try {
      await email.send({ to, subject: n.subject, body: n.body });
      await repos.notifications.markSent(n.id);
      sent += 1;
    } catch (err) {
      await repos.notifications.markFailed(n.id, String(err));
      failed += 1;
    }
  }
  return { sent, failed };
}
