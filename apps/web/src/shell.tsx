// App shell (UX §4): four destinations, persistent + Add product, attention
// indicator. Bottom tab bar under 640px (UX §12).
import { NavLink, Link } from "react-router-dom";
import type { ReactNode } from "react";
import { STRINGS } from "./strings";

const DESTINATIONS = [
  { to: "/", label: STRINGS.nav.overview, end: true },
  { to: "/products", label: STRINGS.nav.products, end: false },
  { to: "/activity", label: STRINGS.nav.activity, end: false },
  { to: "/settings", label: STRINGS.nav.settings, end: false },
];

export function AppShell({
  attentionCount,
  children,
}: {
  attentionCount: number;
  children: ReactNode;
}): JSX.Element {
  const navClass = ({ isActive }: { isActive: boolean }): string =>
    `min-h-11 inline-flex items-center rounded-control px-3 text-sm ${
      isActive ? "font-semibold text-ink dark:text-white" : "text-ink-muted"
    }`;
  return (
    <div className="min-h-screen bg-canvas text-ink dark:bg-canvas-dark dark:text-white">
      {/* Top bar (hidden on phones) */}
      <header className="sticky top-0 z-10 hidden border-b border-hairline bg-surface/90 backdrop-blur sm:block dark:border-ink-muted/20 dark:bg-surface-dark/90">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2 font-semibold">
              <span aria-hidden="true" className="text-accent">◐</span> {STRINGS.appName}
            </Link>
            <nav aria-label="Primary" className="flex gap-1">
              {DESTINATIONS.map((d) => (
                <NavLink key={d.to} to={d.to} end={d.end} className={navClass}>
                  {d.label}
                  {d.to === "/" && attentionCount > 0 && (
                    <span
                      data-testid="attention-indicator"
                      className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-critical px-1 font-mono text-xs text-white"
                      aria-label={STRINGS.counts.attention(attentionCount)}
                    >
                      {attentionCount}
                    </span>
                  )}
                </NavLink>
              ))}
            </nav>
          </div>
          <Link
            to="/add"
            className="min-h-11 inline-flex items-center rounded-control bg-accent px-4 text-sm font-medium text-white"
          >
            {STRINGS.nav.addProduct}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-4 pb-28 pt-6 sm:px-6 sm:pb-12">{children}</main>

      {/* Bottom tab bar (phones) + floating add action */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-10 flex border-t border-hairline bg-surface sm:hidden dark:border-ink-muted/20 dark:bg-surface-dark"
      >
        {DESTINATIONS.map((d) => (
          <NavLink
            key={d.to}
            to={d.to}
            end={d.end}
            className={({ isActive }) =>
              `flex min-h-12 flex-1 items-center justify-center text-xs ${
                isActive ? "font-semibold text-accent" : "text-ink-muted"
              }`
            }
          >
            {d.label}
            {d.to === "/" && attentionCount > 0 && (
              <span className="ml-1 h-2 w-2 rounded-full bg-critical" aria-hidden="true" />
            )}
          </NavLink>
        ))}
      </nav>
      <Link
        to="/add"
        aria-label={STRINGS.nav.addProduct}
        className="fixed bottom-16 right-4 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-xl text-white shadow-lg sm:hidden"
      >
        +
      </Link>
    </div>
  );
}
