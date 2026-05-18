"use client";

import { AnimateIn } from "@/components/AnimateIn";

function WebDashboardWide() {
  return (
    <div
      className="relative w-full rounded-xl overflow-hidden bg-[#0d0404]"
      style={{ boxShadow: "0 40px 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.06), 0 0 60px rgba(255,45,85,0.05)" }}
    >
      {/* Browser chrome */}
      <div className="bg-[#1a0a0a] px-4 py-3 flex items-center gap-3 border-b border-white/5">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-white/10" />
          <div className="w-3 h-3 rounded-full bg-white/10" />
          <div className="w-3 h-3 rounded-full bg-white/10" />
        </div>
        <div className="flex gap-3 ml-2 text-[10px] text-white/20">
          <span className="border-b border-white/20 pb-1 text-white/40">Dashboard</span>
          <span>Training Plan</span>
          <span>Race Calendar</span>
          <span className="hidden md:block">Analytics</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-[#FF2D55]/20 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-[#FF2D55]" />
          </div>
          <span className="text-[10px] text-white/25 hidden sm:block">Nick A.</span>
        </div>
      </div>

      {/* Dashboard layout */}
      <div className="flex min-h-[320px] md:min-h-[380px]">
        {/* Sidebar */}
        <div className="hidden md:flex w-48 border-r border-white/5 flex-col py-5 px-3 gap-1 shrink-0">
          {[
            { icon: "monitoring", label: "Dashboard", active: true },
            { icon: "directions_run", label: "Training Plan", active: false },
            { icon: "calendar_month", label: "Race Calendar", active: false },
            { icon: "bar_chart", label: "Analytics", active: false },
            { icon: "group", label: "Community", active: false },
          ].map((item) => (
            <div key={item.label} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs cursor-pointer transition-colors
              ${item.active ? "bg-white/8 text-white" : "text-white/25 hover:text-white/40"}`}>
              <span className="material-symbols-outlined text-[16px]">{item.icon}</span>
              {item.label}
            </div>
          ))}
        </div>

        {/* Main area */}
        <div className="flex-1 p-4 md:p-5 grid grid-cols-2 md:grid-cols-3 gap-3">
          {/* Next race card */}
          <div className="col-span-2 md:col-span-1 bg-[#FF2D55]/10 border border-[#FF2D55]/20 rounded-xl p-4">
            <div className="text-[10px] text-[#FF2D55]/70 uppercase tracking-widest mb-2">Next Race</div>
            <div className="text-white font-bold text-sm mb-0.5">Ironman 70.3</div>
            <div className="text-white/40 text-xs">18 days away</div>
            <div className="mt-3 h-1 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-[#FF2D55] rounded-full" style={{ width: "74%" }} />
            </div>
            <div className="text-[9px] text-white/20 mt-1">74% race-ready</div>
          </div>

          {/* Weekly volume */}
          <div className="bg-white/5 rounded-xl p-4">
            <div className="text-[10px] text-white/30 uppercase tracking-widest mb-3">Weekly Volume</div>
            <div className="flex items-end gap-1 h-14">
              {[40, 65, 30, 80, 55, 95, 45].map((h, i) => (
                <div key={i} className="flex-1 rounded-sm"
                  style={{ height: `${h}%`, background: i === 5 ? "#FF2D55" : "rgba(255,255,255,0.12)" }} />
              ))}
            </div>
            <div className="text-[9px] text-white/20 mt-2">Mon – Sun</div>
          </div>

          {/* Tri metrics */}
          <div className="bg-white/5 rounded-xl p-4">
            <div className="text-[10px] text-white/30 uppercase tracking-widest mb-3">Today</div>
            <div className="space-y-2.5">
              {[
                { label: "Swim", val: "1.5km", pct: 85, color: "#FF2D55" },
                { label: "Bike", val: "42km", pct: 62, color: "#fff" },
                { label: "Run", val: "10km", pct: 40, color: "#FF2D55" },
              ].map((d) => (
                <div key={d.label} className="flex items-center gap-2">
                  <div className="text-[9px] text-white/30 w-7 shrink-0">{d.label}</div>
                  <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${d.pct}%`, background: d.color, opacity: 0.7 }} />
                  </div>
                  <div className="text-[9px] font-medium w-8 text-right" style={{ color: d.color }}>{d.val}</div>
                </div>
              ))}
            </div>
          </div>

          {/* AI Insight card — spans full bottom on md */}
          <div className="col-span-2 md:col-span-3 bg-white/4 border border-white/5 rounded-xl p-4 flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-[#FF2D55]/15 flex items-center justify-center shrink-0 mt-0.5">
              <span className="material-symbols-outlined text-[13px] text-[#FF2D55]">psychology</span>
            </div>
            <div>
              <div className="text-[10px] text-[#FF2D55]/70 uppercase tracking-widest mb-1">AI Coach Insight</div>
              <div className="text-xs text-white/50 leading-relaxed">Your swim pace improved 4% this week. Based on your HRV trend, tomorrow's long bike is adjusted to Zone 2 to ensure full recovery before Saturday's brick session.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Phone carousel preserved for future mobile app — uncomment to restore
const screens = [
  { label: "Leaderboard", isEdge: true },
  { label: "Race Calendar", isEdge: false },
  { label: "Dashboard", isMain: true, isEdge: false },
  { label: "Club Feed", isEdge: false },
  { label: "Goals", isEdge: true },
]; */

export function CrewSection() {
  return (
    <section className="py-24 md:py-32 px-6 relative overflow-hidden" id="community">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.03)_0%,transparent_65%)]" />

      <div className="max-w-[1200px] mx-auto text-center relative z-10">
        <AnimateIn>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight mb-4">
            Your Metrics. Your Plan.
            <br />
            Your Edge.
          </h2>
          <p className="text-white/40 text-sm mb-14 md:mb-20 max-w-[400px] mx-auto">
            Personalized training built around your data — not a generic template.
          </p>
        </AnimateIn>

        <AnimateIn delay={100} direction="up">
          <div className="relative">
            <div className="absolute inset-0 bg-[#FF2D55]/8 blur-[100px] rounded-full scale-150" />
            <div className="relative z-10">
              <WebDashboardWide />
            </div>
          </div>
        </AnimateIn>

        <AnimateIn delay={150}>
          <p className="text-white/50 text-sm md:text-base max-w-[540px] mx-auto mt-14 md:mt-20 leading-relaxed">
            One platform to archive training across all disciplines, set
            measurable goals, and connect with athletes who share your drive.
          </p>
        </AnimateIn>
      </div>
    </section>
  );
}
