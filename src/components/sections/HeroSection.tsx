import Image from "next/image";

const integrations = [
  {
    name: "Strava",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" /></svg>
    ),
  },
  {
    name: "TrainingPeaks",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="2,17 7,7 12,13 16,4 22,17"/></svg>
    ),
  },
  {
    name: "Garmin",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 2c2.033 0 3.914.715 5.4 1.894L4.394 17.4A7.961 7.961 0 0 1 4 15c0-3.733 2.55-6.866 6-7.745V12h2V6.09c.34-.056.687-.09 1-.09zm5.607 2.6A7.961 7.961 0 0 1 20 12c0 3.733-2.55 6.866-6 7.745V14h-2v5.91A8.035 8.035 0 0 1 7 20z"/></svg>
    ),
  },
  {
    name: "COROS",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M8 12a4 4 0 0 1 8 0"/></svg>
    ),
  },
  {
    name: "Wahoo",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M3 6l3 12 3-8 3 8 3-12 3 12"/></svg>
    ),
  },
  {
    name: "Apple Health",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
    ),
  },
  {
    name: "Polar",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm0 3l2.5 5H9.5L12 5zm0 14l-2.5-5h5L12 19zm-7-7l5-2.5v5L5 12zm14 0l-5 2.5v-5l5 2.5z"/></svg>
    ),
  },
  {
    name: "Suunto",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12h8M12 8v8"/></svg>
    ),
  },
];

export function HeroSection() {
  return (
    <section className="relative pt-36 md:pt-48 pb-24 md:pb-32 px-6 min-h-[90vh] flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 z-0">
        <Image
          src="https://images.pexels.com/photos/10141165/pexels-photo-10141165.jpeg?auto=compress&cs=tinysrgb&w=1920"
          alt="Runner silhouette on track at dramatic sunset with puddle reflections"
          fill
          priority
          quality={90}
          className="object-cover object-top opacity-55"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0A0505]/40 via-[#0A0505]/55 to-[#0A0505]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,45,85,0.1)_0%,transparent_65%)]" />
      </div>

      <div className="max-w-[800px] mx-auto text-center relative z-20">
        <h1 className="text-5xl sm:text-6xl md:text-8xl font-extrabold tracking-tight leading-[1.05] mb-6 md:mb-8 text-glow drop-shadow-2xl">
          Train Smarter.
          <br />
          <span className="text-white">Go Further.</span>
        </h1>

        <p className="text-white/75 text-base md:text-xl max-w-[540px] mx-auto mb-8 md:mb-10 font-medium leading-relaxed">
          The ultimate training ecosystem for runners, cyclists, and triathletes.
          Track every discipline with precision, optimize transitions, and peak on race day.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button className="w-full sm:w-auto bg-white text-black font-bold rounded-full px-10 py-4 hover:bg-white/90 active:scale-95 transition-all duration-200 shadow-xl text-sm tracking-wide">
            Start Training Free
          </button>
          <button className="w-full sm:w-auto border border-white/20 text-white/90 rounded-full px-10 py-4 hover:bg-white/5 hover:border-white/30 transition-all duration-200 text-sm backdrop-blur-sm">
            Watch the demo
          </button>
        </div>

        <div className="flex items-center justify-center gap-4 md:gap-6 mt-10 md:mt-12 text-white/35 text-xs flex-wrap">
          <span>All levels</span>
          <span className="w-px h-3 bg-white/20" />
          <span>Real-time coaching</span>
          <span className="w-px h-3 bg-white/20" />
          <span>Swim · Bike · Run</span>
        </div>

        {/* Integrations marquee */}
        <div className="mt-14 md:mt-20">
          <p className="text-white/25 text-[11px] uppercase tracking-widest mb-5">Connects with your gear</p>
          <div className="relative overflow-hidden w-full">
            <div className="absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-[#0A0505] to-transparent z-10 pointer-events-none" />
            <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-[#0A0505] to-transparent z-10 pointer-events-none" />
            <div className="flex animate-marquee gap-4 w-max items-center">
              {[...Array(2)].map((_, set) =>
                integrations.map(({ name, icon }) => (
                  <div
                    key={`${set}-${name}`}
                    className="flex items-center gap-2.5 border border-white/10 rounded-full px-4 py-2.5 bg-white/4 shrink-0"
                  >
                    <span className="shrink-0 opacity-60">{icon}</span>
                    <span className="text-white/40 text-xs font-medium whitespace-nowrap">{name}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
