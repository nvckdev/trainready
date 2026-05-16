import Image from "next/image";
import Link from "next/link";

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current shrink-0" aria-hidden="true">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

function GooglePlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current shrink-0" aria-hidden="true">
      <path d="M3.18 23.76c.3.17.65.19.97.07l.11-.07 10.5-6.06-2.34-2.34-9.24 8.4zM.5 1.4C.19 1.74 0 2.26 0 2.93v18.14c0 .67.19 1.19.51 1.53l.08.08 10.16-10.16v-.23L.58 1.32.5 1.4zM20.23 10.3l-2.79-1.61-2.6 2.6 2.6 2.6 2.82-1.63c.8-.46.8-1.51-.03-1.96zM4.15.24L14.65 6.3 12.31 8.64 3.07.24c.31-.17.68-.17 1.08 0z" />
    </svg>
  );
}

const menuLinks = [
  { label: "Our Feature", href: "#features" },
  { label: "Training Plan", href: "#training" },
  { label: "Community", href: "#community" },
  { label: "Support", href: "#support" },
  { label: "Help", href: "#help" },
];

const socialLinks = [
  { label: "Instagram", href: "#" },
  { label: "Facebook", href: "#" },
  { label: "TikTok", href: "#" },
  { label: "Twitter / X", href: "#" },
];


export function Footer() {
  return (
    <footer className="relative bg-[#0A0505] pt-32 pb-16 px-6 overflow-hidden border-t border-white/5">
      {/* Ghost watermark */}
      <div className="absolute bottom-0 left-0 right-0 h-[280px] flex items-end justify-center opacity-[0.04] pointer-events-none overflow-hidden select-none">
        <span className="text-[22vw] font-black leading-none tracking-tighter text-white">
          TRAINREADY
        </span>
      </div>

      <div className="max-w-[1200px] mx-auto relative z-10 grid grid-cols-1 md:grid-cols-12 gap-12">
        {/* Brand column */}
        <div className="col-span-1 md:col-span-4">
          <div className="flex items-center gap-3 mb-6">
            <Image
              src="https://lh3.googleusercontent.com/aida/ADBb0ujDgmM4zYyEHa8wFUQd1eFyPcep5iv9h_AgS-io9l-Ut2GWCP0Qg0CM1C1K1Zqrg3LZW7zxKGFOQl3D6CAx-gCTM0iMDoQbVhx0nqzeYlkZDQN-oYVzEKIUFScev3RsOMNEwJQhAhkADKTZ6lALmSOuyl9zsRQA3SlbMV-rplnDP5uBqpKFy1kMCOveJ-AWGeJLS32tG6tMyMgAIHcSvrmkOEyakOZIkm44ijPLD7R2eFEL7I1eN7_owrmn"
              alt="TRAINREADY logo"
              width={32}
              height={32}
              className="rounded-sm"
            />
            <span className="text-xl font-bold tracking-tight">TRAINREADY</span>
          </div>
          <p className="text-white/40 text-sm leading-relaxed max-w-[280px]">
            The premium triathlete&apos;s platform. Track every discipline, train
            smarter, and share your multi-sport journey with the global
            community.
          </p>
          {/* Red accent line */}
          <div className="mt-8 w-12 h-[2px] bg-[#FF2D55] rounded-full" />
        </div>

        {/* Menu */}
        <div className="col-span-1 md:col-span-2">
          <h4 className="font-bold text-xs mb-6 text-white/50 uppercase tracking-widest">
            Menu
          </h4>
          <div className="flex flex-col gap-4 text-white/50 text-sm">
            {menuLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="hover:text-white transition-colors duration-200"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>

        {/* Social */}
        <div className="col-span-1 md:col-span-2">
          <h4 className="font-bold text-xs mb-6 text-white/50 uppercase tracking-widest">
            Follow Us
          </h4>
          <div className="flex flex-col gap-4 text-white/50 text-sm">
            {socialLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="hover:text-white transition-colors duration-200 flex items-center gap-1.5 group"
              >
                <span className="w-1 h-1 rounded-full bg-white/20 group-hover:bg-[#FF2D55] transition-colors duration-200" />
                {link.label}
              </a>
            ))}
          </div>
        </div>

        {/* App download */}
        <div className="col-span-1 md:col-span-4">
          <h4 className="font-bold text-xs mb-6 text-white/50 uppercase tracking-widest">
            Get the App
          </h4>
          <p className="text-white/40 text-sm mb-8 max-w-[280px] leading-relaxed">
            Download now to start tracking your swims, bikes, and runs with
            elite precision.
          </p>
          <div className="flex flex-col gap-3">
            {[
              { icon: <AppleIcon />, sub: "Download on the", label: "App Store" },
              { icon: <GooglePlayIcon />, sub: "Get it on", label: "Google Play" },
            ].map((btn) => (
              <button
                key={btn.label}
                className="border border-white/10 rounded-2xl px-5 py-3 flex items-center gap-3 hover:bg-white/5 hover:border-white/20 transition-all duration-200 text-left group w-full max-w-[200px]"
              >
                <span className="text-white/50 group-hover:text-white transition-colors duration-200">
                  {btn.icon}
                </span>
                <div>
                  <div className="text-white/30 text-[10px] leading-none mb-0.5 uppercase tracking-wide">
                    {btn.sub}
                  </div>
                  <div className="text-white text-sm font-semibold">
                    {btn.label}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="max-w-[1200px] mx-auto relative z-10 mt-20 pt-8 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4 text-white/25 text-xs">
        <span>© 2025 TRAINREADY. All rights reserved.</span>
        <div className="flex gap-6">
          <Link href="/privacy" className="hover:text-white/50 transition-colors duration-200">Privacy</Link>
          <Link href="/terms" className="hover:text-white/50 transition-colors duration-200">Terms</Link>
          <Link href="/cookies" className="hover:text-white/50 transition-colors duration-200">Cookies</Link>
        </div>
      </div>
    </footer>
  );
}
