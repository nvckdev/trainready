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
    <div className="min-h-screen bg-[#0A0505] text-white">
      <NavBar />

      <main className="max-w-[760px] mx-auto px-6 pt-40 pb-32">
        {/* Header */}
        <div className="mb-16">
          <p className="text-[#FF2D55] text-xs font-bold uppercase tracking-widest mb-4">{subtitle}</p>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-6">{title}</h1>
          <p className="text-white/35 text-sm">Last updated: {updated}</p>
          <div className="mt-8 w-12 h-[2px] bg-[#FF2D55] rounded-full" />
        </div>

        {/* Sections */}
        <div className="flex flex-col gap-12">
          {sections.map((section, i) => (
            <div key={i}>
              <h2 className="text-lg font-bold mb-4 text-white/90">{section.heading}</h2>
              {Array.isArray(section.body) ? (
                <ul className="flex flex-col gap-3">
                  {section.body.map((item, j) => (
                    <li key={j} className="flex gap-3 text-white/50 text-sm leading-relaxed">
                      <span className="w-1 h-1 rounded-full bg-[#FF2D55] mt-2 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-white/50 text-sm leading-relaxed">{section.body}</p>
              )}
            </div>
          ))}
        </div>

        {/* Footer nav */}
        <div className="mt-20 pt-8 border-t border-white/5 flex gap-6 text-xs text-white/25">
          <Link href="/privacy" className="hover:text-white/60 transition-colors">Privacy</Link>
          <Link href="/terms" className="hover:text-white/60 transition-colors">Terms</Link>
          <Link href="/cookies" className="hover:text-white/60 transition-colors">Cookies</Link>
        </div>
      </main>
    </div>
  );
}
