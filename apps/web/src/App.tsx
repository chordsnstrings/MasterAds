import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { api, ApiError, type AttentionItem, type OverviewData } from "./api";
import { AppShell } from "./shell";
import { PageSkeleton } from "./components";
import Overview from "./pages/Overview";
import Products from "./pages/Products";
import ProductDetail from "./pages/ProductDetail";
import Activity from "./pages/Activity";
import Settings from "./pages/Settings";
import AddProduct from "./pages/AddProduct";
import Unlock from "./pages/Unlock";

export default function App(): JSX.Element {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [locked, setLocked] = useState(false);
  const [brand, setBrand] = useState<string | null>(() => localStorage.getItem("brand") || null);
  const [brandList, setBrandList] = useState<{ id: string; name: string }[]>([]);

  const reload = useCallback(async () => {
    try {
      setOverview(await api.overview(brand));
      const b = await api.brands();
      setBrandList(b.brands.map((x) => ({ id: x.id, name: x.name })));
      setLocked(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setLocked(true);
      else throw err;
    }
  }, [brand]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const selectBrand = useCallback((id: string | null) => {
    if (id) localStorage.setItem("brand", id);
    else localStorage.removeItem("brand");
    setBrand(id);
  }, []);

  const resolveAttention = useCallback(
    async (item: AttentionItem) => {
      await api.resolveAttention(item.id);
      await reload();
    },
    [reload],
  );

  if (locked) {
    return <Unlock onUnlocked={() => void reload()} />;
  }

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <AppShell
        attentionCount={overview?.attention.length ?? 0}
        brands={brandList}
        selectedBrand={brand}
        onSelectBrand={selectBrand}
      >
        {overview === null ? (
          <PageSkeleton />
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
