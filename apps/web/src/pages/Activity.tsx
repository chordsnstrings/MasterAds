// Activity (UX §6.5): the trust surface — the Decision log rendered in plain
// language with expandable evidence.
import { useEffect, useState } from "react";
import { STRINGS } from "../strings";
import { api, type ActivityEntry } from "../api";
import { ActivityItem, Card, PageHeader } from "../components";

const FILTERS = [
  { key: "", label: STRINGS.activity.filterAll },
  { key: "budget", label: STRINGS.activity.filterBudget },
  { key: "creative", label: STRINGS.activity.filterCreative },
  { key: "status", label: STRINGS.activity.filterStatus },
  { key: "check", label: STRINGS.activity.filterCheck },
];

export default function Activity(): JSX.Element {
  const [items, setItems] = useState<ActivityEntry[]>([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    void api.activity(filter ? { type: filter } : {}).then((r) => setItems(r.items));
  }, [filter]);

  return (
    <div>
      <PageHeader title={STRINGS.activity.title} intro={STRINGS.pageIntro.activity} />
      <div
        className="inline-flex max-w-full flex-wrap gap-1 rounded-full bg-ink/[0.04] p-1 dark:bg-white/5"
        role="tablist"
        aria-label="Filter"
      >
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`min-h-11 rounded-full px-4 text-sm ${
              filter === f.key
                ? "bg-surface font-medium text-ink shadow-card dark:bg-surface-dark dark:text-white"
                : "text-ink-muted hover:text-ink dark:hover:text-white"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <Card className="mt-5">
        {items.length === 0 ? (
          <p className="p-4 text-sm text-ink-muted">{STRINGS.activity.empty}</p>
        ) : (
          items.map((entry) => <ActivityItem key={entry.id} entry={entry} />)
        )}
      </Card>
    </div>
  );
}
