import Image from "next/image";
import { AnimateIn } from "@/components/AnimateIn";


export function WatchSection() {
  return (
    <section className="py-4 md:py-8 px-4 md:px-6 relative bg-black" id="race">
      <div className="max-w-[1200px] mx-auto relative overflow-hidden h-[600px] md:h-[800px] flex flex-col items-center justify-center rounded-2xl md:rounded-3xl">
        <Image
          src="https://images.pexels.com/photos/31291212/pexels-photo-31291212.jpeg?auto=compress&cs=tinysrgb&w=1920"
          alt="Male runner checking watch during marathon"
          fill
          quality={90}
          className="object-cover object-top opacity-70"
          sizes="(max-width: 1200px) 100vw, 1200px"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/25 to-black/55" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-transparent to-black/40" />

        <div className="relative z-10 text-center flex flex-col items-center justify-between h-full py-10 md:py-16 w-full px-6">

          <AnimateIn direction="down">
            <div className="flex flex-col items-center">
              <div className="inline-flex items-center gap-2 border border-white/10 rounded-full px-4 py-1.5 text-xs text-white/50 mb-6 md:mb-8 backdrop-blur-sm bg-white/5 uppercase tracking-widest">
                Web Platform
              </div>
              <h2 className="text-4xl sm:text-5xl md:text-7xl font-extrabold tracking-tight max-w-[600px] leading-[1.05] text-white drop-shadow-lg">
                Train Smarter.
                <br />
                Race Faster.
              </h2>
            </div>
          </AnimateIn>

          <AnimateIn delay={100} direction="up" className="flex flex-col items-center w-full max-w-[520px] gap-6 md:gap-8">
            <p className="text-white/65 text-sm md:text-base max-w-[420px] font-medium leading-relaxed">
              Structured training plans, live pace coaching, and race-day strategy —
              available in your browser and ready when you are.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 w-full justify-center">
              <a
                href="#signup"
                className="flex items-center justify-center gap-2 bg-white hover:bg-white/90 rounded-2xl px-8 py-4 text-black font-bold text-sm transition-all duration-200 active:scale-95 shadow-xl shadow-black/30"
              >
                <span className="material-symbols-outlined text-[18px]">open_in_browser</span>
                Start Training Free
              </a>
              <a
                href="#signup"
                className="flex items-center justify-center gap-2 border border-white/20 hover:bg-white/5 hover:border-white/30 rounded-2xl px-8 py-4 text-white/90 font-semibold text-sm transition-all duration-200"
              >
                See how it works
              </a>
            </div>

          </AnimateIn>
        </div>
      </div>
    </section>
  );
}
