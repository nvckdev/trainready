import Link from "next/link";

const COLS = [
  {
    head: "Method",
    links: [
      { label: "Protocol", href: "/#protocol" },
      { label: "The course", href: "/#course" },
      { label: "The engine", href: "/#engine" },
      { label: "Disciplines", href: "/#disciplines" },
      { label: "Sync", href: "/#sync" },
    ],
  },
  {
    head: "Beta",
    links: [
      { label: "Join the beta", href: "/#start" },
      { label: "Read the method", href: "/#engine" },
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
            <span className="display-engraved text-xl">Taper</span>
          </div>
          <p className="label-mono text-bone-faint mt-4 max-w-[38ch] leading-relaxed">
            Adaptive endurance training. Night edition, instrument no. 002.
            Drafted at 46.5197° N, 6.6323° E.
          </p>
        </div>

        {COLS.map((col) => (
          <nav key={col.head} className="md:col-span-2" aria-label={col.head}>
            <h3 className="label-mono text-bone-faint">{col.head}</h3>
            <ul className="mt-4 space-y-2.5">
              {col.links.map((l) => (
                <li key={l.label}>
                  <Link
                    href={l.href}
                    className="label-mono text-bone-muted hover:text-bone transition-colors duration-150"
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
        <span className="label-mono text-bone-faint">© 2026 Taper</span>
        <span className="label-mono text-bone-faint">
          Train · Taper · Race
        </span>
      </div>
      <div className="tick-strip" aria-hidden="true" />
    </footer>
  );
}
