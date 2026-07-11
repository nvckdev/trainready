"use client";

import { useRef } from "react";
import { gsap, SplitText, useGSAP } from "@/lib/gsap";

/* One organic contour ring, reused at shrinking scales around its centroid
   (300, 220) with slight rotation so the nest reads as drafted, not cloned. */
const CONTOUR_D =
  "M 300 80 C 420 70, 520 140, 500 230 C 485 300, 400 350, 310 355 C 210 360, 110 310, 100 220 C 92 130, 180 88, 300 80 Z";
const CONTOUR_SCALES = [1, 0.82, 0.64, 0.47, 0.31, 0.17];

function ContourField() {
  return (
    <svg
      viewBox="0 0 600 440"
      className="w-full h-auto"
      fill="none"
      aria-hidden="true"
    >
      {CONTOUR_SCALES.map((s, i) => (
        <path
          key={s}
          d={CONTOUR_D}
          className="contour-ring"
          transform={`translate(300 220) rotate(${i * 4}) scale(${s}) translate(-300 -220)`}
          stroke="var(--ink-faint)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {/* Summit crosshair */}
      <g stroke="var(--ink)" strokeWidth="1">
        <line x1="290" y1="220" x2="310" y2="220" />
        <line x1="300" y1="210" x2="300" y2="230" />
      </g>
      <text
        x="316"
        y="216"
        fontFamily="var(--font-fragment), monospace"
        fontSize="10"
        letterSpacing="0.08em"
        fill="var(--ink-muted)"
      >
        ELEV 1 847 M
      </text>
      {/* Route crossing the field */}
      <path
        className="hero-route"
        d="M 40 420 C 140 380, 150 300, 230 270 C 310 240, 330 190, 420 150 C 480 123, 520 90, 566 54"
        stroke="var(--signal)"
        strokeWidth="1.75"
      />
      <circle className="hero-route-end" cx="566" cy="54" r="3.5" fill="var(--signal)" />
      <text
        x="452"
        y="40"
        fontFamily="var(--font-fragment), monospace"
        fontSize="10"
        letterSpacing="0.08em"
        fill="var(--signal-ink)"
        className="hero-route-label"
      >
        KM 42.2
      </text>
    </svg>
  );
}

const STATS = [
  { label: "Pace", target: 252, unit: "/KM", format: (v: number) => `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, "0")}` },
  { label: "Power", target: 287, unit: "W", format: (v: number) => String(Math.round(v)) },
  { label: "Heart rate", target: 152, unit: "BPM", format: (v: number) => String(Math.round(v)) },
  { label: "VO₂ max", target: 61.4, unit: "ML/KG·MIN", format: (v: number) => v.toFixed(1) },
];

export function Hero() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const tl = gsap.timeline({
          defaults: { ease: "expo.out" },
        });

        // Kicker row rises out of a mask
        tl.from(".hero-kick", {
          yPercent: 110,
          duration: 0.7,
          stagger: 0.06,
        });

        // The engraving sets itself, character by character
        gsap.utils.toArray<HTMLElement>(".hero-word").forEach((word, i) => {
          SplitText.create(word, {
            type: "chars",
            mask: "chars",
            autoSplit: true,
            onSplit: (self) =>
              gsap.from(self.chars, {
                yPercent: 108,
                duration: 1.05,
                ease: "expo.out",
                stagger: 0.026,
                delay: 0.18 + i * 0.14,
              }),
          });
        });

        // Ruler extends
        tl.from(
          ".hero-tick",
          { scaleX: 0, transformOrigin: "left center", duration: 1.0 },
          0.55
        );

        // Body copy sets line by line
        SplitText.create(".hero-body", {
          type: "lines",
          mask: "lines",
          autoSplit: true,
          onSplit: (self) =>
            gsap.from(self.lines, {
              yPercent: 104,
              duration: 0.9,
              ease: "expo.out",
              stagger: 0.08,
              delay: 0.55,
            }),
        });

        tl.from(".hero-cta", { yPercent: 120, opacity: 0, duration: 0.7, stagger: 0.08 }, 0.85);

        // Contours draft themselves in
        gsap.set(".contour-ring, .hero-route", { visibility: "visible" });
        gsap.from(".contour-ring", {
          drawSVG: "0%",
          duration: 1.5,
          ease: "power2.inOut",
          stagger: 0.12,
          delay: 0.4,
        });
        gsap.from(".hero-route", {
          drawSVG: "0%",
          duration: 1.6,
          ease: "power2.inOut",
          delay: 1.2,
        });
        gsap.from(".hero-route-end, .hero-route-label", {
          opacity: 0,
          duration: 0.4,
          delay: 2.7,
        });

        // Telemetry counts up from zero
        gsap.utils.toArray<HTMLElement>(".hero-stat-value").forEach((el, i) => {
          const stat = STATS[i];
          const counter = { v: 0 };
          gsap.to(counter, {
            v: stat.target,
            duration: 1.6,
            ease: "power3.out",
            delay: 1.0 + i * 0.12,
            onUpdate: () => {
              el.textContent = stat.format(counter.v);
            },
          });
        });

        tl.from(".hero-foot", { opacity: 0, duration: 0.8 }, 1.6);
      });

      mm.add("(prefers-reduced-motion: reduce)", () => {
        gsap.set(".contour-ring, .hero-route", { visibility: "visible" });
        gsap.utils.toArray<HTMLElement>(".hero-stat-value").forEach((el, i) => {
          el.textContent = STATS[i].format(STATS[i].target);
        });
      });
    },
    { scope: root }
  );

  return (
    <section
      ref={root}
      className="relative pt-14 min-h-svh flex flex-col"
      aria-label="TrainReady, the training instrument"
    >
      {/* Contour field, drafted into the top right */}
      <div className="pointer-events-none absolute right-[-6%] top-16 w-[62vw] max-w-[720px] opacity-90 hidden md:block [&_.contour-ring]:invisible [&_.hero-route]:invisible">
        <ContourField />
      </div>

      <div className="relative z-10 px-5 md:px-8 pt-12 md:pt-16 grow flex flex-col">
        {/* Field-book header line */}
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-1 overflow-hidden">
          <span className="hero-kick label-mono text-ink">Field manual</span>
          <span className="hero-kick label-mono text-ink-muted">
            Precision training instrument
          </span>
          <span className="hero-kick label-mono text-ink-faint">Rev. 2026.07</span>
        </div>

        <h1 className="display-engraved mt-10 md:mt-14 text-[clamp(4.2rem,16vw,15rem)]">
          <span className="hero-word block">Train</span>
          <span className="hero-word block text-signal">Ready</span>
        </h1>

        <div className="hero-tick tick-strip mt-8 md:mt-10 max-w-[720px]" aria-hidden="true" />

        <div className="mt-8 md:mt-10 md:grid md:grid-cols-12 md:gap-8">
          <p className="hero-body col-span-5 max-w-[46ch] text-[15px] md:text-base leading-relaxed text-ink-muted">
            A precision instrument for endurance. It records every meter you
            swim, ride, and run; calibrates your training load against the
            course ahead; and tells you, in numbers, when you are ready to race.
          </p>

          <div className="col-span-7 mt-8 md:mt-0 flex flex-wrap items-start gap-3 overflow-hidden">
            <a
              href="#start"
              className="hero-cta label-mono bg-signal text-paper px-7 py-4 hover:bg-ink transition-colors duration-150"
            >
              Start recording
            </a>
            <a
              href="#instrument"
              className="hero-cta label-mono border border-hairline text-ink px-7 py-4 hover:border-ink transition-colors duration-150"
            >
              Read the spec
            </a>
          </div>
        </div>

        {/* Telemetry strip pinned to the bottom of the fold */}
        <div className="mt-auto pt-14">
          <div className="rule" />
          <dl className="grid grid-cols-2 md:grid-cols-4">
            {STATS.map((s, i) => (
              <div
                key={s.label}
                className={`py-5 md:py-6 pr-4 ${i > 0 ? "md:border-l md:border-hairline md:pl-6" : ""}`}
              >
                <dt className="label-mono text-ink-faint">{s.label}</dt>
                <dd className="mt-1 flex items-baseline gap-2">
                  <span className="hero-stat-value font-mono text-2xl md:text-3xl tabular text-ink">
                    0
                  </span>
                  <span className="label-mono text-ink-faint">{s.unit}</span>
                </dd>
              </div>
            ))}
          </dl>
          <div className="rule" />
          <div className="hero-foot flex items-center justify-between py-3">
            <span className="label-mono text-ink-faint">
              Scroll to begin calibration
            </span>
            <span className="label-mono text-ink-faint tabular">
              46.5197° N, 6.6323° E
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
