import Image from "next/image";
import Link from "next/link";


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
              src="/logo.png"
              alt="TRAINREADY logo"
              width={32}
              height={32}
              className="rounded-sm"
            />
            <span className="text-xl font-bold tracking-tight">TRAINREADY</span>
          </div>
          <p className="text-white/40 text-sm leading-relaxed max-w-[280px]">
            The premium AI training ecosystem for triathletes — built to adapt to you and elevate every session.
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

        {/* Get started */}
        <div className="col-span-1 md:col-span-4">
          <h4 className="font-bold text-xs mb-6 text-white/50 uppercase tracking-widest">
            Get Started
          </h4>
          <p className="text-white/40 text-sm mb-8 max-w-[280px] leading-relaxed">
            Sign up free and start training smarter today — no download needed.
          </p>
          <div className="flex flex-col gap-3">
            <a
              href="#signup"
              className="bg-[#FF2D55] hover:bg-[#e0263d] text-white rounded-2xl px-5 py-3 text-sm font-bold transition-all duration-200 text-center"
            >
              Start Training Free
            </a>
            <a
              href="#signup"
              className="border border-white/10 rounded-2xl px-5 py-3 text-sm text-white/60 hover:text-white hover:border-white/20 transition-all duration-200 text-center"
            >
              Sign In
            </a>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="max-w-[1200px] mx-auto relative z-10 mt-20 pt-8 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4 text-white/25 text-xs">
        <span>© 2026 TRAINREADY. All rights reserved.</span>
        <div className="flex gap-6">
          <Link href="/privacy" className="hover:text-white/50 transition-colors duration-200">Privacy</Link>
          <Link href="/terms" className="hover:text-white/50 transition-colors duration-200">Terms</Link>
          <Link href="/cookies" className="hover:text-white/50 transition-colors duration-200">Cookies</Link>
        </div>
      </div>
    </footer>
  );
}
