// Component library (UX §9) — calm instrument surface, monospace numerics.
import { useState, type ReactNode } from "react";
import { STRINGS } from "./strings";
import type { ActivityEntry, AttentionItem } from "./api";

export function Money({ value, currency }: { value: number; currency?: string }): JSX.Element {
  const cur = currency ?? STRINGS.common.currency;
  const formatted =
    value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(value < 10 && value > 0 ? 2 : 0);
  return (
    <span className="font-mono tabular-nums">
      {cur} {formatted}
    </span>
  );
}

export function Num({ value }: { value: number | string }): JSX.Element {
  return <span className="font-mono tabular-nums">{value}</span>;
}

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-hairline text-ink-muted-deep dark:bg-surface-dark dark:text-ink-muted",
  in_review: "bg-attention/10 text-attention-deep",
  launching: "bg-accent-soft text-accent",
  learning: "bg-attention/10 text-attention-deep",
  autonomous: "bg-positive/10 text-positive-deep",
  needs_attention: "bg-critical/10 text-critical",
  paused: "bg-hairline text-ink-muted-deep dark:bg-surface-dark",
};

const STATUS_DOT: Record<string, string> = {
  draft: "○",
  in_review: "◔",
  launching: "◌",
  learning: "◐",
  autonomous: "●",
  needs_attention: "▲",
  paused: "⏸",
};

export function StatusChip({ status }: { status: string }): JSX.Element {
  return (
    <span
      data-testid="status-chip"
      className={`inline-flex items-center gap-1 rounded-control px-2 py-1 text-xs font-medium ${STATUS_STYLE[status] ?? STATUS_STYLE.draft}`}
    >
      <span aria-hidden="true">{STATUS_DOT[status] ?? "○"}</span>
      {STRINGS.status[status] ?? status}
    </span>
  );
}

export function Sparkline({ series }: { series: number[] }): JSX.Element | null {
  if (series.length < 2) return null;
  const max = Math.max(...series, 1);
  const points = series
    .map((v, i) => `${(i / (series.length - 1)) * 100},${28 - (v / max) * 24}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 30" className="h-7 w-full" role="img" aria-label="trend">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" className="text-accent" />
    </svg>
  );
}

export function KpiTile({
  label,
  value,
  hint,
  series,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  series?: number[];
}): JSX.Element {
  return (
    <div className="rounded-card border border-hairline bg-surface p-6 dark:border-ink-muted/20 dark:bg-surface-dark">
      <div className="text-sm text-ink-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-muted">{hint}</div>}
      {series && <Sparkline series={series} />}
    </div>
  );
}

export function FunnelBars({ funnel }: { funnel: { stage: string; count: number }[] }): JSX.Element {
  const max = Math.max(...funnel.map((f) => f.count), 1);
  return (
    <div className="space-y-2" role="list" aria-label={STRINGS.product.funnelTitle}>
      {funnel.map((f) => (
        <div key={f.stage} role="listitem" className="flex items-center gap-3">
          <div className="w-32 shrink-0 text-sm text-ink-muted">
            {STRINGS.funnelStage[f.stage] ?? f.stage}
          </div>
          <div className="h-5 flex-1 overflow-hidden rounded-control bg-hairline/50 dark:bg-ink-muted/10">
            <div
              className="h-full rounded-control bg-accent"
              style={{ width: `${Math.max((f.count / max) * 100, f.count > 0 ? 2 : 0)}%` }}
            />
          </div>
          <Num value={f.count.toLocaleString()} />
        </div>
      ))}
    </div>
  );
}

export function AttentionCard({
  item,
  onFix,
}: {
  item: AttentionItem;
  onFix: (item: AttentionItem) => void;
}): JSX.Element {
  const icon = item.severity === "approval" ? "◔" : item.severity === "error" ? "▲" : "⚠";
  return (
    <div
      data-testid="attention-card"
      className="flex items-start justify-between gap-4 border-b border-hairline p-4 last:border-b-0 dark:border-ink-muted/20"
    >
      <div className="flex gap-3">
        <span aria-hidden="true" className={item.severity === "error" ? "text-critical" : "text-attention-deep"}>
          {icon}
        </span>
        <div>
          <p className="text-sm">{item.message}</p>
          {item.fixHint && <p className="mt-1 text-xs text-ink-muted">{item.fixHint}</p>}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onFix(item)}
        className="min-h-11 min-w-16 rounded-control bg-accent px-4 text-sm font-medium text-white"
      >
        {item.severity === "approval" ? STRINGS.attention.review : STRINGS.attention.fix}
      </button>
    </div>
  );
}

export function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 0)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ActivityItem({ entry }: { entry: ActivityEntry }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-hairline p-4 last:border-b-0 dark:border-ink-muted/20" data-testid="activity-item">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span data-mask className="font-mono text-xs text-ink-muted">{relativeTime(entry.at)}</span>
          {entry.productTitle && (
            <span className="ml-2 text-xs text-ink-muted">{entry.productTitle}</span>
          )}
          <p className="mt-1 text-sm">{entry.text}</p>
          {!entry.executed && entry.guardrailStatus === "passed" && (
            <p className="mt-1 text-xs text-ink-muted">{STRINGS.activity.proposed}</p>
          )}
          {entry.guardrailStatus === "blocked" && (
            <p className="mt-1 text-xs text-attention-deep">{STRINGS.activity.blocked}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="min-h-11 rounded-control px-3 text-sm text-accent"
        >
          {STRINGS.product.why}
        </button>
      </div>
      {open && (
        <div className="mt-2 rounded-control bg-canvas p-3 text-xs dark:bg-canvas-dark">
          {entry.evidence.map((e, i) => (
            <div key={i} className="flex gap-2">
              <span className="text-ink-muted">{e.metric.replace(/_/g, " ")}</span>
              <span className="text-ink-muted">· {e.window} ·</span>
              <Num value={e.result} />
            </div>
          ))}
          {entry.predictedOutcome && (
            <div className="mt-1">
              <span className="text-ink-muted">{STRINGS.activity.predicted}: </span>
              {entry.predictedOutcome}
            </div>
          )}
          {entry.actualOutcome && (
            <div>
              <span className="text-ink-muted">{STRINGS.activity.actual}: </span>
              {entry.actualOutcome}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }): JSX.Element {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-semibold">{title}</h2>
      {hint && <p className="mt-1 text-sm text-ink-muted">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <div className={`rounded-card border border-hairline bg-surface dark:border-ink-muted/20 dark:bg-surface-dark ${className}`}>
      {children}
    </div>
  );
}
