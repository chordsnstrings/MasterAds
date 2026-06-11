import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { STRINGS } from "../strings";
import { api, type AttentionItem, type OverviewData } from "../api";
import { AttentionCard, Card, KpiTile, Money, Num, StatusChip } from "../components";

/** First-run checklist (UX §5.1): shown on the empty Overview until dismissed. */
function FirstRunChecklist({
  checklist,
}: {
  checklist: OverviewData["checklist"];
}): JSX.Element | null {
  const [hidden, setHidden] = useState(false);
  const C = STRINGS.checklist;
  if (hidden || checklist.dismissed) return null;
  const steps: { key: keyof typeof checklist.items; label: string }[] = [
    { key: "accounts", label: C.accounts },
    { key: "site", label: C.site },
    { key: "brandKit", label: C.brandKit },
    { key: "guardrails", label: C.guardrails },
  ];
  return (
    <section data-testid="first-run-checklist">
      <Card className="mt-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{C.title}</h2>
          <p className="mt-1 text-sm text-ink-muted">{C.intro}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setHidden(true);
            void api.dismissChecklist();
          }}
          className="min-h-11 shrink-0 px-2 text-sm text-ink-muted"
        >
          {C.dismiss}
        </button>
      </div>
      <ul className="mt-4 space-y-2">
        {steps.map((s) => (
          <li key={s.key} className="flex min-h-11 items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2">
              <span aria-hidden="true">{checklist.items[s.key] ? "✓" : "○"}</span>
              {s.label}
              {checklist.items[s.key] && <span className="sr-only">{C.done}</span>}
            </span>
            {!checklist.items[s.key] && (
              <Link to="/settings" className="shrink-0 text-accent">
                {C.open}
              </Link>
            )}
          </li>
        ))}
        <li className="flex min-h-11 items-center justify-between gap-3 text-sm">
          <span className="flex items-center gap-2">
            <span aria-hidden="true">○</span>
            {C.addFirst}
          </span>
          <Link to="/add" className="shrink-0 text-accent">
            {STRINGS.nav.addShort}
          </Link>
        </li>
      </ul>
      </Card>
    </section>
  );
}

export function ProductGrid({ products }: { products: OverviewData["products"] }): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {products.map((p, i) => (
        <Link
          key={p.id}
          to={`/products/${p.id}`}
          data-testid="product-card"
          className="rounded-card border border-hairline/70 bg-surface p-6 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover motion-safe:animate-fade-up dark:border-white/10 dark:bg-surface-dark"
          style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
        >
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-medium tracking-tight">{p.title}</h3>
            <StatusChip status={p.status} />
          </div>
          <div className="mt-4 flex items-baseline justify-between text-sm">
            <Money value={p.spend7d} currency={p.currency} />
            <span className="text-ink-muted">
              {p.terminalEvent === "Lead"
                ? STRINGS.product.leads(p.conversions7d)
                : STRINGS.product.buys(p.conversions7d)}
            </span>
          </div>
          {STRINGS.statusNote[p.status] && (
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">{STRINGS.statusNote[p.status]}</p>
          )}
        </Link>
      ))}
    </div>
  );
}

export default function Overview({
  data,
  onResolve,
}: {
  data: OverviewData;
  onResolve: (item: AttentionItem) => Promise<void>;
}): JSX.Element {
  const navigate = useNavigate();
  const { kpis } = data;
  const empty = data.counts.products === 0;

  async function handleFix(item: AttentionItem): Promise<void> {
    if (item.kind === "restricted_approval") {
      navigate("/settings");
      return;
    }
    await onResolve(item);
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl" data-testid="status-headline">
        {empty ? STRINGS.headline.empty : STRINGS.headline[data.headline]}
      </h1>
      {!empty && (
        <p className="mt-1 text-sm text-ink-muted">
          {STRINGS.counts.products(data.counts.products)}
          {data.counts.learning > 0 && <> · {STRINGS.counts.learning(data.counts.learning)}</>}
          {data.counts.needsAttention > 0 && (
            <> · {STRINGS.counts.attention(data.counts.needsAttention)}</>
          )}
        </p>
      )}

      {empty && <FirstRunChecklist checklist={data.checklist} />}

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        {[
          <KpiTile key="spend" label={STRINGS.kpi.spend} value={<Money value={kpis.spend7d} />} series={kpis.spendSeries} />,
          <KpiTile
            key="results"
            label={STRINGS.kpi.results}
            value={<Num value={kpis.conversions7d.toLocaleString()} />}
            series={kpis.conversionSeries}
          />,
          <KpiTile
            key="net"
            label={STRINGS.kpi.netReturn}
            value={kpis.netReturn !== null ? <Num value={`${kpis.netReturn.toFixed(1)}×`} /> : <span className="text-ink-muted text-base">{STRINGS.kpi.noData}</span>}
          />,
          <KpiTile
            key="cost"
            label={STRINGS.kpi.runningCost}
            value={<Money value={kpis.runningCost7d} currency="USD" />}
            hint={STRINGS.kpi.runningCostHint}
          />,
          <KpiTile
            key="incremental"
            label={STRINGS.kpi.incremental}
            value={
              kpis.incremental !== null ? (
                <Num value={`${kpis.incremental.toFixed(1)}×`} />
              ) : (
                <span className="text-base text-ink-muted">{STRINGS.kpi.incrementalPending}</span>
              )
            }
          />,
        ].map((tile, i) => (
          <div key={i} className="motion-safe:animate-fade-up" style={{ animationDelay: `${i * 45}ms` }}>
            {tile}
          </div>
        ))}
      </div>

      {/* Attention area collapses entirely when empty (UX §6.1). */}
      {data.attention.length > 0 && (
        <section className="mt-8" data-testid="attention-area">
          <h2 className="text-lg font-semibold">{STRINGS.attention.title}</h2>
          <Card className="mt-3">
            {data.attention.map((a) => (
              <AttentionCard key={a.id} item={a} onFix={handleFix} />
            ))}
          </Card>
        </section>
      )}

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{STRINGS.nav.products}</h2>
          <Link to="/add" className="min-h-11 inline-flex items-center rounded-control px-3 text-sm text-accent">
            {STRINGS.nav.addShort}
          </Link>
        </div>
        <div className="mt-3">
          <ProductGrid products={data.products} />
        </div>
      </section>
    </div>
  );
}
