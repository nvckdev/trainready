import type { Metadata } from "next";
import Link from "next/link";
import { getAthlete } from "@/lib/athlete-data";

export const metadata: Metadata = {
  title: "Taper — App",
};

const tabs = [
  { href: "/app", label: "Today" },
  { href: "/app/plan", label: "Plan" },
  { href: "/app/fitness", label: "Fitness" },
  { href: "/app/import", label: "Import" },
  { href: "/app/start", label: "New goal" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const athlete = getAthlete();
  return (
    <div className="min-h-svh flex flex-col">
      <header className="bg-field">
        <div className="flex items-center justify-between px-5 md:px-8 h-14">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-3">
              <span className="rec-dot" aria-hidden="true" />
              <span className="display-engraved text-[15px] tracking-tight">Taper</span>
              <span className="label-mono text-bone-faint hidden sm:inline">Beta</span>
            </Link>
            <nav className="flex items-center gap-6" aria-label="App">
              {tabs.map((t) => (
                <Link
                  key={t.href}
                  href={t.href}
                  className="label-mono text-bone-muted hover:text-bone transition-colors duration-150"
                >
                  {t.label}
                </Link>
              ))}
            </nav>
          </div>
          <span className="label-mono text-bone-faint hidden md:inline">
            {athlete ? athlete.name : "No data connected"}
          </span>
        </div>
        <div className="rule" />
      </header>
      <main className="grow px-5 md:px-8 py-8 md:py-10 w-full max-w-[1100px] mx-auto">
        {children}
      </main>
      <footer className="px-5 md:px-8 py-4">
        <div className="rule mb-3" />
        <span className="label-mono text-bone-faint">
          Prescriptions are generated locally from your corpus · not medical advice
        </span>
      </footer>
    </div>
  );
}
