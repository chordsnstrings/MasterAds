// Settings (UX §6.6): connections, results tracking readiness, spending
// limits incl. the stop-everything switch, brand kit, autonomy + sign-offs.
import { useEffect, useState } from "react";
import { STRINGS } from "../strings";
import { api, type SettingsData } from "../api";
import { Card, Num, Section } from "../components";

export default function Settings(): JSX.Element {
  const [data, setData] = useState<SettingsData | null>(null);
  const [saved, setSaved] = useState(false);
  const [kit, setKit] = useState<Record<string, string>>({});
  const [siteList, setSiteList] = useState<{ sourceSite: string; label: string | null }[]>([]);
  const [newSite, setNewSite] = useState("");
  const [issuedKey, setIssuedKey] = useState<{ site: string; key: string } | null>(null);

  async function reload(): Promise<void> {
    const d = await api.settings();
    setData(d);
    setKit(d.brandKit);
    const s = await api.sites();
    setSiteList(s.sites);
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
      <h1 className="text-2xl font-semibold">{STRINGS.settings.title}</h1>
      <div className="mt-6 max-w-2xl">
        <Section title={STRINGS.settings.connections}>
          <Card>
            {data.connections.map((c) => (
              <div
                key={c.platform}
                className="flex min-h-14 items-center justify-between border-b border-hairline px-4 last:border-b-0 dark:border-ink-muted/20"
              >
                <span>{STRINGS.platformNames[c.platform] ?? c.platform}</span>
                <span className="flex items-center gap-3 text-sm">
                  <span className={c.connected && c.tokenValid ? "text-positive" : "text-critical"}>
                    {c.connected
                      ? c.tokenValid
                        ? STRINGS.settings.connectionOk
                        : STRINGS.settings.connectionProblem
                      : STRINGS.settings.notConnected}
                  </span>
                  <button type="button" className="min-h-11 rounded-control px-3 text-accent">
                    {c.connected ? STRINGS.settings.reconnect : STRINGS.settings.connect}
                  </button>
                </span>
              </div>
            ))}
          </Card>
        </Section>

        <Section title={STRINGS.sitesSection.title} hint={STRINGS.sitesSection.hint}>
          <Card className="p-4">
            {siteList.length === 0 && (
              <p className="text-sm text-ink-muted">{STRINGS.sitesSection.empty}</p>
            )}
            {siteList.map((site) => (
              <div key={site.sourceSite} className="flex min-h-11 items-center justify-between text-sm">
                <span className="font-mono">{site.sourceSite}</span>
                <span className="text-ink-muted">{site.label ?? ""}</span>
              </div>
            ))}
            <div className="mt-3 flex gap-2">
              <input
                value={newSite}
                onChange={(e) => setNewSite(e.target.value)}
                aria-label={STRINGS.sitesSection.addLabel}
                placeholder={STRINGS.sitesSection.addLabel}
                data-testid="add-site-input"
                className="min-h-11 flex-1 rounded-control border border-hairline bg-surface px-3 font-mono text-sm dark:bg-surface-dark dark:border-ink-muted/30"
              />
              <button
                type="button"
                data-testid="add-site-button"
                onClick={() =>
                  void api.addSite(newSite.trim()).then((r) => {
                    setIssuedKey(r);
                    setNewSite("");
                    void reload();
                  })
                }
                disabled={!newSite.trim()}
                className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-white disabled:opacity-50"
              >
                {STRINGS.sitesSection.addButton}
              </button>
            </div>
            {issuedKey && (
              <div className="mt-3 rounded-control bg-accent-soft p-3 text-xs" data-testid="issued-key">
                <p className="font-medium">{STRINGS.sitesSection.keyNotice}</p>
                <code className="mt-1 block break-all font-mono">{issuedKey.key}</code>
              </div>
            )}
          </Card>
        </Section>

        <Section title={STRINGS.settings.tracking} hint={STRINGS.settings.trackingHint}>
          <Card className="p-4">
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
              return (
                <div key={site} className="mb-3 last:mb-0">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{site}</span>
                    <span className={avg >= 75 ? "text-positive" : "text-attention-deep"}>{readiness}</span>
                  </div>
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
          <Card className="space-y-4 p-4">
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
                  className="min-h-11 w-32 rounded-control border border-hairline bg-surface px-3 font-mono dark:bg-surface-dark dark:border-ink-muted/30"
                  aria-label={label}
                />
              </label>
            ))}
            <div className="border-t border-hairline pt-4 dark:border-ink-muted/20">
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

        <Section title={STRINGS.settings.brandKit}>
          <Card className="space-y-3 p-4">
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
                  className="mt-1 block w-full min-h-11 rounded-control border border-hairline bg-surface px-3 dark:bg-surface-dark dark:border-ink-muted/30"
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
              className="min-h-11 rounded-control bg-accent px-5 text-sm font-medium text-white"
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
                className="flex min-h-12 items-center justify-between border-b border-hairline px-4 text-sm last:border-b-0 dark:border-ink-muted/20"
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
                  className="flex min-h-12 items-center justify-between border-b border-hairline px-4 text-sm last:border-b-0 dark:border-ink-muted/20"
                >
                  <span>{p.vertical.replace(/_/g, " ")}</span>
                  <button
                    type="button"
                    data-testid="signoff-approve"
                    onClick={() => void api.signOffPlaybook(p.id).then(reload)}
                    className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-white"
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
