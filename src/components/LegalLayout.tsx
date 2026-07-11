import { NavBar } from "@/components/NavBar";
import Link from "next/link";

interface Section {
  heading: string;
  body: string | string[];
}

interface LegalLayoutProps {
  title: string;
  subtitle: string;
  updated: string;
  sections: Section[];
}

export function LegalLayout({ title, subtitle, updated, sections }: LegalLayoutProps) {
  return (
    <div className="min-h-screen">
      <NavBar />

      <main className="max-w-[760px] mx-auto px-5 md:px-6 pt-32 pb-24">
        <header className="mb-14">
          <p className="label-mono text-signal-bright">{subtitle}</p>
          <h1 className="display-engraved text-[clamp(2.2rem,6vw,3.6rem)] mt-3">{title}</h1>
          <p className="label-mono text-bone-faint mt-4">Last updated: {updated}</p>
          <div className="tick-strip mt-8" aria-hidden="true" />
        </header>

        <div className="flex flex-col">
          {sections.map((section, i) => (
            <section key={i} className="border-t border-hairline py-8 grid md:grid-cols-[3rem_1fr] gap-x-6 gap-y-3">
              <span className="label-mono text-bone-faint pt-1">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <h2 className="font-semibold text-lg mb-3">{section.heading}</h2>
                {Array.isArray(section.body) ? (
                  <ul className="flex flex-col gap-2.5">
                    {section.body.map((item, j) => (
                      <li key={j} className="grid grid-cols-[1.5rem_1fr] text-bone-muted text-[15px] leading-relaxed">
                        <span className="label-mono text-bone-faint pt-0.5">{String.fromCharCode(97 + j)}.</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-bone-muted text-[15px] leading-relaxed">{section.body}</p>
                )}
              </div>
            </section>
          ))}
        </div>

        <nav className="mt-16 pt-5 border-t border-hairline flex gap-7" aria-label="Legal pages">
          <Link href="/privacy" className="label-mono text-bone-muted hover:text-bone transition-colors duration-150">Privacy</Link>
          <Link href="/terms" className="label-mono text-bone-muted hover:text-bone transition-colors duration-150">Terms</Link>
          <Link href="/cookies" className="label-mono text-bone-muted hover:text-bone transition-colors duration-150">Cookies</Link>
        </nav>
      </main>
    </div>
  );
}
