"use client";

import { AnimateIn } from "@/components/AnimateIn";

const features = [
  {
    icon: "monitoring",
    title: "Precision\nTri-Metrics",
    description:
      "Monitor your swim stroke, cycling power, and running pace with unified multi-sport analytics.",
    accent: true,
  },
  {
    icon: "psychology",
    title: "Adaptive\nMulti-Sport Plans",
    description:
      "AI-powered periodization that balances your load across all disciplines to prevent overtraining.",
    accent: false,
  },
  {
    icon: "timer",
    title: "Transition\nOptimization",
    description:
      "Analyze and improve your T1 and T2 times with dedicated transition tracking and coaching.",
    accent: false,
  },
  {
    icon: "group",
    title: "Triathlete\nCommunity",
    description:
      "Connect with fellow multi-sport athletes, join virtual triathlons, and share your journey.",
    accent: false,
  },
];

export function FeaturesGrid() {
  return (
    <section className="py-24 md:py-32 px-6" id="features">
      <div className="max-w-[1200px] mx-auto">
        <AnimateIn>
          <div className="flex items-center gap-3 mb-10 md:mb-12">
            <div className="h-px flex-1 bg-white/5" />
            <span className="text-white/30 text-xs uppercase tracking-widest">Core Features</span>
            <div className="h-px flex-1 bg-white/5" />
          </div>
        </AnimateIn>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          {features.map((feature, i) => (
            <AnimateIn key={i} delay={i * 90} direction="up">
              <div
                className={`group relative rounded-3xl p-6 md:p-8 flex flex-col h-[280px] md:h-[320px] transition-all duration-300 cursor-default
                  ${feature.accent
                    ? "bg-[#140A0A] border border-white/8"
                    : "bg-[#1E1010]/60 border border-white/5 hover:border-white/10 hover:bg-[#1E1010]"
                  }`}
              >
                {feature.accent && (
                  <div
                    className="absolute top-6 right-6 w-2 h-2 rounded-full bg-[#FF2D55]"
                    style={{ boxShadow: "0 0 8px #FF2D55" }}
                  />
                )}
                <span
                  className={`material-symbols-outlined text-3xl mb-6 transition-colors duration-300
                    ${feature.accent ? "text-[#FF2D55]" : "text-white/25 group-hover:text-white/50"}`}
                >
                  {feature.icon}
                </span>
                <h3
                  className={`text-lg md:text-xl font-bold mb-auto whitespace-pre-line leading-tight
                    ${feature.accent ? "text-white" : "text-white/80 group-hover:text-white"}`}
                >
                  {feature.title}
                </h3>
                <p
                  className={`text-[13px] leading-relaxed mt-4 transition-colors duration-300
                    ${feature.accent ? "text-white/50" : "text-white/30 group-hover:text-white/50"}`}
                >
                  {feature.description}
                </p>
              </div>
            </AnimateIn>
          ))}
        </div>

        <AnimateIn delay={200}>
          <p className="text-center text-white/40 text-sm md:text-base mt-16 md:mt-20 max-w-[600px] mx-auto leading-relaxed">
            From early morning pool sessions to ultra-distance ironmans,{" "}
            <span className="text-white/70">TRAINREADY</span> equips you with the
            tools, insights, and motivation to dominate.
          </p>
        </AnimateIn>
      </div>
    </section>
  );
}
