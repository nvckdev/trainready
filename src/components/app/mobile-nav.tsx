"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Mobile bottom tab bar (PWA shell). Fixed to the bottom on small screens —
 * thumb-reach navigation for the installed app — and hidden at md+ where the
 * top header nav takes over. Pads itself with the home-indicator safe area so
 * tabs never sit under the iOS gesture bar.
 */

const TABS = [
  { href: "/app", label: "Today" },
  { href: "/app/plan", label: "Plan" },
  { href: "/app/fitness", label: "Fitness" },
  { href: "/app/import", label: "Import" },
  { href: "/app/start", label: "Goal" },
];

const isActive = (href: string, pathname: string) =>
  href === "/app" ? pathname === "/app" : pathname.startsWith(href);

/** Desktop header tabs — same active-state/aria-current treatment as the
 *  bottom bar, so the current page is always announced and visible. */
export function DesktopNav({ tabs }: { tabs: Array<{ href: string; label: string }> }) {
  const pathname = usePathname();
  return (
    <nav className="hidden md:flex items-center gap-6" aria-label="App">
      {tabs.map((t) => {
        const active = isActive(t.href, pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`label-mono transition-colors duration-150 ${
              active ? "text-bone" : "text-bone-muted hover:text-bone"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="App (mobile)"
      className="md:hidden fixed inset-x-0 bottom-0 z-40 bg-field/95 backdrop-blur border-t border-hairline"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid grid-cols-5">
        {TABS.map((t) => {
          const active = isActive(t.href, pathname);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center justify-center gap-1 h-14 label-mono transition-colors duration-150 ${
                active ? "text-signal-bright" : "text-bone-muted"
              }`}
            >
              <span
                className={`block w-1 h-1 rounded-full ${active ? "bg-signal" : "bg-transparent"}`}
                aria-hidden="true"
              />
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
