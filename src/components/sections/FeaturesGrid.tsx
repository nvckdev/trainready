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
                className={`group relative h-full rounded-3xl p-px overflow-hidden transition-transform duration-500 ease-out hover:-translate-y-1.5
                  ${feature.accent
                    ? "bg-gradient-to-b from-[#FF2D55]/40 via-white/10 to-white/[0.03]"
                    : "bg-gradient-to-b from-white/12 to-white/[0.03] hover:from-white/20"
                  }`}
              >
                <div className="relative flex h-full flex-col gap-5 rounded-[calc(1.5rem-1px)] bg-[#120808] p-7 overflow-hidden">
                  {/* Crimson bloom — persistent on accent card, hover-reveal on others */}
                  <div
                    className={`pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(255,45,85,0.16),transparent_65%)] transition-opacity duration-500
                      ${feature.accent ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                  />
                  {/* Top hairline highlight */}
                  <div className="pointer-events-none absolute inset-x-7 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />

                  {/* Editorial index */}
                  <span className="absolute right-6 top-6 text-[11px] font-semibold tracking-widest text-white/15 tabular-nums">
                    0{i + 1}
                  </span>

                  {/* Icon chip */}
                  <div
                    className={`relative flex h-12 w-12 items-center justify-center rounded-2xl border transition-colors duration-300
                      ${feature.accent
                        ? "border-[#FF2D55]/30 bg-[#FF2D55]/10 text-[#FF2D55]"
                        : "border-white/8 bg-white/[0.03] text-white/40 group-hover:border-white/15 group-hover:text-white/70"
                      }`}
                  >
                    <span className="material-symbols-outlined text-[26px]">{feature.icon}</span>
                  </div>

                  <h3
                    className={`relative text-xl font-bold leading-tight whitespace-pre-line transition-colors duration-300
                      ${feature.accent ? "text-white" : "text-white/85 group-hover:text-white"}`}
                  >
                    {feature.title}
                  </h3>
                  <p
                    className={`relative text-[13px] leading-relaxed transition-colors duration-300
                      ${feature.accent ? "text-white/55" : "text-white/35 group-hover:text-white/55"}`}
                  >
                    {feature.description}
                  </p>
                </div>
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
