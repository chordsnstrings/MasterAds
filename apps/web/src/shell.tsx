// App shell (UX §4): four destinations, persistent + Add product, attention
// indicator. Bottom tab bar under 640px (UX §12). Frosted-glass chrome with
// gentle motion; route changes cross-fade (collapses under reduced-motion).
import { NavLink, Link, useLocation } from "react-router-dom";
import { useState, type ReactNode } from "react";
import { STRINGS } from "./strings";

/** Light is the default look; dark is an explicit, persisted choice. */
function ThemeToggle(): JSX.Element {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const toggle = (): void => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
    setDark(next);
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? STRINGS.common.themeToLight : STRINGS.common.themeToDark}
      title={dark ? STRINGS.common.themeToLight : STRINGS.common.themeToDark}
      className="grid h-11 w-11 place-items-center rounded-full text-ink-muted hover:bg-ink/[0.04] hover:text-ink dark:hover:bg-white/5 dark:hover:text-white"
    >
      <span aria-hidden="true">{dark ? "☀" : "☾"}</span>
    </button>
  );
}

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
  const { pathname } = useLocation();
  const navClass = ({ isActive }: { isActive: boolean }): string =>
    `min-h-11 inline-flex items-center rounded-full px-3.5 text-sm transition-colors duration-150 ${
      isActive
        ? "bg-ink/[0.06] font-medium text-ink dark:bg-white/10 dark:text-white"
        : "text-ink-muted hover:bg-ink/[0.04] hover:text-ink dark:hover:bg-white/5 dark:hover:text-white"
    }`;
  return (
    <div className="min-h-screen bg-canvas text-ink dark:bg-canvas-dark dark:text-white">
      {/* Top bar (hidden on phones) */}
      <header className="sticky top-0 z-10 hidden border-b border-hairline/70 bg-canvas/80 backdrop-blur-xl sm:block dark:border-white/10 dark:bg-canvas-dark/80">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-3">
          <div className="flex items-center gap-7">
            <Link to="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
              <span
                aria-hidden="true"
                className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-accent to-[#7C3AED] text-sm text-white shadow-pop"
              >
                ◐
              </span>
              {STRINGS.appName}
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
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link
              to="/add"
              className="min-h-11 inline-flex items-center rounded-full bg-accent px-5 text-sm font-medium text-white transition-all duration-200 hover:-translate-y-px hover:bg-accent-deep hover:shadow-pop"
            >
              {STRINGS.nav.addProduct}
            </Link>
          </div>
        </div>
      </header>

      <main
        key={pathname}
        className="mx-auto max-w-[1200px] px-4 pb-28 pt-6 motion-safe:animate-fade-in sm:px-6 sm:pb-12 sm:pt-8"
      >
        {children}
      </main>

      {/* Bottom tab bar (phones) + floating add action */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-10 flex border-t border-hairline/70 bg-canvas/85 backdrop-blur-xl sm:hidden dark:border-white/10 dark:bg-canvas-dark/85"
      >
        {DESTINATIONS.map((d) => (
          <NavLink
            key={d.to}
            to={d.to}
            end={d.end}
            className={({ isActive }) =>
              `flex min-h-12 flex-1 items-center justify-center text-xs transition-colors duration-150 ${
                isActive ? "font-semibold text-accent" : "text-ink-muted"
              }`
            }
          >
            {d.label}
            {d.to === "/" && attentionCount > 0 && (
              <span className="ml-1 h-2 w-2 rounded-full bg-critical motion-safe:animate-pulse-soft" aria-hidden="true" />
            )}
          </NavLink>
        ))}
      </nav>
      <Link
        to="/add"
        aria-label={STRINGS.nav.addProduct}
        className="fixed bottom-16 right-4 z-10 flex h-13 min-h-12 w-12 items-center justify-center rounded-full bg-accent text-xl text-white shadow-pop transition-transform duration-150 active:scale-95 sm:hidden"
      >
        +
      </Link>
    </div>
  );
}
