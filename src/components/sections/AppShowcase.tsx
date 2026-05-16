"use client";

import { AnimateIn } from "@/components/AnimateIn";

function PhoneMockup({ className = "" }: { className?: string }) {
  return (
    <div
      className={`relative bg-black rounded-[2.8rem] phone-border overflow-hidden ${className}`}
      style={{ boxShadow: "0 40px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.05)" }}
    >
      <div className="absolute top-4 left-1/2 -translate-x-1/2 w-20 h-5 bg-black rounded-full z-10" />
      <div className="w-full h-full bg-gradient-to-b from-[#1a0808] to-[#0d0404] flex flex-col items-center justify-center gap-4 p-6 pt-10">
        <div className="w-full space-y-3">
          <div className="text-white/20 text-[10px] uppercase tracking-widest text-center">Today&apos;s Session</div>
          <div className="flex justify-between items-end">
            {[
              { val: "1.5km", label: "SWIM", red: true },
              { val: "42km", label: "BIKE", red: false },
              { val: "10km", label: "RUN", red: true },
            ].map((d) => (
              <div key={d.label} className="text-center flex-1">
                <div className={`text-xl font-bold ${d.red ? "text-[#FF2D55]" : "text-white"}`}>{d.val}</div>
                <div className="text-white/30 text-[9px] mt-1">{d.label}</div>
              </div>
            ))}
          </div>
          <div className="space-y-2 pt-2">
            {[
              { label: "S", pct: 85, color: "#FF2D55" },
              { label: "B", pct: 62, color: "#fff" },
              { label: "R", pct: 40, color: "#FF2D55" },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-2">
                <div className="text-white/30 text-[9px] w-4">{item.label}</div>
                <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${item.pct}%`, background: item.color, opacity: 0.7 }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-white/5">
            <div className="text-white/20 text-[9px] mb-2">HEART RATE</div>
            <svg viewBox="0 0 120 30" className="w-full opacity-50">
              <polyline
                points="0,20 10,18 20,22 30,10 40,14 50,8 60,16 70,12 80,18 90,10 100,14 110,20 120,16"
                fill="none" stroke="#FF2D55" strokeWidth="1.5" strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppShowcase() {
  return (
    <section className="py-24 md:py-32 px-6 relative overflow-hidden flex flex-col items-center justify-center">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.03)_0%,transparent_70%)]" />

      <div className="relative z-10 w-full max-w-[800px] mx-auto text-center">
        <AnimateIn>
          <h2 className="text-4xl sm:text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.08] pb-4">
            From the calm water
            <br />
            to the final sprint
          </h2>
          <p className="text-white/40 text-sm mt-4 mb-12 md:mb-16 tracking-wide">
            One unified platform. Three disciplines. Zero compromise.
          </p>
        </AnimateIn>

        <AnimateIn delay={120} direction="up">
          <div className="relative inline-block mb-12 md:mb-16">
            <div className="absolute inset-0 bg-[#FF2D55]/15 blur-[80px] rounded-full scale-150" />
            <PhoneMockup className="w-[240px] h-[500px] sm:w-[260px] sm:h-[540px] relative z-10" />
          </div>
        </AnimateIn>
      </div>

      <AnimateIn delay={80} className="relative z-10 w-full max-w-[600px] mx-auto text-center">
        <p className="text-white/55 text-base md:text-lg leading-relaxed px-4">
          Every session builds your legacy. Analyze your metrics across all
          three disciplines in one unified platform.
        </p>
      </AnimateIn>
    </section>
  );
}
