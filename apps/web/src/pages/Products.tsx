import { Link } from "react-router-dom";
import { STRINGS } from "../strings";
import type { OverviewData } from "../api";
import { EmptyState, PageHeader } from "../components";
import { ProductGrid } from "./Overview";

export default function Products({ data }: { data: OverviewData }): JSX.Element {
  return (
    <div>
      <PageHeader title={STRINGS.nav.products} intro={STRINGS.pageIntro.products} />
      {data.products.length === 0 ? (
        <EmptyState
          message={STRINGS.headline.empty}
          action={
            <Link
              to="/add"
              className="min-h-11 inline-flex items-center rounded-full bg-accent px-5 text-sm font-medium text-white transition-all duration-200 hover:-translate-y-px hover:bg-accent-deep hover:shadow-pop"
            >
              {STRINGS.nav.addProduct}
            </Link>
          }
        />
      ) : (
        <ProductGrid products={data.products} />
      )}
    </div>
  );
}
