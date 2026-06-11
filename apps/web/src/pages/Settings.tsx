// Settings (UX §6.6): connections, results tracking readiness, spending
// limits incl. the stop-everything switch, brand kit, autonomy + sign-offs.
import { useEffect, useState } from "react";
import { STRINGS } from "../strings";
import { api, type RuleData, type SettingsData } from "../api";
import { Card, Dialog, Num, PageHeader, Section } from "../components";

export default function Settings(): JSX.Element {
  const [data, setData] = useState<SettingsData | null>(null);
  const [saved, setSaved] = useState(false);
  const [kit, setKit] = useState<Record<string, string>>({});
  const [siteList, setSiteList] = useState<{ sourceSite: string; label: string | null }[]>([]);
  const [newSite, setNewSite] = useState("");
  const [issuedKey, setIssuedKey] = useState<{ site: string; key: string } | null>(null);
  const [connectFor, setConnectFor] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof api.connections>>["platforms"]>([]);
  const [aiCatalog, setAiCatalog] = useState<Awaited<ReturnType<typeof api.connections>>["ai"] | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [connectNote, setConnectNote] = useState<string | null>(null);
  const [siteType, setSiteType] = useState<"custom" | "shopify" | "wordpress">("custom");
  const [rules, setRules] = useState<RuleData[]>([]);
  const [aiMgr, setAiMgr] = useState<{ enabled: boolean; auto: boolean } | null>(null);
  const [aiRunning, setAiRunning] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState({
    name: "",
    scope: "all",
    product_id: "",
    metric: "cost_per_result",
    window_days: 3,
    comparator: "gt",
    threshold: "",
    action: "notify",
  });

  async function reload(): Promise<void> {
    const d = await api.settings();
    setData(d);
    setKit(d.brandKit);
    const s = await api.sites();
    setSiteList(s.sites);
    const c = await api.connections();
    setCatalog(c.platforms);
    setAiCatalog(c.ai);
    const r = await api.rules();
    setRules(r.rules);
    setAiMgr(await api.aiManager());
  }
  useEffect(() => {
    void reload();
  }, []);

  if (!data) return <p className="text-ink-muted">{STRINGS.common.loading}</p>;

  const coverageBySite = new Map<string, { platform: string; pct: number }[]>();
  for (const c of data.coverage) {
    const list = coverageBySite.get(c.sourceSite) ?? [];
    list.push({ platform: c.platform, pct: Number(c.coveragePct) });
    coverageBySite.set(c.sourceSite, list);
  }

  async function toggleKill(): Promise<void> {
    await api.setKillSwitch(!data!.killSwitch);
    await reload();
  }

  async function patchGuardrail(key: string, value: number): Promise<void> {
    await api.patchGuardrails({ [key]: value });
    await reload();
  }

  return (
    <div>
      <PageHeader title={STRINGS.settings.title} intro={STRINGS.pageIntro.settings} />
      <div className="max-w-2xl">
        <Section title={STRINGS.settings.connections}>
          <Card>
            {data.connections.map((c) => (
              <div
                key={c.platform}
                className="flex min-h-16 items-center justify-between border-b border-hairline/70 px-5 transition-colors duration-150 last:border-b-0 hover:bg-ink/[0.015] dark:border-white/10 dark:hover:bg-white/[0.02]"
              >
                <span>
                  {STRINGS.platformNames[c.platform] ?? c.platform}
                  {c.accountRef && (
                    <span className="ml-2 font-mono text-xs text-ink-muted" data-testid="linked-account">
                      {STRINGS.settings.connectAccount(c.accountRef)}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-3 text-sm">
                  {c.connected && c.mode === "stub" ? (
                    <span
                      className="text-attention-deep"
                      title={STRINGS.settings.connectionTestHint}
                    >
                      {STRINGS.settings.connectionTest}
                    </span>
                  ) : (
                    <span className={c.connected && c.tokenValid ? "text-positive" : "text-critical"}>
                      {c.connected
                        ? c.tokenValid
                          ? STRINGS.settings.connectionOk
                          : STRINGS.settings.connectionProblem
                        : STRINGS.settings.notConnected}
                    </span>
                  )}
                  <button
                    type="button"
                    data-testid="connect-button"
                    onClick={() => setConnectFor(c.platform)}
                    className="min-h-11 rounded-control px-3 text-accent hover:bg-accent-soft dark:hover:bg-accent/15"
                  >
                    {c.connected && c.mode === "live" ? STRINGS.settings.reconnect : STRINGS.settings.connect}
                  </button>
                </span>
              </div>
            ))}
            <div className="flex min-h-16 items-center justify-between border-t border-hairline/70 px-5 transition-colors duration-150 hover:bg-ink/[0.015] dark:border-white/10 dark:hover:bg-white/[0.02]">
              <span>
                {STRINGS.settings.aiName}
                {aiCatalog?.provider && (
                  <span className="ml-2 font-mono text-xs text-ink-muted" data-testid="ai-provider">
                    {STRINGS.settings.aiProviders[aiCatalog.provider] ?? aiCatalog.provider}
                  </span>
                )}
              </span>
              <span className="flex items-center gap-3 text-sm">
                {aiCatalog?.savedAt && aiCatalog.mode === "live" ? (
                  <span className="text-positive">{STRINGS.settings.connectionOk}</span>
                ) : (
                  <span className="text-attention-deep" title={STRINGS.settings.connectionTestHint}>
                    {STRINGS.settings.connectionTest}
                  </span>
                )}
                <button
                  type="button"
                  data-testid="connect-ai"
                  onClick={() => setConnectFor("ai")}
                  className="min-h-11 rounded-control px-3 text-accent hover:bg-accent-soft dark:hover:bg-accent/15"
                >
                  {aiCatalog?.savedAt ? STRINGS.settings.reconnect : STRINGS.settings.connect}
                </button>
              </span>
            </div>
          </Card>
        </Section>

        {connectFor && (
          <Dialog
            title={STRINGS.settings.connectTitle(
              connectFor === "ai"
                ? STRINGS.settings.aiName
                : STRINGS.platformNames[connectFor] ?? connectFor,
            )}
            onClose={() => {
              setConnectFor(null);
              setForm({});
              setConnectNote(null);
            }}
          >
            <p className="mt-3 text-sm text-ink-muted">{STRINGS.settings.connectIntro}</p>
            <ol className="mt-3 space-y-2">
              {[
                STRINGS.settings.connectStep1,
                STRINGS.settings.connectStep2,
                STRINGS.settings.connectStep3,
              ].map((step, i) => (
                <li key={i} className="flex gap-3 text-xs leading-relaxed text-ink-muted">
                  <span
                    aria-hidden="true"
                    className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-soft font-mono text-[10px] text-accent dark:bg-accent/15"
                  >
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void api
                  .saveConnection(connectFor, form)
                  .then(() => {
                    setConnectNote(STRINGS.settings.connectSavedNote);
                    setForm({});
                    void reload();
                  })
                  .catch(() => setConnectNote(STRINGS.settings.connectMissing));
              }}
            >
              {(connectFor === "ai"
                ? (aiCatalog?.fields ?? []).map((f) => ({ ...f, choices: f.choices }))
                : (catalog.find((p) => p.platform === connectFor)?.fields ?? []).map((f) => ({
                    ...f,
                    choices: null as string[] | null,
                  }))
              ).map((f) => {
                const label =
                  connectFor === "ai"
                    ? STRINGS.settings.aiFieldLabels[f.key] ?? f.key.replace(/_/g, " ")
                    : STRINGS.settings.connectFieldLabels[`${connectFor}.${f.key}`] ??
                      f.key.replace(/_/g, " ");
                const help = STRINGS.settings.connectFieldHelp[`${connectFor}.${f.key}`];
                const choiceLabels =
                  f.key === "provider" ? STRINGS.settings.aiProviders : STRINGS.settings.aiModeChoices;
                return (
                  <label key={f.key} className="block text-sm">
                    <span className="font-medium">{label}</span>
                    {f.savedMask && (
                      <span className="ml-2 font-mono text-xs text-ink-muted">{f.savedMask}</span>
                    )}
                    {f.choices ? (
                      <select
                        value={form[f.key] ?? f.savedMask ?? ""}
                        onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                        data-testid={`connect-field-${f.key}`}
                        className="mt-1 block w-full min-h-11 rounded-control border border-hairline bg-surface px-3 text-sm dark:bg-surface-dark dark:border-white/15"
                      >
                        <option value="" disabled>
                          —
                        </option>
                        {f.choices.map((c) => (
                          <option key={c} value={c}>
                            {choiceLabels[c] ?? c}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={f.secret ? "password" : "text"}
                        value={form[f.key] ?? ""}
                        onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                        placeholder={f.savedMask ?? undefined}
                        autoComplete="off"
                        data-testid={`connect-field-${f.key}`}
                        className="mt-1 block w-full min-h-11 rounded-control border border-hairline bg-surface px-3 font-mono text-sm dark:bg-surface-dark dark:border-white/15"
                      />
                    )}
                    {help && <span className="mt-1 block text-xs leading-relaxed text-ink-muted">{help}</span>}
                  </label>
                );
              })}
              {connectNote && (
                <p className="rounded-control bg-accent-soft p-3 text-xs leading-relaxed text-accent-deep dark:bg-accent/15" data-testid="connect-note">
                  {connectNote}
                </p>
              )}
              <p className="rounded-control bg-attention/10 p-3 text-xs leading-relaxed text-attention-deep">
                {STRINGS.settings.connectTestNote}
              </p>
              <button
                type="submit"
                data-testid="connect-save"
                className="min-h-11 w-full rounded-control bg-accent text-sm font-medium text-white hover:bg-accent-deep"
              >
                {STRINGS.settings.connectSave}
              </button>
            </form>
          </Dialog>
        )}

        <Section title={STRINGS.sitesSection.title} hint={STRINGS.sitesSection.hint}>
          <Card className="p-5">
            {siteList.length === 0 && (
              <p className="text-sm text-ink-muted">{STRINGS.sitesSection.empty}</p>
            )}
            {siteList.map((site) => (
              <div key={site.sourceSite} className="flex min-h-11 items-center justify-between text-sm">
                <span className="font-mono">{site.sourceSite}</span>
                <span className="text-ink-muted">{site.label ?? ""}</span>
              </div>
            ))}
            <label className="mt-3 block text-sm">
              {STRINGS.sitesSection.typeLabel}
              <select
                value={siteType}
                onChange={(e) => setSiteType(e.target.value as typeof siteType)}
                data-testid="site-type"
                className="mt-1 block w-full min-h-11 rounded-control border border-hairline bg-surface px-3 text-sm dark:bg-surface-dark dark:border-white/15"
              >
                <option value="custom">{STRINGS.sitesSection.typeCustom}</option>
                <option value="shopify">{STRINGS.sitesSection.typeShopify}</option>
                <option value="wordpress">{STRINGS.sitesSection.typeWordpress}</option>
              </select>
            </label>
            <div className="mt-3 flex gap-2">
              <input
                value={newSite}
                onChange={(e) => setNewSite(e.target.value)}
                aria-label={STRINGS.sitesSection.addLabel}
                placeholder={STRINGS.sitesSection.addLabel}
                data-testid="add-site-input"
                className="min-h-11 flex-1 rounded-control border border-hairline bg-surface px-3 font-mono text-sm dark:bg-surface-dark dark:border-white/15"
              />
              <button
                type="button"
                data-testid="add-site-button"
                onClick={() =>
                  void api.addSite(newSite.trim(), siteType).then((r) => {
                    setIssuedKey(r);
                    setNewSite("");
                    void reload();
                  })
                }
                disabled={!newSite.trim()}
                className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-white hover:bg-accent-deep disabled:opacity-50"
              >
                {STRINGS.sitesSection.addButton}
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">
              {STRINGS.sitesSection.addHint}
            </p>
            {issuedKey && (
              <div className="mt-3 space-y-3 rounded-control bg-accent-soft p-3 text-xs dark:bg-accent/10" data-testid="issued-key">
                <p className="font-medium">{STRINGS.sitesSection.keyNotice}</p>
                <code className="block break-all font-mono">{issuedKey.key}</code>
                <p className="font-medium">
                  {siteType === "shopify"
                    ? STRINGS.sitesSection.installShopify1
                    : siteType === "wordpress"
                      ? STRINGS.sitesSection.installWordpress
                      : STRINGS.sitesSection.installCustom}
                </p>
                <code className="block break-all font-mono">
                  {`<script src="${window.location.origin}/pixel.js" data-site="${issuedKey.site}" data-key="${issuedKey.key}"></script>`}
                </code>
                {siteType === "shopify" && (
                  <>
                    <p className="font-medium">{STRINGS.sitesSection.installShopify2}</p>
                    <code className="block whitespace-pre-wrap break-all font-mono">
{`analytics.subscribe("checkout_completed", async (event) => {
  const c = event.data.checkout;
  await fetch("${window.location.origin}/v1/events", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "${issuedKey.key}" },
    body: JSON.stringify({
      event_name: "Purchase",
      event_time: Math.floor(Date.now() / 1000),
      value: Number(c.totalPrice?.amount ?? 0),
      currency: c.totalPrice?.currencyCode ?? "AED",
      content_id: String(c.lineItems?.[0]?.variant?.product?.id ?? "${issuedKey.site}"),
      event_id: String(c.order?.id ?? c.token),
      source_site: "${issuedKey.site}",
    }),
  });
});`}
                    </code>
                  </>
                )}
              </div>
            )}
          </Card>
        </Section>

        <Section title={STRINGS.settings.tracking} hint={STRINGS.settings.trackingHint}>
          <Card className="p-5">
            {coverageBySite.size === 0 && (
              <p className="text-sm text-ink-muted">{STRINGS.kpi.noData}</p>
            )}
            {[...coverageBySite.entries()].map(([site, rows]) => {
              const avg = rows.reduce((s, r) => s + r.pct, 0) / rows.length;
              const readiness =
                avg >= 75
                  ? STRINGS.settings.trackingReady
                  : avg >= 40
                    ? STRINGS.settings.trackingPartial
                    : STRINGS.settings.trackingPoor;
              const sig = data.signal.find((x) => x.sourceSite === site);
              const sigScore = sig ? Number(sig.avgScore) : null;
              const sigLabel =
                sigScore === null
                  ? null
                  : sigScore >= 7
                    ? STRINGS.sitesSection.signalStrong
                    : sigScore >= 4
                      ? STRINGS.sitesSection.signalOk
                      : STRINGS.sitesSection.signalWeak;
              return (
                <div key={site} className="mb-3 last:mb-0">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{site}</span>
                    <span className={avg >= 75 ? "text-positive" : "text-attention-deep"}>{readiness}</span>
                  </div>
                  {sigLabel && (
                    <div className="mt-1 flex items-center justify-between text-xs" data-testid="signal-strength">
                      <span className="text-ink-muted">{STRINGS.sitesSection.signalTitle}</span>
                      <span className={sigScore! >= 7 ? "text-positive" : "text-attention-deep"}>
                        {sigLabel} · <span className="font-mono">{sigScore!.toFixed(1)}/10</span>
                      </span>
                    </div>
                  )}
                  {sigScore !== null && sigScore < 7 && (
                    <p className="mt-1 text-xs text-ink-muted">{STRINGS.sitesSection.signalTip}</p>
                  )}
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-ink-muted">
                    {rows.map((r) => (
                      <div key={r.platform}>
                        {STRINGS.platformNames[r.platform] ?? r.platform}: <Num value={`${r.pct.toFixed(0)}%`} />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </Card>
        </Section>

        <Section title={STRINGS.settings.guardrails} hint={STRINGS.settings.guardrailsHint}>
          <Card className="space-y-4 p-5">
            {(
              [
                ["globalDailyCap", STRINGS.settings.globalCap],
                ["perCampaignDailyCap", STRINGS.settings.perProductCap],
                ["maxBudgetChangePct", STRINGS.settings.maxStep],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center justify-between gap-4 text-sm">
                {label}
                <input
                  type="number"
                  defaultValue={Number(data.guardrails[key])}
                  onBlur={(e) => void patchGuardrail(key, Number(e.target.value))}
                  className="min-h-11 w-32 rounded-control border border-hairline bg-surface px-3 font-mono dark:bg-surface-dark dark:border-white/15"
                  aria-label={label}
                />
              </label>
            ))}
            <div className="border-t border-hairline pt-4 dark:border-white/10">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{STRINGS.settings.killSwitch}</div>
                  <p className="mt-1 text-xs text-ink-muted">{STRINGS.settings.killSwitchHint}</p>
                  <p
                    className={`mt-1 text-xs ${data.killSwitch ? "text-critical" : "text-positive"}`}
                    data-testid="kill-switch-state"
                  >
                    {data.killSwitch ? STRINGS.settings.killSwitchOn : STRINGS.settings.killSwitchOff}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={data.killSwitch}
                  aria-label={STRINGS.settings.killSwitch}
                  data-testid="kill-switch-toggle"
                  onClick={() => void toggleKill()}
                  className={`min-h-11 rounded-control px-5 text-sm font-medium text-white ${
                    data.killSwitch ? "bg-positive" : "bg-critical"
                  }`}
                >
                  {data.killSwitch ? STRINGS.product.resume : STRINGS.settings.killSwitch}
                </button>
              </div>
            </div>
          </Card>
        </Section>


        <Section title={STRINGS.aiManager.title} hint={STRINGS.aiManager.hint}>
          <Card className="space-y-4 p-5">
            {(
              [
                ["enabled", STRINGS.aiManager.enabled, aiMgr?.enabled ?? false],
                ["auto", STRINGS.aiManager.auto, aiMgr?.auto ?? false],
              ] as const
            ).map(([key, label, value]) => (
              <div key={key} className="flex items-center justify-between gap-4 text-sm">
                <div>
                  <span className="font-medium">{label}</span>
                  {key === "auto" && !value && (
                    <p className="mt-0.5 text-xs text-ink-muted">{STRINGS.aiManager.autoOff}</p>
                  )}
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={value}
                  aria-label={label}
                  data-testid={`ai-manager-${key}`}
                  onClick={() =>
                    void api.setAiManager({ [key]: !value }).then(setAiMgr)
                  }
                  className={`min-h-11 rounded-full px-4 text-xs font-medium ${
                    value
                      ? "bg-positive/10 text-positive-deep"
                      : "bg-ink/5 text-ink-muted dark:bg-white/10"
                  }`}
                >
                  {value ? STRINGS.rules.on : STRINGS.rules.off}
                </button>
              </div>
            ))}
            <div className="border-t border-hairline/70 pt-4 dark:border-white/10">
              <button
                type="button"
                data-testid="ai-manager-run"
                disabled={aiRunning}
                onClick={() => {
                  setAiRunning(true);
                  setAiResult(null);
                  void api
                    .runAiManager(!(aiMgr?.auto ?? false))
                    .then((r) =>
                      setAiResult(
                        STRINGS.aiManager.ranLine(r.proposed, r.executed.length, r.notes.length),
                      ),
                    )
                    .finally(() => setAiRunning(false));
                }}
                className="min-h-11 rounded-control bg-accent px-5 text-sm font-medium text-white hover:bg-accent-deep disabled:opacity-50"
              >
                {aiRunning ? STRINGS.aiManager.running : STRINGS.aiManager.runNow}
              </button>
              {aiResult && (
                <p className="mt-2 text-xs leading-relaxed text-positive-deep" data-testid="ai-manager-result">
                  {aiResult}
                </p>
              )}
              <p className="mt-2 text-xs leading-relaxed text-ink-muted">{STRINGS.aiManager.needsAi}</p>
            </div>
          </Card>
        </Section>

        <Section title={STRINGS.rules.title} hint={STRINGS.rules.hint}>
          <Card>
            {rules.length === 0 && (
              <p className="p-5 text-sm text-ink-muted">{STRINGS.rules.empty}</p>
            )}
            {rules.map((r) => (
              <div
                key={r.id}
                data-testid="rule-row"
                className="flex min-h-14 items-center justify-between gap-3 border-b border-hairline/70 px-5 text-sm last:border-b-0 dark:border-white/10"
              >
                <div>
                  <span className="font-medium">{r.name}</span>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                    {STRINGS.rules.sentence(
                      STRINGS.rules.metrics[r.metric] ?? r.metric,
                      STRINGS.rules.windowDays(r.windowDays),
                      STRINGS.rules.comparators[r.comparator] ?? r.comparator,
                      String(r.threshold),
                      STRINGS.rules.actions[r.action] ?? r.action,
                    )}
                    {r.scope === "product" &&
                      ` ${STRINGS.rules.scope}: ${data.autonomy.find((a) => a.productId === r.productId)?.title ?? r.productId}.`}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={r.enabled}
                    aria-label={r.name}
                    data-testid="rule-toggle"
                    onClick={() =>
                      void api.setRuleEnabled(r.id, !r.enabled).then(() =>
                        setRules(rules.map((x) => (x.id === r.id ? { ...x, enabled: !r.enabled } : x))),
                      )
                    }
                    className={`min-h-11 rounded-full px-4 text-xs font-medium ${
                      r.enabled
                        ? "bg-positive/10 text-positive-deep"
                        : "bg-ink/5 text-ink-muted dark:bg-white/10"
                    }`}
                  >
                    {r.enabled ? STRINGS.rules.on : STRINGS.rules.off}
                  </button>
                  <button
                    type="button"
                    data-testid="rule-delete"
                    onClick={() =>
                      void api.deleteRule(r.id).then(() => setRules(rules.filter((x) => x.id !== r.id)))
                    }
                    className="min-h-11 rounded-control px-3 text-xs text-critical hover:bg-critical/10"
                  >
                    {STRINGS.rules.remove}
                  </button>
                </span>
              </div>
            ))}
            <form
              className="grid gap-3 border-t border-hairline/70 p-5 sm:grid-cols-2 dark:border-white/10"
              onSubmit={(e) => {
                e.preventDefault();
                if (!ruleForm.name.trim() || !ruleForm.threshold) return;
                void api
                  .addRule({
                    name: ruleForm.name.trim(),
                    scope: ruleForm.scope,
                    product_id: ruleForm.scope === "product" ? ruleForm.product_id : undefined,
                    metric: ruleForm.metric,
                    window_days: Number(ruleForm.window_days),
                    comparator: ruleForm.comparator,
                    threshold: Number(ruleForm.threshold),
                    action: ruleForm.action,
                  })
                  .then(() => {
                    setRuleForm({ ...ruleForm, name: "", threshold: "" });
                    void reload();
                  });
              }}
            >
              <label className="block text-sm sm:col-span-2">
                {STRINGS.rules.name}
                <input
                  value={ruleForm.name}
                  onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })}
                  data-testid="rule-name"
                  className="mt-1 block w-full min-h-11 rounded-control border border-hairline bg-surface px-3 dark:bg-surface-dark dark:border-white/15"
                />
              </label>
              <label className="block text-sm">
                {STRINGS.rules.metric}
                <select
                  value={ruleForm.metric}
                  onChange={(e) => setRuleForm({ ...ruleForm, metric: e.target.value })}
                  className="mt-1 block w-full min-h-11 rounded-control border border-hairline bg-surface px-3 text-sm dark:bg-surface-dark dark:border-white/15"
                >
                  {Object.entries(STRINGS.rules.metrics).map(([k, label]) => (
                    <option key={k} value={k}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                {STRINGS.rules.window}
                <select
                  value={ruleForm.window_days}
                  onChange={(e) => setRuleForm({ ...ruleForm, window_days: Number(e.target.value) })}
                  className="mt-1 block w-full min-h-11 rounded-control border border-hairline bg-surface px-3 text-sm dark:bg-surface-dark dark:border-white/15"
                >
                  {[1, 3, 7].map((n) => (
                    <option key={n} value={n}>{STRINGS.rules.windowDays(n)}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                {STRINGS.rules.comparator}
                <select
                  value={ruleForm.comparator}
                  onChange={(e) => setRuleForm({ ...ruleForm, comparator: e.target.value })}
                  className="mt-1 block w-full min-h-11 rounded-control border border-hairline bg-surface px-3 text-sm dark:bg-surface-dark dark:border-white/15"
                >
                  {Object.entries(STRINGS.rules.comparators).map(([k, label]) => (
                    <option key={k} value={k}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                {STRINGS.rules.threshold}
                <input
                  type="number"
                  step="any"
                  value={ruleForm.threshold}
                  onChange={(e) => setRuleForm({ ...ruleForm, threshold: e.target.value })}
                  data-testid="rule-threshold"
                  className="mt-1 block w-full min-h-11 rounded-control border border-hairline bg-surface px-3 font-mono dark:bg-surface-dark dark:border-white/15"
                />
              </label>
              <label className="block text-sm">
                {STRINGS.rules.action}
                <select
                  value={ruleForm.action}
                  onChange={(e) => setRuleForm({ ...ruleForm, action: e.target.value })}
                  className="mt-1 block w-full min-h-11 rounded-control border border-hairline bg-surface px-3 text-sm dark:bg-surface-dark dark:border-white/15"
                >
                  {Object.entries(STRINGS.rules.actions).map(([k, label]) => (
                    <option key={k} value={k}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                {STRINGS.rules.scope}
                <select
                  value={ruleForm.scope === "all" ? "all" : ruleForm.product_id}
                  onChange={(e) => {
                    const v = e.target.value;
                    setRuleForm(
                      v === "all"
                        ? { ...ruleForm, scope: "all", product_id: "" }
                        : { ...ruleForm, scope: "product", product_id: v },
                    );
                  }}
                  className="mt-1 block w-full min-h-11 rounded-control border border-hairline bg-surface px-3 text-sm dark:bg-surface-dark dark:border-white/15"
                >
                  <option value="all">{STRINGS.rules.scopeAll}</option>
                  {data.autonomy.map((a) => (
                    <option key={a.productId} value={a.productId}>{a.title}</option>
                  ))}
                </select>
              </label>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  data-testid="rule-add"
                  disabled={!ruleForm.name.trim() || !ruleForm.threshold}
                  className="min-h-11 rounded-control bg-accent px-5 text-sm font-medium text-white hover:bg-accent-deep disabled:opacity-50"
                >
                  {STRINGS.rules.add}
                </button>
                <p className="mt-2 text-xs leading-relaxed text-ink-muted">{STRINGS.rules.cooldownHint}</p>
              </div>
            </form>
          </Card>
        </Section>

        <Section title={STRINGS.settings.brandKit} hint={STRINGS.settings.brandKitHint}>
          <Card className="space-y-3 p-5">
            {(
              [
                ["logoUrl", STRINGS.settings.brandLogo],
                ["primaryColor", STRINGS.settings.brandColor],
                ["font", STRINGS.settings.brandFont],
                ["tone", STRINGS.settings.brandTone],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block text-sm">
                {label}
                <input
                  value={kit[key] ?? ""}
                  onChange={(e) => setKit({ ...kit, [key]: e.target.value })}
                  className="mt-1 block w-full min-h-11 rounded-control border border-hairline bg-surface px-3 dark:bg-surface-dark dark:border-white/15"
                />
              </label>
            ))}
            <button
              type="button"
              onClick={() =>
                void api.saveBrandKit(kit).then(() => {
                  setSaved(true);
                  setTimeout(() => setSaved(false), 2000);
                })
              }
              className="min-h-11 rounded-control bg-accent px-5 text-sm font-medium text-white hover:bg-accent-deep"
            >
              {saved ? STRINGS.settings.saved : STRINGS.settings.save}
            </button>
          </Card>
        </Section>

        <Section title={STRINGS.settings.autonomy} hint={STRINGS.settings.autonomyHint}>
          <Card>
            {data.autonomy.map((a) => (
              <div
                key={a.productId}
                className="flex min-h-14 items-center justify-between border-b border-hairline/70 px-5 text-sm last:border-b-0 dark:border-white/10"
              >
                <span>{a.title}</span>
                <span className={a.autonomous ? "text-positive" : "text-ink-muted"}>
                  {a.autonomous ? STRINGS.settings.autonomyOn : STRINGS.settings.autonomyWaiting}
                </span>
              </div>
            ))}
          </Card>
          <h3 className="mt-6 text-sm font-semibold">{STRINGS.settings.signoffQueue}</h3>
          <Card className="mt-2">
            {data.pendingSignoffs.length === 0 ? (
              <p className="p-4 text-sm text-ink-muted">{STRINGS.settings.signoffEmpty}</p>
            ) : (
              data.pendingSignoffs.map((p) => (
                <div
                  key={p.id}
                  className="flex min-h-14 items-center justify-between border-b border-hairline/70 px-5 text-sm last:border-b-0 dark:border-white/10"
                >
                  <span>{p.vertical.replace(/_/g, " ")}</span>
                  <button
                    type="button"
                    data-testid="signoff-approve"
                    onClick={() => void api.signOffPlaybook(p.id).then(reload)}
                    className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-white hover:bg-accent-deep"
                  >
                    {STRINGS.settings.signoffApprove}
                  </button>
                </div>
              ))
            )}
          </Card>
        </Section>
      </div>
    </div>
  );
}
