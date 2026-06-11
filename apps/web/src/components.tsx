// Component library — minimal modern surface, monospace numerics, gentle
// motion (all animation collapses under prefers-reduced-motion).
import { useState, type ReactNode } from "react";
import { STRINGS } from "./strings";
import type { ActivityEntry, AttentionItem } from "./api";

export function Money({ value, currency }: { value: number; currency?: string }): JSX.Element {
  const cur = currency ?? STRINGS.common.currency;
  const formatted =
    value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(value < 10 && value > 0 ? 2 : 0);
  return (
    <span className="font-mono tabular-nums">
      <span className="text-sm font-normal text-ink-muted">{cur}</span> {formatted}
    </span>
  );
}

export function Num({ value }: { value: number | string }): JSX.Element {
  return <span className="font-mono tabular-nums">{value}</span>;
}

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-ink/5 text-ink-muted-deep dark:bg-white/10 dark:text-ink-muted",
  in_review: "bg-attention/10 text-attention-deep",
  launching: "bg-accent-soft text-accent",
  learning: "bg-attention/10 text-attention-deep",
  autonomous: "bg-positive/10 text-positive-deep",
  needs_attention: "bg-critical/10 text-critical",
  paused: "bg-ink/5 text-ink-muted-deep dark:bg-white/10",
};

const STATUS_DOT_COLOR: Record<string, string> = {
  draft: "bg-ink-muted/50",
  in_review: "bg-attention",
  launching: "bg-accent",
  learning: "bg-attention",
  autonomous: "bg-positive",
  needs_attention: "bg-critical",
  paused: "bg-ink-muted/50",
};

const STATUS_DOT_PULSE = new Set(["launching", "learning", "in_review"]);

export function StatusChip({ status }: { status: string }): JSX.Element {
  return (
    <span
      data-testid="status-chip"
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[status] ?? STATUS_STYLE.draft}`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_COLOR[status] ?? "bg-ink-muted/50"} ${
          STATUS_DOT_PULSE.has(status) ? "motion-safe:animate-pulse-soft" : ""
        }`}
      />
      {STRINGS.status[status] ?? status}
    </span>
  );
}

export function Sparkline({ series }: { series: number[] }): JSX.Element | null {
  if (series.length < 2) return null;
  const max = Math.max(...series, 1);
  const pts = series.map((v, i) => [
    (i / (series.length - 1)) * 100,
    28 - (v / max) * 24,
  ]);
  const line = pts.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `0,30 ${line} 100,30`;
  return (
    <svg viewBox="0 0 100 30" className="mt-2 h-7 w-full" role="img" aria-label="trend" preserveAspectRatio="none">
      <polygon points={area} className="fill-accent/10" />
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-accent"
      />
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
    <div className="rounded-card border border-hairline/70 bg-surface p-5 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover dark:border-white/10 dark:bg-surface-dark">
      <div className="text-[13px] font-medium text-ink-muted">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs leading-relaxed text-ink-muted">{hint}</div>}
      {series && <Sparkline series={series} />}
    </div>
  );
}

export function FunnelBars({ funnel }: { funnel: { stage: string; count: number }[] }): JSX.Element {
  const max = Math.max(...funnel.map((f) => f.count), 1);
  return (
    <div className="space-y-2.5" role="list" aria-label={STRINGS.product.funnelTitle}>
      {funnel.map((f, i) => (
        <div key={f.stage} role="listitem" className="flex items-center gap-3">
          <div className="w-32 shrink-0 text-sm text-ink-muted">
            {STRINGS.funnelStage[f.stage] ?? f.stage}
          </div>
          <div className="h-4 flex-1 overflow-hidden rounded-full bg-ink/5 dark:bg-white/5">
            <div
              className="h-full origin-left rounded-full bg-gradient-to-r from-accent to-accent/70 motion-safe:animate-grow-x"
              style={{
                width: `${Math.max((f.count / max) * 100, f.count > 0 ? 2 : 0)}%`,
                animationDelay: `${i * 70}ms`,
              }}
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
  const tone =
    item.severity === "error"
      ? "bg-critical/10 text-critical"
      : "bg-attention/10 text-attention-deep";
  const icon = item.severity === "approval" ? "◔" : item.severity === "error" ? "▲" : "⚠";
  return (
    <div
      data-testid="attention-card"
      className="flex items-start justify-between gap-4 border-b border-hairline/70 p-4 last:border-b-0 dark:border-white/10"
    >
      <div className="flex gap-3">
        <span
          aria-hidden="true"
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm ${tone}`}
        >
          {icon}
        </span>
        <div className="pt-0.5">
          <p className="text-sm leading-relaxed">{item.message}</p>
          {item.fixHint && <p className="mt-1 text-xs leading-relaxed text-ink-muted">{item.fixHint}</p>}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onFix(item)}
        className="min-h-11 min-w-16 shrink-0 rounded-control bg-accent px-4 text-sm font-medium text-white hover:bg-accent-deep"
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
    <div
      className="border-b border-hairline/70 p-4 transition-colors duration-150 last:border-b-0 hover:bg-ink/[0.015] dark:border-white/10 dark:hover:bg-white/[0.02]"
      data-testid="activity-item"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <span data-mask className="font-mono text-xs text-ink-muted">{relativeTime(entry.at)}</span>
          {entry.productTitle && (
            <span className="ml-2 text-xs text-ink-muted">{entry.productTitle}</span>
          )}
          <p className="mt-1 text-sm leading-relaxed">{entry.text}</p>
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
          className="min-h-11 rounded-control px-3 text-sm text-accent hover:bg-accent-soft dark:hover:bg-accent/15"
        >
          {STRINGS.product.why}
        </button>
      </div>
      {open && (
        <div className="mt-2 rounded-control bg-canvas p-3 text-xs leading-relaxed motion-safe:animate-fade-up dark:bg-canvas-dark">
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
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {hint && <p className="mt-1 text-sm leading-relaxed text-ink-muted">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <div
      className={`rounded-card border border-hairline/70 bg-surface shadow-card dark:border-white/10 dark:bg-surface-dark ${className}`}
    >
      {children}
    </div>
  );
}
