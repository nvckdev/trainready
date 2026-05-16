"use client";

import { AnimateIn } from "@/components/AnimateIn";

const features = [
  {
    icon: "monitoring",
    title: "Precision\nTri-Metrics",
    description:
      "Monitor your swim stroke, cycling power, and running pace with unified multi-sport analytics.",
    accent: true,
    href: "#features",
  },
  {
    icon: "psychology",
    title: "Adaptive\nMulti-Sport Plans",
    description:
      "AI-powered periodization that balances your load across all disciplines to prevent overtraining.",
    accent: false,
    href: "#training",
  },
  {
    icon: "bolt",
    title: "Race-Day\nStrategy",
    description:
      "Build your perfect race plan with pacing targets, nutrition timing, and split projections for any distance.",
    accent: false,
    href: "#race",
  },
  {
    icon: "group",
    title: "Triathlete\nCommunity",
    description:
      "Connect with fellow multi-sport athletes, join virtual triathlons, and share your journey.",
    accent: false,
    href: "#community",
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
            <AnimateIn key={i} delay={i * 90} direction="up" className="h-full">
              <div
                className={`relative rounded-3xl p-7 flex flex-col gap-4 h-full transition-all duration-300 cursor-default
                  ${feature.accent
                    ? "bg-[#140A0A] border border-white/8"
                    : "bg-[#1E1010]/60 border border-white/5"
                  }`}
              >
                {feature.accent && (
                  <div
                    className="absolute top-7 right-7 w-2 h-2 rounded-full bg-[#FF2D55]"
                    style={{ boxShadow: "0 0 8px #FF2D55" }}
                  />
                )}
                <span
                  className={`material-symbols-outlined text-[30px]
                    ${feature.accent ? "text-[#FF2D55]" : "text-white/25"}`}
                >
                  {feature.icon}
                </span>
                <h3
                  className={`text-xl font-bold whitespace-pre-line leading-tight
                    ${feature.accent ? "text-white" : "text-white/80"}`}
                >
                  {feature.title}
                </h3>
                <p
                  className={`text-[13px] leading-relaxed
                    ${feature.accent ? "text-white/50" : "text-white/30"}`}
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
