import Image from "next/image";
import { AnimateIn } from "@/components/AnimateIn";

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-6 h-6 fill-current" aria-hidden="true">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

function GooglePlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-6 h-6 fill-current" aria-hidden="true">
      <path d="M3.18 23.76c.3.17.65.19.97.07l.11-.07 10.5-6.06-2.34-2.34-9.24 8.4zM.5 1.4C.19 1.74 0 2.26 0 2.93v18.14c0 .67.19 1.19.51 1.53l.08.08 10.16-10.16v-.23L.58 1.32.5 1.4zM20.23 10.3l-2.79-1.61-2.6 2.6 2.6 2.6 2.82-1.63c.8-.46.8-1.51-.03-1.96zM4.15.24L14.65 6.3 12.31 8.64 3.07.24c.31-.17.68-.17 1.08 0z" />
    </svg>
  );
}

function StoreButton({ store }: { store: "apple" | "google" }) {
  const isApple = store === "apple";
  return (
    <button className="flex items-center gap-4 bg-white hover:bg-white/90 rounded-2xl px-6 py-4 transition-all duration-200 group w-full sm:w-auto sm:min-w-[200px] active:scale-95 shadow-xl shadow-black/30">
      <span className="text-black shrink-0">
        {isApple ? <AppleIcon /> : <GooglePlayIcon />}
      </span>
      <div className="text-left">
        <div className="text-black/50 text-[10px] leading-none mb-0.5 uppercase tracking-widest font-medium">
          {isApple ? "Download on the" : "Get it on"}
        </div>
        <div className="text-black font-bold text-base leading-tight">
          {isApple ? "App Store" : "Google Play"}
        </div>
      </div>
    </button>
  );
}

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
                Now on Apple &amp; Android
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
              synced to your watch and ready when you are.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 w-full justify-center">
              <StoreButton store="apple" />
              <StoreButton store="google" />
            </div>

          </AnimateIn>
        </div>
      </div>
    </section>
  );
}
