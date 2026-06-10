// Product detail (UX §6.3): outcomes, funnel, engine activity; controls are
// pause and adjust-intent only.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { STRINGS } from "../strings";
import { api, type ProductDetailData } from "../api";
import { ActivityItem, Card, FunnelBars, Money, Num, StatusChip } from "../components";

export default function ProductDetail(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ProductDetailData | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [goal, setGoal] = useState("best");
  const [budget, setBudget] = useState("");
  const [blockedNote, setBlockedNote] = useState<string | null>(null);

  async function reload(): Promise<void> {
    if (!id) return;
    const d = await api.product(id);
    setData(d);
    setGoal(d.spec?.goal ?? "best");
    setBudget(d.spec?.dailyBudget ? String(Number(d.spec.dailyBudget)) : "");
  }

  useEffect(() => {
    void reload();
  }, [id]);

  if (!data) return <p className="text-ink-muted">{STRINGS.common.loading}</p>;
  const { product, metrics, funnel, activity, spec } = data;
  const paused = product.status === "paused";

  async function togglePause(): Promise<void> {
    if (!id) return;
    if (paused) await api.resume(id);
    else await api.pause(id);
    await reload();
  }

  async function saveIntent(): Promise<void> {
    if (!id) return;
    const result = await api.adjustIntent(id, {
      goal,
      daily_budget: budget ? Number(budget) : undefined,
    });
    setBlockedNote(result.blocked.length > 0 ? result.blocked[0]! : null);
    setAdjusting(false);
    await reload();
  }

  return (
    <div>
      <nav className="text-sm text-ink-muted">
        <Link to="/products" className="min-h-11 inline-flex items-center text-accent">
          ← {STRINGS.nav.products}
        </Link>
      </nav>
      <div className="mt-2 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{product.title}</h1>
        <StatusChip status={product.status} />
      </div>

      <p className="mt-3 text-sm">
        <Money value={metrics.spend7d} currency={product.currency ?? undefined} />{" "}
        <span className="text-ink-muted">{STRINGS.product.spent}</span> ·{" "}
        <Money value={metrics.runningCost7d} currency="USD" />{" "}
        <span className="text-ink-muted">{STRINGS.product.running}</span> ·{" "}
        <span>
          {spec?.terminalEvent === "Lead"
            ? STRINGS.product.leads(metrics.conversions7d)
            : STRINGS.product.buys(metrics.conversions7d)}
        </span>
        {metrics.netReturn !== null && (
          <>
            {" "}
            · <Num value={`${metrics.netReturn.toFixed(1)}×`} />{" "}
            <span className="text-ink-muted">{STRINGS.product.netShort}</span>
          </>
        )}
      </p>
      {spec && (
        <p className="mt-1 text-sm text-ink-muted">
          {STRINGS.product.showsOn}{" "}
          {spec.targetPlatforms.map((p) => STRINGS.platformNames[p] ?? p).join(" · ")}
        </p>
      )}
      {STRINGS.statusNote[product.status] && (
        <p className="mt-2 text-sm text-attention-deep">{STRINGS.statusNote[product.status]}</p>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">{STRINGS.product.funnelTitle}</h2>
        <Card className="mt-3 p-6">
          <FunnelBars funnel={funnel} />
        </Card>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">{STRINGS.product.activityTitle}</h2>
        <Card className="mt-3">
          {activity.length === 0 ? (
            <p className="p-4 text-sm text-ink-muted">{STRINGS.product.empty}</p>
          ) : (
            activity.map((entry) => <ActivityItem key={entry.id} entry={entry} />)
          )}
        </Card>
      </section>

      {blockedNote && <p className="mt-4 text-sm text-attention-deep">{blockedNote}</p>}

      {adjusting ? (
        <Card className="mt-8 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              {STRINGS.product.goal}
              <select
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                className="mt-1 block w-full min-h-11 rounded-control border border-hairline bg-surface px-3 dark:bg-surface-dark dark:border-ink-muted/30"
              >
                {Object.entries(STRINGS.goals).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              {STRINGS.product.perDay} ({spec?.budgetCurrency ?? "AED"})
              <input
                type="number"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                className="mt-1 block w-full min-h-11 rounded-control border border-hairline bg-surface px-3 font-mono dark:bg-surface-dark dark:border-ink-muted/30"
              />
            </label>
          </div>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={() => void saveIntent()}
              className="min-h-11 rounded-control bg-accent px-5 text-sm font-medium text-white"
            >
              {STRINGS.product.save}
            </button>
            <button
              type="button"
              onClick={() => setAdjusting(false)}
              className="min-h-11 rounded-control px-5 text-sm text-ink-muted"
            >
              {STRINGS.product.cancel}
            </button>
          </div>
        </Card>
      ) : (
        <div className="sticky bottom-14 mt-8 flex gap-3 bg-canvas/90 py-3 backdrop-blur sm:bottom-0 dark:bg-canvas-dark/90">
          <button
            type="button"
            data-testid="pause-button"
            onClick={() => void togglePause()}
            className="min-h-11 flex-1 rounded-control border border-hairline bg-surface px-5 text-sm font-medium sm:flex-none dark:bg-surface-dark dark:border-ink-muted/30"
          >
            {paused ? STRINGS.product.resume : STRINGS.product.pause}
          </button>
          <button
            type="button"
            onClick={() => setAdjusting(true)}
            className="min-h-11 flex-1 rounded-control bg-accent px-5 text-sm font-medium text-white sm:flex-none"
          >
            {STRINGS.product.adjust}
          </button>
        </div>
      )}
    </div>
  );
}
