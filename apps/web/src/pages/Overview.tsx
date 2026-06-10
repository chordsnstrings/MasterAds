import { Link, useNavigate } from "react-router-dom";
import { STRINGS } from "../strings";
import type { AttentionItem, OverviewData } from "../api";
import { AttentionCard, Card, KpiTile, Money, Num, StatusChip } from "../components";

export function ProductGrid({ products }: { products: OverviewData["products"] }): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {products.map((p) => (
        <Link
          key={p.id}
          to={`/products/${p.id}`}
          data-testid="product-card"
          className="rounded-card border border-hairline bg-surface p-6 transition-shadow hover:shadow-sm dark:border-ink-muted/20 dark:bg-surface-dark"
        >
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-medium">{p.title}</h3>
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
            <p className="mt-2 text-xs text-ink-muted">{STRINGS.statusNote[p.status]}</p>
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
      <h1 className="text-2xl font-semibold" data-testid="status-headline">
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

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiTile label={STRINGS.kpi.spend} value={<Money value={kpis.spend7d} />} series={kpis.spendSeries} />
        <KpiTile
          label={STRINGS.kpi.results}
          value={<Num value={kpis.conversions7d.toLocaleString()} />}
          series={kpis.conversionSeries}
        />
        <KpiTile
          label={STRINGS.kpi.netReturn}
          value={kpis.netReturn !== null ? <Num value={`${kpis.netReturn.toFixed(1)}×`} /> : <span className="text-ink-muted text-base">{STRINGS.kpi.noData}</span>}
        />
        <KpiTile
          label={STRINGS.kpi.runningCost}
          value={<Money value={kpis.runningCost7d} currency="USD" />}
          hint={STRINGS.kpi.runningCostHint}
        />
        <KpiTile
          label={STRINGS.kpi.incremental}
          value={
            kpis.incremental !== null ? (
              <Num value={`${kpis.incremental.toFixed(1)}×`} />
            ) : (
              <span className="text-base text-ink-muted">{STRINGS.kpi.incrementalPending}</span>
            )
          }
        />
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
