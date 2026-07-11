import Link from "next/link";

const COLS = [
  {
    head: "Instrument",
    links: [
      { label: "The route", href: "/#route" },
      { label: "Readiness", href: "/#instrument" },
      { label: "Disciplines", href: "/#disciplines" },
      { label: "Sync", href: "/#sync" },
    ],
  },
  {
    head: "Record",
    links: [
      { label: "Start recording", href: "/#start" },
      { label: "Read the spec", href: "/#instrument" },
    ],
  },
  {
    head: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
      { label: "Cookies", href: "/cookies" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="px-5 md:px-8 pb-6 pt-[clamp(4rem,10vh,8rem)]">
      <div className="rule" />

      <div className="grid grid-cols-2 md:grid-cols-12 gap-y-10 py-12 md:py-16">
        <div className="col-span-2 md:col-span-6">
          <div className="flex items-center gap-3">
            <span className="rec-dot" aria-hidden="true" />
            <span className="display-engraved text-xl">TrainReady</span>
          </div>
          <p className="label-mono text-ink-faint mt-4 max-w-[38ch] leading-relaxed">
            Field manual, instrument no. 001. Recorded at 46.5197° N, 6.6323° E,
            elevation 372 m.
          </p>
        </div>

        {COLS.map((col) => (
          <nav key={col.head} className="md:col-span-2" aria-label={col.head}>
            <h3 className="label-mono text-ink-faint">{col.head}</h3>
            <ul className="mt-4 space-y-2.5">
              {col.links.map((l) => (
                <li key={l.label}>
                  <Link
                    href={l.href}
                    className="label-mono text-ink-muted hover:text-ink transition-colors duration-150"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="rule" />
      <div className="flex flex-wrap items-center justify-between gap-3 py-4">
        <span className="label-mono text-ink-faint">
          © 2026 TrainReady Instruments
        </span>
        <span className="label-mono text-ink-faint">
          Calibrated · Engraved · Ready
        </span>
      </div>
      <div className="tick-strip" aria-hidden="true" />
    </footer>
  );
}
