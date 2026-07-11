"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

function UtcClock() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      setTime(
        `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="label-mono text-ink-muted tabular" suppressHydrationWarning>
      {time ?? "--:--:-- UTC"}
    </span>
  );
}

const links = [
  { href: "/#route", label: "The Route" },
  { href: "/#instrument", label: "Instrument" },
  { href: "/#disciplines", label: "Disciplines" },
  { href: "/#sync", label: "Sync" },
];

export function NavBar() {
  return (
    <header className="fixed top-0 inset-x-0 z-50 bg-paper">
      <div className="flex items-center justify-between gap-6 px-5 md:px-8 h-14">
        <Link href="/" className="flex items-center gap-3 shrink-0">
          <span className="rec-dot" aria-hidden="true" />
          <span className="display-engraved text-[15px] tracking-tight">
            TrainReady
          </span>
          <span className="label-mono text-ink-faint hidden lg:inline">
            No. 001
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-7" aria-label="Primary">
          {links.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="label-mono text-ink-muted hover:text-ink transition-colors duration-150"
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-5 shrink-0">
          <span className="hidden sm:inline">
            <UtcClock />
          </span>
          <Link
            href="/#start"
            className="label-mono bg-ink text-paper px-4 py-2 hover:bg-signal transition-colors duration-150"
          >
            Start
          </Link>
        </div>
      </div>
      <div className="rule" />
    </header>
  );
}
