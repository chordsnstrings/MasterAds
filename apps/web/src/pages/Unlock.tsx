// Operator unlock (W1): shown when the internal API requires an access key.
import { useState } from "react";
import { setOperatorKey } from "../api";
import { Card } from "../components";
import { STRINGS } from "../strings";

export default function Unlock({ onUnlocked }: { onUnlocked: () => void }): JSX.Element {
  const [key, setKey] = useState("");
  return (
    <div className="mx-auto max-w-sm pt-16 motion-safe:animate-scale-in">
      <Card className="p-8">
        <h1 className="text-xl font-semibold">{STRINGS.unlock.title}</h1>
        <p className="mt-2 text-sm text-ink-muted">{STRINGS.unlock.hint}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!key.trim()) return;
            setOperatorKey(key.trim());
            onUnlocked();
          }}
        >
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            aria-label={STRINGS.unlock.title}
            data-testid="operator-key-input"
            className="mt-4 block w-full min-h-11 rounded-control border border-hairline bg-surface px-3 font-mono dark:bg-surface-dark dark:border-ink-muted/30"
          />
          <button
            type="submit"
            className="mt-4 min-h-11 w-full rounded-control bg-accent text-sm font-medium text-white hover:bg-accent-deep"
          >
            {STRINGS.unlock.submit}
          </button>
        </form>
      </Card>
    </div>
  );
}
