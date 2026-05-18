import Image from "next/image";

const integrations = [
  {
    name: "Strava",
    logo: (
      // Strava chevron mark
      <svg height="22" viewBox="0 0 24 24" fill="white" style={{ display: "block", width: "auto" }}>
        <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
      </svg>
    ),
  },
  {
    name: "TrainingPeaks",
    logo: (
      // TrainingPeaks actual peak marks extracted from their SVG (Path_4750)
      // viewBox trimmed to the actual peak glyph bounds after translate(-139,-63.742)
      <svg height="22" viewBox="12 33 35 34" fill="white" style={{ display: "block", width: "auto" }}>
        <g transform="translate(-139 -63.742)">
          <path fillRule="evenodd" d="M165.875,96.742h6.432L160.98,122.5h-6.432ZM154.684,104.212h6.432l-3.685,8.38H151ZM170.684,104.212l-11.32,25.74h6.432l11.32-25.74ZM172.335,118l6.978-15.866h6.432L178.767,118Z" />
        </g>
      </svg>
    ),
  },
  {
    name: "Garmin",
    logo: (
      // Garmin wordmark — viewBox expanded slightly to prevent edge clipping
      <svg height="13" viewBox="-0.2 11.2 24.5 5.2" fill="white" style={{ display: "block", width: "auto" }}>
        <path d="M6.265 12.024a.289.289 0 0 0-.236-.146h-.182a.289.289 0 0 0-.234.146l-1.449 3.025c-.041.079.004.138.094.138h.335c.132 0 .193-.061.228-.134.037-.073.116-.234.13-.266.02-.045.083-.071.175-.071h1.559c.089 0 .148.016.175.071.018.035.098.179.136.256a.24.24 0 0 0 .234.142h.486c.089 0 .13-.069.098-.132-.034-.061-1.549-3.029-1.549-3.029zm-.914 2.224c-.089 0-.132-.067-.094-.148l.571-1.222c.039-.081.1-.081.136 0l.555 1.222c.037.081-.006.148-.096.148H5.351zm12.105-2.201v3.001c0 .083.073.138.163.138h.396c.089 0 .163-.057.163-.146v-2.998c0-.089-.059-.163-.148-.163h-.411c-.09-.001-.163.054-.163.168zm-6.631 1.88c-.051-.073-.022-.154.063-.181 0 0 .342-.102.506-.25.165-.146.246-.36.246-.636a1 1 0 0 0-.096-.457.787.787 0 0 0-.27-.303 1.276 1.276 0 0 0-.423-.171c-.165-.035-.386-.047-.386-.047a8.81 8.81 0 0 0-.325-.008H8.495a.164.164 0 0 0-.163.163v2.998c0 .089.073.146.163.146h.388c.089 0 .163-.057.163-.146v-1.193s.002 0 .002-.002l.738-.002c.089 0 .205.061.258.134l.766 1.077c.071.096.138.132.228.132h.508c.089 0 .104-.085.073-.128-.032-.038-.794-1.126-.794-1.126zm-.311-.61a1.57 1.57 0 0 1-.213.028 8.807 8.807 0 0 1-.325.006h-.763a.164.164 0 0 1-.163-.163v-.608c0-.089.073-.163.163-.163h.762c.089 0 .236.004.325.006 0 0 .114.004.213.028a.629.629 0 0 1 .24.098.358.358 0 0 1 .126.148.473.473 0 0 1 0 .374.352.352 0 0 1-.126.148.617.617 0 0 1-.239.098zm11.803-1.439c-.089 0-.163.059-.163.146v1.919c0 .089-.051.11-.114.047l-1.921-1.992a.376.376 0 0 0-.276-.118h-.362c-.114 0-.163.061-.163.122v3.068c0 .061.059.12.148.12h.362c.089 0 .152-.049.152-.132l.002-2.021c0-.089.051-.11.114-.045l2.004 2.082a.36.36 0 0 0 .279.116h.272a.164.164 0 0 0 .163-.163v-2.986a.164.164 0 0 0-.163-.163h-.334zm-7.835 1.87c-.043.079-.116.077-.159 0l-.939-1.724a.262.262 0 0 0-.236-.146h-.51a.164.164 0 0 0-.163.163v2.996c0 .089.059.15.163.15h.317c.089 0 .154-.057.154-.142 0-.041.002-2.179.004-2.179.004 0 1.173 2.177 1.173 2.177a.105.105 0 0 0 .189 0s1.179-2.173 1.181-2.173c.004 0 .002 2.11.002 2.173 0 .087.069.142.159.142h.364c.089 0 .163-.045.163-.163V12.04a.164.164 0 0 0-.163-.163h-.488a.265.265 0 0 0-.244.142l-.967 1.729zM0 13.529c0 1.616 1.653 1.697 1.984 1.697 1.098 0 1.561-.297 1.58-.309a.29.29 0 0 0 .152-.264v-1.116a.186.186 0 0 0-.187-.187H2.151c-.104 0-.171.083-.171.187v.116c0 .104.067.187.171.187h.797a.14.14 0 0 1 .14.14v.52c-.157.065-.874.274-1.451.136-.836-.199-.901-.89-.901-1.096 0-.173.053-1.043 1.079-1.13.831-.071 1.378.264 1.384.268.098.051.199.014.254-.089l.104-.209c.043-.085.028-.175-.077-.246-.006-.004-.59-.319-1.494-.319C.055 11.813 0 13.354 0 13.529zm22.134-2.478h-2.165c-.079 0-.148-.039-.187-.108s-.039-.146 0-.215l1.084-1.874a.21.21 0 0 1 .187-.108.21.21 0 0 1 .187.108l1.084 1.874a.203.203 0 0 1 0 .215.22.22 0 0 1-.19.108z"/>
      </svg>
    ),
  },
  {
    name: "COROS",
    logo: (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/logos/coros.png"
        alt="COROS"
        style={{ height: 22, width: "auto", display: "block", filter: "brightness(0) invert(1)" }}
      />
    ),
  },
];

export function HeroSection() {
  return (
    <section className="relative pt-36 md:pt-48 pb-24 md:pb-32 px-6 min-h-[90vh] flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 z-0">
        <Image
          src="/images/hero-bg.jpg"
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

      <div className="w-full max-w-[800px] mx-auto text-center relative z-20">
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
          <p className="text-white/25 text-[11px] uppercase tracking-widest mb-8">Connects with your gear</p>
          <div className="relative overflow-hidden w-full">
            <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-[#0A0505] to-transparent z-10 pointer-events-none" />
            <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-[#0A0505] to-transparent z-10 pointer-events-none" />
            <div className="flex animate-marquee gap-16 w-max items-center">
              {[...Array(2)].map((_, set) =>
                integrations.map(({ name, logo }) => (
                  <div
                    key={`${set}-${name}`}
                    className="shrink-0 flex items-center opacity-40 hover:opacity-70 transition-opacity duration-300"
                  >
                    {logo}
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
