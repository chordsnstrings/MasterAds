// Product detail (UX §6.3): outcomes, funnel, engine activity; controls are
// pause and adjust-intent only.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { STRINGS } from "../strings";
import { api, type ProductDetailData } from "../api";
import { ActivityItem, AdMedia, Card, FunnelBars, Money, Num, Sparkline, StatusChip } from "../components";

export default function ProductDetail(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ProductDetailData | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [goal, setGoal] = useState("best");
  const [budget, setBudget] = useState("");
  const [margin, setMargin] = useState("");
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

  if (!data) return <p aria-busy="true" className="text-ink-muted">{STRINGS.common.loading}</p>;
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
      margin_pct: margin ? Number(margin) : undefined,
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
      <div className="mt-3 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{product.title}</h1>
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

      {data.channels.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold tracking-tight">{STRINGS.channels.title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-muted">{STRINGS.channels.hint}</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(() => {
              const best = data.channels.reduce<string | null>((acc, ch) => {
                if (ch.netReturn === null) return acc;
                const cur = data.channels.find((x) => x.campaignId === acc);
                return !cur || cur.netReturn === null || ch.netReturn > cur.netReturn
                  ? ch.campaignId
                  : acc;
              }, null);
              return data.channels.map((ch) => (
                <div
                  key={ch.campaignId}
                  data-testid="channel-card"
                  className={`relative rounded-card border bg-surface p-5 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover dark:bg-surface-dark ${
                    ch.campaignId === best
                      ? "border-accent/50 ring-1 ring-accent/30"
                      : "border-hairline/70 dark:border-white/10"
                  }`}
                >
                  {ch.campaignId === best && (
                    <span className="absolute right-3 top-3 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent dark:bg-accent/15">
                      {STRINGS.channels.winner}
                    </span>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{STRINGS.platformNames[ch.platform] ?? ch.platform}</span>
                    <span className="font-mono text-xs text-ink-muted">
                      {STRINGS.channels.perDay(ch.dailyBudget.toFixed(0))}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                    <div>
                      <div className="font-mono text-base font-semibold tabular-nums">{ch.spend7d.toFixed(0)}</div>
                      <div className="mt-0.5 text-ink-muted">{STRINGS.product.spent}</div>
                    </div>
                    <div>
                      <div className="font-mono text-base font-semibold tabular-nums">{ch.results7d}</div>
                      <div className="mt-0.5 text-ink-muted">{STRINGS.kpi.results.split(" ·")[0]?.toLowerCase()}</div>
                    </div>
                    <div>
                      <div className="font-mono text-base font-semibold tabular-nums">
                        {ch.netReturn !== null ? `${ch.netReturn.toFixed(1)}×` : "—"}
                      </div>
                      <div className="mt-0.5 text-ink-muted">{STRINGS.product.netShort}</div>
                    </div>
                  </div>
                  {ch.spendSeries.length > 1 ? (
                    <Sparkline series={ch.spendSeries} />
                  ) : (
                    <p className="mt-3 text-center text-xs text-ink-muted">{STRINGS.channels.noData}</p>
                  )}
                </div>
              ));
            })()}
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">{STRINGS.product.funnelTitle}</h2>
        <Card className="mt-3 p-6">
          <FunnelBars funnel={funnel} />
        </Card>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold tracking-tight">{STRINGS.ads.title}</h2>
        {data.winning.length > 0 && (
          <p className="mt-1 text-sm leading-relaxed text-ink-muted" data-testid="winning-line">
            {STRINGS.ads.winningLine(
              STRINGS.ads.hook[data.winning[0]!.hook] ?? data.winning[0]!.hook,
              data.winning[0]!.sharePct,
            )}
          </p>
        )}
        {data.ads.length === 0 ? (
          <Card className="mt-3 p-5">
            <p className="text-sm text-ink-muted">{STRINGS.ads.empty}</p>
          </Card>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {data.ads.map((ad) => (
                <div
                  key={ad.id}
                  data-testid="ad-tile"
                  className="relative rounded-card border border-hairline/70 bg-surface p-3 text-xs shadow-card dark:border-white/10 dark:bg-surface-dark"
                >
                  <div className="flex aspect-square items-center justify-center overflow-hidden rounded-control bg-accent-soft text-center font-medium text-accent dark:bg-accent/15">
                    <AdMedia assetRef={ad.assetRef} assetType={ad.assetType} headline={ad.headline} />
                  </div>
                  {ad.assetType === "video" && (
                    <span className="absolute left-2 top-2 rounded-full bg-ink/70 px-2 py-0.5 text-[10px] font-medium text-white">
                      {STRINGS.creation.videoBadge}
                    </span>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {ad.hookType && (
                      <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent dark:bg-accent/15">
                        {STRINGS.ads.hook[ad.hookType] ?? ad.hookType}
                      </span>
                    )}
                    <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[10px] text-ink-muted-deep dark:bg-white/10 dark:text-ink-muted">
                      {STRINGS.ads.adStatus[ad.status] ?? ad.status}
                    </span>
                    <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[10px] text-ink-muted-deep dark:bg-white/10 dark:text-ink-muted">
                      {STRINGS.creation.formatTabs[ad.format] ?? ad.format}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">
                    {STRINGS.ads.fatigue[ad.fatigueState] ?? ad.fatigueState}
                    {ad.predictedScore !== null && (
                      <> · {STRINGS.ads.promise(Math.round(ad.predictedScore * 100))}</>
                    )}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">{STRINGS.ads.honestyNote}</p>
          </>
        )}
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
                className="mt-1 block w-full min-h-11 rounded-control border border-hairline bg-surface px-3 dark:bg-surface-dark dark:border-white/15"
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
                className="mt-1 block w-full min-h-11 rounded-control border border-hairline bg-surface px-3 font-mono dark:bg-surface-dark dark:border-white/15"
              />
            </label>
            <label className="block text-sm">
              {STRINGS.product.marginLabel}
              <input
                type="number"
                value={margin}
                onChange={(e) => setMargin(e.target.value)}
                placeholder="100"
                className="mt-1 block w-full min-h-11 rounded-control border border-hairline bg-surface px-3 font-mono dark:bg-surface-dark dark:border-white/15"
              />
              <span className="mt-1 block text-xs text-ink-muted">{STRINGS.product.marginHint}</span>
            </label>
          </div>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={() => void saveIntent()}
              className="min-h-11 rounded-control bg-accent px-5 text-sm font-medium text-white hover:bg-accent-deep"
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
        <div className="sticky bottom-14 mt-8 bg-canvas/90 py-3 backdrop-blur sm:bottom-0 dark:bg-canvas-dark/90">
          <div className="flex gap-3">
          <button
            type="button"
            data-testid="pause-button"
            onClick={() => void togglePause()}
            title={STRINGS.product.pauseHint}
            className="min-h-11 flex-1 rounded-control border border-hairline bg-surface px-5 text-sm font-medium transition-colors hover:border-ink/20 sm:flex-none dark:bg-surface-dark dark:border-white/15 dark:hover:border-white/30"
          >
            {paused ? STRINGS.product.resume : STRINGS.product.pause}
          </button>
          <button
            type="button"
            onClick={() => setAdjusting(true)}
            className="min-h-11 flex-1 rounded-control bg-accent px-5 text-sm font-medium text-white hover:bg-accent-deep sm:flex-none"
          >
            {STRINGS.product.adjust}
          </button>
          </div>
          <p className="mt-2 text-xs text-ink-muted">{STRINGS.product.pauseHint}</p>
        </div>
      )}
    </div>
  );
}
