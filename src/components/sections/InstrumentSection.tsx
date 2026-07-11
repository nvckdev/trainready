"use client";

import { useRef } from "react";
import { gsap, SplitText, useGSAP } from "@/lib/gsap";

const SPECS = [
  {
    n: "01",
    name: "Goal-backed season",
    body: "Base, build, peak, taper: back-cast from race day and sized by the seasons you've already recorded.",
  },
  {
    n: "02",
    name: "Zones, re-derived",
    body: "Thresholds re-estimated from every breakthrough effort. Your zones are versioned, like the rest of the plan.",
  },
  {
    n: "03",
    name: "Daily re-flow",
    body: "Miss Tuesday, and Wednesday already knows. The plan bends around your life; the goal doesn't move.",
  },
  {
    n: "04",
    name: "Course match",
    body: "Import the race file and the long days learn its climbs, surface, and heat.",
  },
  {
    n: "05",
    name: "The why",
    body: "Every session names the adaptation it targets and the evidence behind it. No black boxes.",
  },
];

const TODAY = [
  { label: "Session", value: "Bike · 2 × 20' @ FTP" },
  { label: "Why", value: "Raise threshold before build 2 closes" },
  { label: "Re-flowed", value: "Thu run → Fri (travel)" },
];

/* Load-vs-capacity sparkline geometry (viewBox 0 0 220 64) */
const LOAD_PATH = "M0 50 L22 46 L44 48 L66 38 L88 41 L110 30 L132 33 L154 22 L176 26 L198 14 L220 17";

export function InstrumentSection() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        SplitText.create(".inst-title", {
          type: "lines",
          mask: "lines",
          autoSplit: true,
          onSplit: (self) =>
            gsap.from(self.lines, {
              yPercent: 106,
              duration: 0.9,
              ease: "expo.out",
              stagger: 0.09,
              scrollTrigger: { trigger: root.current, start: "top 70%" },
            }),
        });

        // Device panel: readiness arc draws, number ticks, load line draws
        const panelTrigger = { trigger: ".inst-panel", start: "top 75%" };

        gsap.set(".inst-arc, .inst-load, .inst-leader", { visibility: "visible" });
        gsap.fromTo(
          ".inst-arc",
          { drawSVG: "0% 0%" },
          {
            drawSVG: "0% 87%",
            duration: 1.4,
            ease: "power3.inOut",
            scrollTrigger: panelTrigger,
          }
        );
        const counter = { v: 0 };
        const readyEl = root.current?.querySelector(".inst-ready-num");
        gsap.to(counter, {
          v: 87,
          duration: 1.4,
          ease: "power3.inOut",
          scrollTrigger: panelTrigger,
          onUpdate: () => {
            if (readyEl) readyEl.textContent = String(Math.round(counter.v));
          },
        });
        gsap.from(".inst-load", {
          drawSVG: "0%",
          duration: 1.2,
          ease: "power2.inOut",
          delay: 0.3,
          scrollTrigger: panelTrigger,
        });
        gsap.from(".inst-load-dot", {
          scale: 0,
          transformOrigin: "center",
          duration: 0.4,
          delay: 1.5,
          scrollTrigger: panelTrigger,
        });
        gsap.from(".inst-split-row", {
          opacity: 0,
          x: -8,
          duration: 0.5,
          ease: "power2.out",
          stagger: 0.12,
          delay: 0.5,
          scrollTrigger: panelTrigger,
        });

        // Annotation leader lines draft outward, labels follow
        gsap.from(".inst-leader", {
          drawSVG: "0%",
          duration: 0.8,
          ease: "power2.inOut",
          stagger: 0.18,
          delay: 0.6,
          scrollTrigger: panelTrigger,
        });
        gsap.from(".inst-callout", {
          opacity: 0,
          duration: 0.5,
          stagger: 0.18,
          delay: 1.1,
          scrollTrigger: panelTrigger,
        });

        // Spec rows: rules extend, content rises
        gsap.utils.toArray<HTMLElement>(".inst-spec").forEach((row) => {
          const tl = gsap.timeline({
            scrollTrigger: { trigger: row, start: "top 88%" },
          });
          tl.from(row.querySelector(".inst-spec-rule"), {
            scaleX: 0,
            transformOrigin: "left center",
            duration: 0.8,
            ease: "power3.inOut",
          }).from(
            row.querySelector(".inst-spec-body"),
            { opacity: 0, y: 14, duration: 0.6, ease: "power3.out" },
            0.25
          );
        });
      });

      mm.add("(prefers-reduced-motion: reduce)", () => {
        gsap.set(".inst-arc, .inst-load, .inst-leader", { visibility: "visible" });
        const readyEl = root.current?.querySelector(".inst-ready-num");
        if (readyEl) readyEl.textContent = "87";
      });
    },
    { scope: root }
  );

  return (
    <section
      ref={root}
      id="engine"
      className="relative px-5 md:px-8 py-[clamp(6rem,14vh,11rem)]"
    >
      <div className="flex items-baseline justify-between">
        <p className="label-mono text-bone-muted">fig. 03 · The engine</p>
        <p className="label-mono text-bone-faint hidden md:block">Sheet 03</p>
      </div>

      <h2 className="inst-title display-engraved mt-4 text-[clamp(2.4rem,6vw,5rem)] max-w-[16ch]">
        Every morning, re-planned
      </h2>

      <div className="mt-14 md:mt-20 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8">
        {/* The device, drawn like a plate in a manual */}
        <div className="lg:col-span-7 relative">
          <div className="inst-panel relative max-w-[430px] mx-auto lg:mx-0 lg:ml-12">
            {/* Crop marks */}
            <span className="absolute -top-3 -left-3 w-3 h-3 border-t border-l border-bone" aria-hidden="true" />
            <span className="absolute -top-3 -right-3 w-3 h-3 border-t border-r border-bone" aria-hidden="true" />
            <span className="absolute -bottom-3 -left-3 w-3 h-3 border-b border-l border-bone" aria-hidden="true" />
            <span className="absolute -bottom-3 -right-3 w-3 h-3 border-b border-r border-bone" aria-hidden="true" />

            <div className="border border-bone bg-field-raised shadow-instrument">
              {/* Status bar */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-hairline">
                <span className="label-mono text-bone">Tue 11 Jul</span>
                <span className="flex items-center gap-2">
                  <span className="rec-dot" aria-hidden="true" />
                  <span className="label-mono text-bone-muted">Recording</span>
                </span>
              </div>

              {/* Readiness dial */}
              <div className="flex items-center gap-6 px-5 py-6 border-b border-hairline">
                <svg viewBox="0 0 96 96" className="w-24 h-24 shrink-0" aria-hidden="true">
                  <circle
                    cx="48"
                    cy="48"
                    r="40"
                    fill="none"
                    stroke="var(--hairline)"
                    strokeWidth="2"
                  />
                  <circle
                    className="inst-arc invisible"
                    cx="48"
                    cy="48"
                    r="40"
                    fill="none"
                    stroke="var(--signal)"
                    strokeWidth="3"
                    strokeDasharray="218.6 32.6"
                    transform="rotate(-90 48 48)"
                  />
                </svg>
                <div>
                  <div className="flex items-baseline gap-1">
                    <span className="inst-ready-num font-mono text-5xl tabular">0</span>
                    <span className="label-mono text-bone-faint">/100</span>
                  </div>
                  <p className="label-mono text-bone-muted mt-1">Ready to race</p>
                </div>
              </div>

              {/* Load vs capacity */}
              <div className="px-5 py-5 border-b border-hairline">
                <div className="flex justify-between mb-3">
                  <span className="label-mono text-bone-faint">Load</span>
                  <span className="label-mono text-bone-faint">6 weeks</span>
                </div>
                <svg viewBox="0 0 220 64" className="w-full" aria-hidden="true">
                  <line x1="0" y1="63.5" x2="220" y2="63.5" stroke="var(--hairline)" />
                  <line x1="0" y1="32" x2="220" y2="32" stroke="var(--hairline)" strokeDasharray="2 4" />
                  <path
                    className="inst-load invisible"
                    d={LOAD_PATH}
                    fill="none"
                    stroke="var(--signal)"
                    strokeWidth="1.75"
                  />
                  <circle className="inst-load-dot" cx="220" cy="17" r="3" fill="var(--signal)" />
                </svg>
              </div>

              {/* Today's decision */}
              <div className="px-5 py-4">
                {TODAY.map((s, i) => (
                  <div
                    key={s.label}
                    className={`inst-split-row grid grid-cols-[5.5rem_1fr] gap-3 py-2 ${
                      i < TODAY.length - 1 ? "border-b border-hairline" : ""
                    }`}
                  >
                    <span className="label-mono text-bone-faint pt-0.5">
                      {s.label}
                    </span>
                    <span
                      className={
                        i === 2
                          ? "label-mono text-signal-bright pt-0.5"
                          : "font-mono text-sm text-bone"
                      }
                    >
                      {s.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Annotations, desktop only */}
            <svg
              className="pointer-events-none absolute inset-0 w-full h-full overflow-visible hidden lg:block"
              aria-hidden="true"
            >
              <line className="inst-leader invisible" x1="100%" y1="24%" x2="128%" y2="24%" stroke="var(--bone)" strokeWidth="1" />
              <line className="inst-leader invisible" x1="100%" y1="56%" x2="128%" y2="56%" stroke="var(--bone)" strokeWidth="1" />
              <line className="inst-leader invisible" x1="0%" y1="86%" x2="-14%" y2="86%" stroke="var(--bone)" strokeWidth="1" />
            </svg>
            <p className="inst-callout label-mono text-bone-muted absolute left-[132%] top-[24%] -translate-y-1/2 w-40 hidden lg:block">
              3a · Readiness, computed daily
            </p>
            <p className="inst-callout label-mono text-bone-muted absolute left-[132%] top-[56%] -translate-y-1/2 w-40 hidden lg:block">
              3b · Load vs. capacity
            </p>
            <p className="inst-callout label-mono text-bone-muted absolute right-[118%] top-[86%] -translate-y-1/2 w-36 text-right hidden lg:block">
              3c · Re-flowed overnight
            </p>
          </div>
        </div>

        {/* Spec rows */}
        <div className="lg:col-span-5">
          {SPECS.map((s) => (
            <div key={s.n} className="inst-spec">
              <div className="inst-spec-rule rule" />
              <div className="inst-spec-body grid grid-cols-[3.5rem_1fr] gap-4 py-5">
                <span className="label-mono text-signal-bright pt-1">{s.n}</span>
                <div>
                  <h3 className="font-semibold text-lg">{s.name}</h3>
                  <p className="text-bone-muted text-[15px] leading-relaxed mt-1 max-w-[44ch]">
                    {s.body}
                  </p>
                </div>
              </div>
            </div>
          ))}
          <div className="rule" />
        </div>
      </div>
    </section>
  );
}
