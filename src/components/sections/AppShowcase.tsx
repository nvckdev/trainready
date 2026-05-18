"use client";

import { AnimateIn } from "@/components/AnimateIn";

function WebDashboard() {
  return (
    <div
      className="relative w-full rounded-xl overflow-hidden bg-[#0d0404]"
      style={{ boxShadow: "0 40px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06)" }}
    >
      {/* Browser chrome */}
      <div className="bg-[#1a0a0a] px-4 py-3 flex items-center gap-3 border-b border-white/5">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-white/10" />
          <div className="w-3 h-3 rounded-full bg-white/10" />
          <div className="w-3 h-3 rounded-full bg-white/10" />
        </div>
        <div className="flex-1 bg-white/5 rounded-md px-3 py-1 text-[11px] text-white/25 text-center">
          app.trainready.io
        </div>
      </div>

      {/* Dashboard body */}
      <div className="flex">
        {/* Sidebar */}
        <div className="hidden sm:flex w-14 md:w-16 border-r border-white/5 flex-col items-center py-5 gap-5">
          {["monitoring", "directions_run", "pool", "directions_bike", "calendar_month"].map((icon) => (
            <span key={icon} className="material-symbols-outlined text-[18px] text-white/20 hover:text-white/50 cursor-pointer transition-colors">{icon}</span>
          ))}
        </div>

        {/* Main content */}
        <div className="flex-1 p-4 md:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] text-white/30 uppercase tracking-widest mb-0.5">Today's Session</div>
              <div className="text-white font-semibold text-sm">Thursday, Week 14</div>
            </div>
            <div className="text-[10px] text-[#FF2D55] border border-[#FF2D55]/30 rounded-full px-3 py-1 bg-[#FF2D55]/5">
              Ironman 70.3 — 18d
            </div>
          </div>

          {/* Metrics row */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Swim", val: "1.5", unit: "km", pct: 85, color: "#FF2D55" },
              { label: "Bike", val: "42", unit: "km", pct: 62, color: "#fff" },
              { label: "Run", val: "10", unit: "km", pct: 40, color: "#FF2D55" },
            ].map((d) => (
              <div key={d.label} className="bg-white/5 rounded-xl p-3">
                <div className="text-white/30 text-[10px] mb-1">{d.label}</div>
                <div className="font-bold text-base" style={{ color: d.color }}>
                  {d.val}<span className="text-xs font-normal text-white/30 ml-0.5">{d.unit}</span>
                </div>
                <div className="mt-2 h-1 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${d.pct}%`, background: d.color, opacity: 0.6 }} />
                </div>
              </div>
            ))}
          </div>

          {/* Heart rate chart */}
          <div className="bg-white/5 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] text-white/30 uppercase tracking-widest">Heart Rate</div>
              <div className="text-[10px] text-white/20">avg 148 bpm</div>
            </div>
            <svg viewBox="0 0 300 50" className="w-full opacity-60">
              <polyline
                points="0,35 25,30 50,38 75,18 100,26 125,14 150,28 175,20 200,32 225,16 250,22 275,34 300,26"
                fill="none" stroke="#FF2D55" strokeWidth="1.5" strokeLinejoin="round"
              />
              <polyline
                points="0,35 25,30 50,38 75,18 100,26 125,14 150,28 175,20 200,32 225,16 250,22 275,34 300,26"
                fill="url(#hrGrad)" strokeWidth="0" opacity="0.15"
              />
              <defs>
                <linearGradient id="hrGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#FF2D55" />
                  <stop offset="100%" stopColor="transparent" />
                </linearGradient>
              </defs>
            </svg>
          </div>

          {/* Weekly volume */}
          <div className="bg-white/5 rounded-xl p-4">
            <div className="text-[10px] text-white/30 uppercase tracking-widest mb-3">Weekly Volume</div>
            <div className="flex items-end gap-1.5 h-12">
              {[40, 65, 30, 80, 55, 95, 45].map((h, i) => (
                <div key={i} className="flex-1 rounded-sm transition-all"
                  style={{ height: `${h}%`, background: i === 5 ? "#FF2D55" : "rgba(255,255,255,0.12)" }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Phone mockup preserved for future mobile app — uncomment to restore
function PhoneMockup({ className = "" }: { className?: string }) { ... } */

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
          <div className="relative mb-12 md:mb-16">
            <div className="absolute inset-0 bg-[#FF2D55]/10 blur-[80px] rounded-full scale-150" />
            <div className="relative z-10">
              <WebDashboard />
            </div>
          </div>
        </AnimateIn>
      </div>

      <AnimateIn delay={80} className="relative z-10 w-full max-w-[600px] mx-auto text-center">
        <p className="text-white/55 text-base md:text-lg leading-relaxed px-4">
          Your plan isn't static. TRAINREADY reads your performance data in real time and adjusts intensity, volume, and recovery so you're always training at your optimal level.
        </p>
      </AnimateIn>
    </section>
  );
}
