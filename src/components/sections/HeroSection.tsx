import Image from "next/image";

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

        {/* Integrations strip */}
        <div className="mt-14 md:mt-20">
          <p className="text-white/25 text-[11px] uppercase tracking-widest mb-5">Connects with your gear</p>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            {[
              { name: "Strava", color: "#FC4C02" },
              { name: "TrainingPeaks", color: "#4A90D9" },
              { name: "Garmin", color: "#007CC3" },
              { name: "COROS", color: "#E8E8E8" },
            ].map((brand) => (
              <div
                key={brand.name}
                className="flex items-center gap-2 border border-white/8 rounded-full px-4 py-2 bg-white/3 hover:bg-white/6 hover:border-white/15 transition-all duration-200"
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: brand.color }}
                />
                <span className="text-white/50 text-xs font-medium">{brand.name}</span>
              </div>
            ))}
            <div className="flex items-center gap-2 border border-white/5 rounded-full px-4 py-2 bg-white/2">
              <span className="text-white/20 text-xs">+ more</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
