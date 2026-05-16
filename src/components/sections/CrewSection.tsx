"use client";

import { AnimateIn } from "@/components/AnimateIn";

function ScreenContent({ label, isMain = false }: { label: string; isMain?: boolean }) {
  if (isMain) {
    return (
      <div className="w-full h-full flex flex-col p-5 gap-3 pt-8">
        <div className="text-white/20 text-[9px] uppercase tracking-widest">Dashboard</div>
        <div className="flex gap-2 mt-1">
          {[
            { d: "S", val: "1.5", unit: "km", red: true },
            { d: "B", val: "40", unit: "km", red: false },
            { d: "R", val: "10", unit: "km", red: true },
          ].map((item) => (
            <div key={item.d} className="flex-1 bg-white/5 rounded-xl p-2 text-center">
              <div className={`font-bold text-sm ${item.red ? "text-[#FF2D55]" : "text-white"}`}>
                {item.val}<span className="text-[8px] font-normal text-white/30 ml-0.5">{item.unit}</span>
              </div>
              <div className="text-[8px] text-white/20 mt-0.5">
                {item.d === "S" ? "Swim" : item.d === "B" ? "Bike" : "Run"}
              </div>
            </div>
          ))}
        </div>
        <div className="bg-white/5 rounded-xl p-3">
          <div className="text-[9px] text-white/30 mb-2">Weekly Volume</div>
          <div className="flex items-end gap-1 h-10">
            {[40, 65, 30, 80, 55, 70, 45].map((h, i) => (
              <div key={i} className="flex-1 rounded-sm"
                style={{ height: `${h}%`, background: i === 5 ? "#FF2D55" : "rgba(255,255,255,0.15)" }} />
            ))}
          </div>
        </div>
        <div className="bg-white/5 rounded-xl p-3 flex items-center gap-3">
          <div className="w-6 h-6 rounded-full bg-[#FF2D55]/20 flex items-center justify-center shrink-0">
            <div className="w-2 h-2 rounded-full bg-[#FF2D55]" />
          </div>
          <div>
            <div className="text-[9px] text-white/60">Next Race</div>
            <div className="text-[10px] text-white font-medium">Ironman 70.3 — 18d</div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="w-full h-full flex items-center justify-center pt-6">
      <span className="text-white/15 text-[10px] text-center px-4">{label}</span>
    </div>
  );
}

const screens = [
  { label: "Leaderboard", isEdge: true },
  { label: "Race Calendar", isEdge: false },
  { label: "Dashboard", isMain: true, isEdge: false },
  { label: "Club Feed", isEdge: false },
  { label: "Goals", isEdge: true },
];

export function CrewSection() {
  return (
    <section className="py-24 md:py-32 px-6 relative overflow-hidden" id="community">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.03)_0%,transparent_65%)]" />

      <div className="max-w-[1200px] mx-auto text-center relative z-10">
        <AnimateIn>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight mb-4">
            Your Races. Your Targets.
            <br />
            Your Tri Club.
          </h2>
          <p className="text-white/40 text-sm mb-14 md:mb-20 max-w-[400px] mx-auto">
            One app. Three disciplines. An entire community behind you.
          </p>
        </AnimateIn>

        {/* Phone carousel */}
        <AnimateIn delay={100} direction="up">
          <div className="flex justify-center items-end gap-3 md:gap-4 overflow-hidden w-full">
            {screens.map((screen, i) => {
              const isMain = screen.isMain;
              const isEdge = screen.isEdge;
              const isMid = !isMain && !isEdge;

              return (
                <div
                  key={i}
                  className={`relative flex-shrink-0 rounded-[2rem] md:rounded-[2.5rem] border border-[#1E1010] bg-[#0d0404] transition-all duration-300
                    ${isMain ? "w-[220px] h-[460px] md:w-[260px] md:h-[540px] border-[#2a0f0f] shadow-2xl z-20" : ""}
                    ${isMid ? "w-[160px] h-[340px] md:w-[220px] md:h-[460px] opacity-60" : ""}
                    ${isEdge ? "w-[120px] h-[260px] md:w-[180px] md:h-[380px] opacity-25 hidden sm:block" : ""}
                  `}
                  style={isMain ? { boxShadow: "0 40px 80px rgba(0,0,0,0.8), 0 0 40px rgba(255,45,85,0.08)" } : undefined}
                >
                  <div className="absolute top-3 left-1/2 -translate-x-1/2 w-12 h-3 bg-black rounded-full z-10" />
                  <ScreenContent label={screen.label} isMain={screen.isMain} />
                </div>
              );
            })}
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
