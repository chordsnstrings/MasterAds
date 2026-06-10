import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { api, type AttentionItem, type OverviewData } from "./api";
import { AppShell } from "./shell";
import { STRINGS } from "./strings";
import Overview from "./pages/Overview";
import Products from "./pages/Products";
import ProductDetail from "./pages/ProductDetail";
import Activity from "./pages/Activity";
import Settings from "./pages/Settings";
import AddProduct from "./pages/AddProduct";

export default function App(): JSX.Element {
  const [overview, setOverview] = useState<OverviewData | null>(null);

  const reload = useCallback(async () => {
    setOverview(await api.overview());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const resolveAttention = useCallback(
    async (item: AttentionItem) => {
      await api.resolveAttention(item.id);
      await reload();
    },
    [reload],
  );

  return (
    <BrowserRouter>
      <AppShell attentionCount={overview?.attention.length ?? 0}>
        {overview === null ? (
          <p className="text-ink-muted">{STRINGS.common.loading}</p>
        ) : (
          <Routes>
            <Route path="/" element={<Overview data={overview} onResolve={resolveAttention} />} />
            <Route path="/products" element={<Products data={overview} />} />
            <Route path="/products/:id" element={<ProductDetail />} />
            <Route path="/activity" element={<Activity />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/add" element={<AddProduct onLaunched={reload} />} />
          </Routes>
        )}
      </AppShell>
    </BrowserRouter>
  );
}
