// The hero flow (FLOW, all sections): two steps plus at most one or two simple
// questions that appear only when genuinely needed. Always launchable untouched.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { STRINGS } from "../strings";
import { api, type CreativePreview, type PlanData, type SettingsData } from "../api";
import { Card, Money } from "../components";

const C = STRINGS.creation;

type Step =
  | { kind: "add" }
  | { kind: "reading" }
  | { kind: "disambiguation"; productId: string }
  | { kind: "review" }
  | { kind: "confirmation"; cap: number; currency: string }
  | { kind: "submitted" };

export default function AddProduct({
  onLaunched,
}: {
  onLaunched: () => Promise<void>;
}): JSX.Element {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>({ kind: "add" });
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [goal, setGoal] = useState("best");
  const [budget, setBudget] = useState("");
  const [productId, setProductId] = useState<string | null>(null);
  const [productTitle, setProductTitle] = useState("");
  const [catalogCount, setCatalogCount] = useState(0);
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [creatives, setCreatives] = useState<CreativePreview[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [editHeadline, setEditHeadline] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editLine, setEditLine] = useState<"goal" | "platforms" | "budget" | "destination" | null>(null);
  const [previewFormat, setPreviewFormat] = useState<"1:1" | "9:16" | "16:9">("1:1");
  const [destKind, setDestKind] = useState("hosted_form");
  const [destValue, setDestValue] = useState("");
  const [connections, setConnections] = useState<SettingsData["connections"]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.settings().then((s) => setConnections(s.connections));
  }, []);

  async function buildPlanAndReview(
    pid: string,
    disambiguation?: "product" | "service",
  ): Promise<void> {
    const body: Parameters<typeof api.plan>[1] = {};
    if (goal !== "best") body.goal = goal;
    if (budget) body.daily_budget = Number(budget);
    if (disambiguation) body.disambiguation = disambiguation;
    const result = await api.plan(pid, body);
    if (result.needsDisambiguation) {
      setStep({ kind: "disambiguation", productId: pid });
      return;
    }
    setPlan(result);
    const detail = await api.product(pid);
    setProductTitle(detail.product.title);
    const gen = await api.generateCreatives(result.specId);
    setCreatives(gen.creatives);
    setSelected(new Set(gen.creatives.filter((c) => c.format === "1:1").map((c) => c.id)));
    setStep({ kind: "review" });
  }

  async function pollIntake(intakeId: string): Promise<void> {
    for (let i = 0; i < 60; i++) {
      const status = await api.intakeStatus(intakeId);
      if (status.status === "unreadable") {
        setStep({ kind: "add" });
        setNotice(status.result?.suggestion ?? C.linkFailed);
        setInput("");
        setTimeout(() => inputRef.current?.focus(), 50);
        return;
      }
      if (status.status === "done") {
        const ids = status.result?.productIds ?? [];
        const count = status.result?.productCount ?? ids.length;
        setCatalogCount(count > 1 ? count : 0);
        const pid = ids[0];
        if (!pid) {
          setStep({ kind: "add" });
          setNotice(C.linkFailed);
          return;
        }
        setProductId(pid);
        await buildPlanAndReview(pid);
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  async function handleContinue(): Promise<void> {
    if (!input.trim()) return;
    setNotice(null);
    setStep({ kind: "reading" });
    const res = await api.intake(input.trim());
    await pollIntake(res.intakeId);
  }

  async function handleFile(file: File): Promise<void> {
    setNotice(null);
    setStep({ kind: "reading" });
    const buf = await file.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    const res = await api.intakeFile(file.name, b64);
    await pollIntake(res.intakeId);
  }

  async function handleLaunch(): Promise<void> {
    if (!plan || busy) return;
    if (plan.destination === null) {
      setEditLine("destination");
      return;
    }
    setBusy(true);
    try {
      const result = await api.launch(plan.specId);
      await onLaunched();
      if (result.status === "in_review") setStep({ kind: "submitted" });
      else
        setStep({
          kind: "confirmation",
          cap: result.dailyCap ?? plan.perDay,
          currency: result.currency ?? plan.currency ?? "AED",
        });
    } finally {
      setBusy(false);
    }
  }

  async function applyDestination(): Promise<void> {
    if (!plan) return;
    const value =
      destKind === "hosted_page" || destKind === "hosted_form" ? "hosted" : destValue.trim();
    if ((destKind === "url" || destKind === "whatsapp" || destKind === "call") && !value) return;
    const updated = await api.patchSpec(plan.specId, {
      destination: { kind: destKind, value },
    });
    setPlan({ ...plan, ...updated, needsDestinationChoice: false });
    setEditLine(null);
  }

  const restricted = plan?.policyCategory === "restricted";
  const platformLabel = (plan?.platforms ?? [])
    .map((p) => STRINGS.platformNames[p] ?? p)
    .join(" · ")
    .replace("Instagram & Facebook", "Instagram, Facebook");

  // ---------- Step: confirmation ----------
  if (step.kind === "confirmation" || step.kind === "submitted") {
    const live = step.kind === "confirmation";
    return (
      <div className="mx-auto max-w-xl">
        <Card className="p-8 text-center">
          <div className="text-3xl" aria-hidden="true">
            {live ? "✓" : "◔"}
          </div>
          <h1 className="mt-2 text-2xl font-semibold" data-testid="confirm-title">
            {live ? C.confirmTitle : C.submittedTitle}
          </h1>
          <p className="mt-2 text-ink-muted">{live ? C.confirmBody : C.submittedBody}</p>
          <ul className="mx-auto mt-6 max-w-sm space-y-2 text-left text-sm">
            <li>• {C.reassuranceSmall}</li>
            <li data-testid="spend-cap-line">
              • {live ? C.spendReassurance(step.currency, step.cap) : C.preLaunchReassurance}
            </li>
            <li>• {C.reassuranceTell}</li>
            <li>• {C.reassurancePause}</li>
          </ul>
          <button
            type="button"
            onClick={() => navigate(productId ? `/products/${productId}` : "/")}
            className="mt-8 min-h-11 rounded-control bg-accent px-6 text-sm font-medium text-white hover:bg-accent-deep"
          >
            {C.seeHow}
          </button>
        </Card>
      </div>
    );
  }

  // ---------- Step: disambiguation (FLOW §4.5) ----------
  if (step.kind === "disambiguation") {
    return (
      <div className="mx-auto max-w-xl">
        <Card className="p-8">
          <h1 className="text-xl font-semibold" data-testid="disambiguation-question">
            {C.disambiguation}
          </h1>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            {(
              [
                ["product", C.disambiguationProduct],
                ["service", C.disambiguationService],
              ] as const
            ).map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                onClick={() => {
                  setStep({ kind: "reading" });
                  void buildPlanAndReview(step.productId, kind);
                }}
                className="min-h-12 flex-1 rounded-control border border-hairline bg-surface px-5 font-medium hover:border-accent dark:bg-surface-dark dark:border-white/15"
              >
                {label}
              </button>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  // ---------- Step: reading ----------
  if (step.kind === "reading") {
    return (
      <div className="mx-auto max-w-xl">
        <Card className="p-12 text-center">
          <div className="mx-auto h-3 w-3 animate-pulse rounded-full bg-accent" aria-hidden="true" />
          <p className="mt-4 text-ink-muted" data-testid="reading-state">
            {C.reading}
          </p>
        </Card>
      </div>
    );
  }

  // ---------- Step: review (FLOW §5) ----------
  if (step.kind === "review" && plan) {
    const lowBudget = plan.perDay < 150;
    const goalVerb = C.goalVerbs[plan.goal ?? "best"] ?? C.goalVerbs.best!;
    return (
      <div className="mx-auto max-w-xl pb-24">
        <h1 className="text-2xl font-semibold">{C.reviewTitle}</h1>
        <p className="mt-3 text-base leading-relaxed" data-testid="plan-sentence">
          {catalogCount > 1
            ? C.catalogConfirm(catalogCount, plan.currency ?? "AED", plan.perDay)
            : C.planSentence(productTitle, goalVerb, platformLabel, plan.currency ?? "AED", plan.perDay)}
        </p>

        <Card className="mt-6 divide-y divide-hairline dark:divide-ink-muted/20">
          {/* Goal */}
          <div className="p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <span className="text-ink-muted">{C.goalLine}</span>{" "}
                <span className="ml-3 font-medium">{STRINGS.goals[plan.goal ?? "best"]}</span>
              </div>
              <button type="button" aria-label={`Edit ${C.goalLine}`} onClick={() => setEditLine(editLine === "goal" ? null : "goal")} className="min-h-11 px-3 text-accent">✎</button>
            </div>
            {editLine === "goal" && (
              <div className="mt-2 flex flex-wrap gap-2">
                {Object.entries(STRINGS.goals).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() =>
                      void api.patchSpec(plan.specId, { goal: k }).then((u) => {
                        setPlan({ ...plan, ...u });
                        setEditLine(null);
                      })
                    }
                    className={`min-h-11 rounded-control border px-3 text-sm ${plan.goal === k ? "border-accent bg-accent-soft" : "border-hairline"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Shows on */}
          <div className="p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <span className="text-ink-muted">{C.showsOnLine}</span>{" "}
                <span className="ml-3 font-medium">{platformLabel}</span>
              </div>
              <button type="button" aria-label={`Edit ${C.showsOnLine}`} onClick={() => setEditLine(editLine === "platforms" ? null : "platforms")} className="min-h-11 px-3 text-accent">✎</button>
            </div>
            {editLine === "platforms" && (
              <div className="mt-2 space-y-2">
                {(["meta", "tiktok", "google", "snapchat", "pinterest"] as const).map((p) => {
                  const conn = connections.find((c) => c.platform === p);
                  const connected = conn?.connected ?? false;
                  const on = plan.platforms.includes(p);
                  return (
                    <label key={p} className="flex min-h-11 items-center justify-between text-sm">
                      <span>
                        {STRINGS.platformNames[p]}
                        {!connected && (
                          <span className="ml-2 text-xs text-ink-muted">
                            {C.connectNote(STRINGS.platformNames[p]!)}
                          </span>
                        )}
                      </span>
                      <input
                        type="checkbox"
                        className="h-5 w-5"
                        checked={on}
                        disabled={!connected && !on}
                        onChange={() => {
                          const next = on
                            ? plan.platforms.filter((x) => x !== p)
                            : [...plan.platforms, p];
                          if (next.length === 0) return;
                          void api
                            .patchSpec(plan.specId, { target_platforms: next })
                            .then((u) => setPlan({ ...plan, ...u }));
                        }}
                      />
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Per day */}
          <div className="p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <span className="text-ink-muted">{C.perDayLine}</span>{" "}
                <span className="ml-3 font-medium">
                  <Money value={plan.perDay} currency={plan.currency ?? "AED"} />{" "}
                  <span className="text-xs text-ink-muted">{C.perDaySuggested}</span>
                </span>
              </div>
              <button type="button" aria-label={`Edit ${C.perDayLine}`} onClick={() => setEditLine(editLine === "budget" ? null : "budget")} className="min-h-11 px-3 text-accent">✎</button>
            </div>
            {editLine === "budget" && (
              <div className="mt-2">
                <input
                  type="number"
                  defaultValue={plan.perDay}
                  aria-label={C.budgetLabel}
                  onBlur={(e) =>
                    void api
                      .patchSpec(plan.specId, { daily_budget: Number(e.target.value) })
                      .then((u) => setPlan({ ...plan, ...u }))
                  }
                  className="min-h-11 w-40 rounded-control border border-hairline bg-surface px-3 font-mono dark:bg-surface-dark"
                />
              </div>
            )}
            {lowBudget && (
              <p className="mt-2 text-xs text-attention-deep" data-testid="low-budget-note">
                {C.lowBudgetNote}
              </p>
            )}
          </div>

          {/* People go to (FLOW §5.6, §6) */}
          <div className="p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <span className="text-ink-muted">{C.peopleGoToLine}</span>{" "}
                <span className="ml-3 font-medium" data-testid="destination-line">
                  {plan.destination
                    ? plan.destination.kind === "hosted_page"
                      ? C.destHostedPage
                      : plan.destination.kind === "hosted_form"
                        ? C.destHostedForm
                        : plan.destination.kind === "whatsapp"
                          ? C.destWhatsapp
                          : plan.destination.kind === "call"
                            ? C.destCall
                            : plan.destination.value
                    : C.choose}
                </span>
              </div>
              <button type="button" aria-label={`Edit ${C.peopleGoToLine}`} onClick={() => setEditLine(editLine === "destination" ? null : "destination")} className="min-h-11 px-3 text-accent">✎</button>
            </div>
            {editLine === "destination" && (
              <fieldset className="mt-3">
                <legend className="text-sm font-medium">{C.destinationQuestion}</legend>
                <div className="mt-2 space-y-2 text-sm">
                  {(
                    [
                      ["url", C.destWebsite, C.destWebsiteHint],
                      ["hosted_page", C.destHostedPage, ""],
                      ["hosted_form", C.destHostedForm, C.destHostedFormHint],
                      ["whatsapp", C.destWhatsapp, C.destWhatsappHint],
                      ["call", C.destCall, C.destCallHint],
                    ] as const
                  ).map(([kind, label, hint]) => (
                    <label key={kind} className="flex min-h-11 items-center gap-2">
                      <input
                        type="radio"
                        name="destination"
                        value={kind}
                        checked={destKind === kind}
                        onChange={() => setDestKind(kind)}
                      />
                      {label} {hint && <span className="text-xs text-ink-muted">{hint}</span>}
                    </label>
                  ))}
                  {(destKind === "url" || destKind === "whatsapp" || destKind === "call") && (
                    <input
                      value={destValue}
                      onChange={(e) => setDestValue(e.target.value)}
                      placeholder={destKind === "url" ? "https://…" : "+971…"}
                      aria-label={destKind === "url" ? C.destWebsite : C.destWhatsapp}
                      className="min-h-11 w-full rounded-control border border-hairline bg-surface px-3 dark:bg-surface-dark"
                    />
                  )}
                  {(destKind === "whatsapp" || destKind === "call") && (
                    <p className="text-xs text-ink-muted">{C.destHardToMeasure}</p>
                  )}
                  <button
                    type="button"
                    data-testid="use-this"
                    onClick={() => void applyDestination()}
                    className="min-h-11 rounded-control bg-accent px-5 text-sm font-medium text-white hover:bg-accent-deep"
                  >
                    {C.useThis}
                  </button>
                </div>
              </fieldset>
            )}
          </div>
        </Card>

        {/* Your ads (FLOW §5.7) — per-product creative is automatic for catalogs. */}
        {catalogCount <= 1 && (
          <section className="mt-6">
            <h2 className="text-lg font-semibold">{C.yourAds}</h2>
            {/* Format preview tabs (W5): the same ads in each shape they run in. */}
            <div className="mt-3 flex gap-2" role="tablist" aria-label={C.yourAds}>
              {(["1:1", "9:16", "16:9"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="tab"
                  aria-selected={previewFormat === f}
                  onClick={() => setPreviewFormat(f)}
                  className={`min-h-11 rounded-control border px-3 text-sm ${previewFormat === f ? "border-accent text-accent" : "border-hairline text-ink-muted"}`}
                >
                  {C.formatTabs[f]}
                </button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {creatives
                .filter((c) => c.format === previewFormat)
                .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  data-testid="creative-tile"
                  onClick={() => {
                    setEditing(c.id);
                    setEditHeadline(c.headline ?? "");
                    setEditBody(c.body ?? "");
                  }}
                  className={`rounded-card border p-3 text-left text-xs ${selected.has(c.id) ? "border-accent" : "border-hairline"} bg-accent-soft/40`}
                >
                  <div
                    className={`flex items-center justify-center rounded-control bg-accent-soft text-center font-medium text-accent ${
                      previewFormat === "9:16"
                        ? "mx-auto aspect-[9/16] w-2/3"
                        : previewFormat === "16:9"
                          ? "aspect-video"
                          : "aspect-square"
                    }`}
                  >
                    {c.headline}
                  </div>
                  <p className="mt-2 text-ink-muted">{c.body}</p>
                </button>
              ))}
            </div>
            <p className="mt-2 text-sm text-ink-muted">
              {C.creativeHelp(creatives.filter((c) => c.format === previewFormat).length)}
            </p>
            <button
              type="button"
              onClick={() =>
                void api.generateCreatives(plan.specId).then((g) => {
                  setCreatives(g.creatives);
                  setSelected(new Set(g.creatives.filter((c) => c.format === "1:1").map((c) => c.id)));
                })
              }
              className="mt-1 min-h-11 text-sm text-accent"
            >
              {C.makeNew}
            </button>
            {editing && (
              <Card className="mt-3 p-4">
                <label className="block text-sm">
                  {C.editWords}
                  <input
                    value={editHeadline}
                    onChange={(e) => setEditHeadline(e.target.value)}
                    className="mt-1 block w-full min-h-11 rounded-control border border-hairline px-3 dark:bg-surface-dark"
                  />
                  <textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    rows={2}
                    className="mt-2 block w-full rounded-control border border-hairline px-3 py-2 dark:bg-surface-dark"
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    void api
                      .editCreative(editing, { headline: editHeadline, body: editBody })
                      .then(() => {
                        setCreatives(
                          creatives.map((c) =>
                            c.id === editing ? { ...c, headline: editHeadline, body: editBody } : c,
                          ),
                        );
                        setEditing(null);
                      })
                  }
                  className="mt-3 min-h-11 rounded-control bg-accent px-4 text-sm text-white hover:bg-accent-deep"
                >
                  {STRINGS.product.save}
                </button>
              </Card>
            )}
          </section>
        )}

        {restricted && (
          <p className="mt-6 rounded-card border border-attention/40 bg-attention/10 p-4 text-sm" data-testid="restricted-notice">
            {C.restrictedNotice}
          </p>
        )}

        <div className="fixed inset-x-0 bottom-14 bg-canvas/95 px-4 py-3 backdrop-blur sm:sticky sm:bottom-0 sm:px-0 dark:bg-canvas-dark/95">
          <div className="mx-auto max-w-xl">
            <p className="mb-2 text-center text-xs text-ink-muted">{C.preLaunchReassurance}</p>
            <button
              type="button"
              data-testid="launch-button"
              disabled={busy}
              onClick={() => void handleLaunch()}
              className="min-h-12 w-full rounded-control bg-accent text-base font-semibold text-white hover:bg-accent-deep disabled:opacity-60"
            >
              {busy ? C.settingUp : restricted ? C.submitForReview : C.launch}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- Step: add (FLOW §4) ----------
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold">{C.addTitle}</h1>
      <p className="mt-1 text-sm text-ink-muted">{C.addSubtitle}</p>
      {notice && (
        <p className="mt-3 rounded-card bg-accent-soft p-3 text-sm" data-testid="intake-notice">
          {notice}
        </p>
      )}
      <Card className="mt-4 p-4">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={C.inputPlaceholder}
          rows={3}
          aria-label={C.addTitle}
          data-testid="add-input"
          className="w-full resize-none rounded-control border border-hairline bg-surface p-3 text-base dark:border-white/15 dark:bg-surface-dark"
        />
        <div className="mt-3 flex flex-wrap justify-center gap-4 text-sm">
          <button type="button" onClick={() => inputRef.current?.focus()} className="min-h-11 text-accent">
            🔗 {C.wayLink}
          </button>
          <button type="button" onClick={() => inputRef.current?.focus()} className="min-h-11 text-accent">
            ✎ {C.wayDescribe}
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            title={C.listHint}
            className="min-h-11 text-accent"
          >
            ⬆ {C.wayList}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            data-testid="file-input"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <label className="block text-sm text-ink-muted">
          {C.goalLabel}
          <select
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            className="mt-1 block w-full min-h-11 rounded-control border border-hairline bg-surface px-3 text-ink dark:bg-surface-dark dark:text-white dark:border-white/15"
          >
            <option value="best">{C.goalDefault}</option>
            {Object.entries(STRINGS.goals)
              .filter(([k]) => k !== "best")
              .map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        <label className="block text-sm text-ink-muted">
          {C.budgetLabel}
          <input
            type="number"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            placeholder={C.budgetDefault}
            className="mt-1 block w-full min-h-11 rounded-control border border-hairline bg-surface px-3 font-mono text-ink dark:bg-surface-dark dark:text-white dark:border-white/15"
          />
        </label>
      </div>

      <div className="mt-6">
        <button
          type="button"
          data-testid="continue-button"
          disabled={!input.trim()}
          onClick={() => void handleContinue()}
          className="min-h-12 w-full rounded-control bg-accent text-base font-semibold text-white hover:bg-accent-deep disabled:opacity-50 sm:w-auto sm:px-8"
        >
          {C.continue} →
        </button>
      </div>
    </div>
  );
}
