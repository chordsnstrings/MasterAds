import { STRINGS } from "../strings";
import type { OverviewData } from "../api";
import { ProductGrid } from "./Overview";

export default function Products({ data }: { data: OverviewData }): JSX.Element {
  return (
    <div>
      <h1 className="text-2xl font-semibold">{STRINGS.nav.products}</h1>
      <div className="mt-6">
        {data.products.length === 0 ? (
          <p className="text-ink-muted">{STRINGS.headline.empty}</p>
        ) : (
          <ProductGrid products={data.products} />
        )}
      </div>
    </div>
  );
}
