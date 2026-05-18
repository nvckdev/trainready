"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

const navLeft = [
  { label: "Our Feature", href: "#features" },
  { label: "Training Plan", href: "#training", hasChevron: true },
  { label: "Community", href: "#community" },
  { label: "Race", href: "#race" },
];
const navRight = [
  { label: "Support", href: "#support" },
  { label: "Help", href: "#help" },
];
const allLinks = [...navLeft, ...navRight];

export function NavBar() {
  const [scrolled, setScrolled] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const update = () => {
      const scrollY = window.scrollY;
      const docH = document.documentElement.scrollHeight - window.innerHeight;
      const pct = docH > 0 ? (scrollY / docH) * 100 : 0;
      setScrolled(scrollY > 20);
      if (barRef.current) {
        barRef.current.style.width = `${pct}%`;
        barRef.current.style.opacity = scrollY > 20 ? "1" : "0";
      }
      rafRef.current = requestAnimationFrame(update);
    };
    rafRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <header
      className={`fixed w-full top-0 z-50 transition-all duration-500 ${
        scrolled
          ? "bg-[#0A0505]/92 backdrop-blur-xl border-b border-white/5 shadow-lg shadow-black/20"
          : "bg-transparent border-b border-transparent"
      }`}
    >
      {/* Scroll progress bar — updated directly via rAF, no React re-render */}
      <div
        ref={barRef}
        className="absolute bottom-0 left-0 h-[2px] bg-[#FF2D55] rounded-r-full"
        style={{ width: "0%", opacity: 0, transition: "opacity 300ms ease" }}
      />

      <nav className="max-w-[1440px] mx-auto px-4 md:px-6 py-3.5 md:py-4 flex items-center justify-between relative">
        {/* Left links — desktop */}
        <div className="hidden lg:flex items-center gap-5 text-sm text-white/55 w-[320px]">
          {navLeft.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="hover:text-white transition-colors duration-200 flex items-center gap-0.5 whitespace-nowrap"
            >
              {item.label}
              {item.hasChevron && (
                <span className="material-symbols-outlined text-[15px] opacity-60 mt-0.5">expand_more</span>
              )}
            </a>
          ))}
        </div>

        {/* Logo — centered on desktop, left-aligned on mobile */}
        <a href="/" className="flex items-center gap-2.5 lg:absolute lg:left-1/2 lg:-translate-x-1/2">
          <Image
            src="/logo.png"
            alt="TRAINREADY logo"
            width={28}
            height={28}
            className="rounded-sm"
          />
          <span className="text-lg md:text-xl font-bold tracking-tight text-white">TRAINREADY</span>
        </a>

        {/* Right links — desktop */}
        <div className="hidden lg:flex items-center gap-5 text-sm w-[320px] justify-end">
          {navRight.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="text-white/55 hover:text-white transition-colors duration-200"
            >
              {item.label}
            </a>
          ))}
          <a
            href="#signup"
            className="border border-white/20 rounded-full px-5 py-2 text-sm text-white/90 hover:bg-white/10 hover:border-white/30 transition-all duration-200 ml-1"
          >
            Sign Up
          </a>
        </div>

        {/* Mobile right: sign up + hamburger */}
        <div className="lg:hidden flex items-center gap-2 ml-auto">
          <a
            href="#signup"
            className="border border-white/20 rounded-full px-4 py-1.5 text-xs text-white/90 hover:bg-white/10 transition-all duration-200"
          >
            Sign Up
          </a>
          <Sheet>
            <SheetTrigger className="text-white hover:bg-white/10 rounded-md p-1.5 transition-colors duration-200">
              <span className="material-symbols-outlined text-[22px]">menu</span>
            </SheetTrigger>
            <SheetContent side="right" className="bg-[#140A0A] border-white/10 text-white w-[260px] p-6">
              <a href="/" className="flex items-center gap-2.5 mb-8">
                <Image
                  src="/logo.png"
                  alt="TRAINREADY"
                  width={26}
                  height={26}
                  className="rounded-sm"
                />
                <span className="font-bold tracking-tight text-sm">TRAINREADY</span>
              </a>
              <nav className="flex flex-col gap-0.5">
                {allLinks.map((item) => (
                  <a
                    key={item.label}
                    href={item.href}
                    className="text-white/65 hover:text-white hover:bg-white/5 transition-all duration-200 py-3 px-3 rounded-xl text-sm"
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
              <div className="mt-8 pt-6 border-t border-white/8 space-y-3">
                <a
                  href="#signup"
                  className="flex items-center justify-center bg-[#FF2D55] text-white rounded-full py-3 text-sm font-bold hover:bg-[#e0263d] transition-colors duration-200"
                >
                  Start Training Free
                </a>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </header>
  );
}
