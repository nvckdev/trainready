"use client";

import { useRef } from "react";
import { gsap, SplitText, useGSAP } from "@/lib/gsap";

type Discipline = {
  id: string;
  index: string;
  name: string;
  metric1: [string, string];
  metric2: [string, string];
  caption: string;
  diagram: React.ReactNode;
};

/* Each diagram is a measured line: axes in hairline ink, data in signal. */
const DISCIPLINES: Discipline[] = [
  {
    id: "swim",
    index: "D·1",
    name: "Swim",
    metric1: ["Pace /100m", "1:38"],
    metric2: ["Stroke rate", "34 SPM"],
    caption: "Stroke cadence, recorded per length",
    diagram: (
      <svg viewBox="0 0 260 90" className="w-full" aria-hidden="true">
        <line x1="0" y1="82" x2="260" y2="82" stroke="var(--hairline)" />
        {[0, 65, 130, 195, 260].map((x) => (
          <line key={x} x1={x} y1="78" x2={x} y2="86" stroke="var(--ink-faint)" strokeWidth="1" />
        ))}
        <path
          className="disc-line"
          d="M0 48 C 16 22, 32 22, 48 48 S 80 74, 96 48 S 128 22, 144 48 S 176 74, 192 48 S 224 22, 240 48 L 260 48"
          fill="none"
          stroke="var(--signal)"
          strokeWidth="1.75"
        />
      </svg>
    ),
  },
  {
    id: "bike",
    index: "D·2",
    name: "Bike",
    metric1: ["Norm. power", "243 W"],
    metric2: ["Cadence", "91 RPM"],
    caption: "Power distribution across intervals",
    diagram: (
      <svg viewBox="0 0 260 90" className="w-full" aria-hidden="true">
        <line x1="0" y1="82" x2="260" y2="82" stroke="var(--hairline)" />
        {[0, 65, 130, 195, 260].map((x) => (
          <line key={x} x1={x} y1="78" x2={x} y2="86" stroke="var(--ink-faint)" strokeWidth="1" />
        ))}
        <path
          className="disc-line"
          d="M0 70 L28 70 L28 34 L64 34 L64 58 L96 58 L96 20 L136 20 L136 50 L168 50 L168 12 L204 12 L204 44 L236 44 L236 64 L260 64"
          fill="none"
          stroke="var(--signal)"
          strokeWidth="1.75"
        />
      </svg>
    ),
  },
  {
    id: "run",
    index: "D·3",
    name: "Run",
    metric1: ["Pace /km", "4:05"],
    metric2: ["Vert. gain", "612 M"],
    caption: "Split profile, negative by design",
    diagram: (
      <svg viewBox="0 0 260 90" className="w-full" aria-hidden="true">
        <line x1="0" y1="82" x2="260" y2="82" stroke="var(--hairline)" />
        {[20, 50, 80, 110, 140, 170, 200, 230].map((x, i) => (
          <line
            key={x}
            className="disc-bar"
            x1={x}
            y1="82"
            x2={x}
            y2={28 + i * 5.5}
            stroke="var(--signal)"
            strokeWidth="10"
          />
        ))}
      </svg>
    ),
  },
];

export function DisciplinesSection() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        SplitText.create(".disc-title", {
          type: "lines",
          mask: "lines",
          autoSplit: true,
          onSplit: (self) =>
            gsap.from(self.lines, {
              yPercent: 106,
              duration: 0.9,
              ease: "expo.out",
              stagger: 0.09,
              scrollTrigger: { trigger: root.current, start: "top 72%" },
            }),
        });

        gsap.set(".disc-line", { visibility: "visible" });
        gsap.utils.toArray<HTMLElement>(".disc-col").forEach((col, i) => {
          const tl = gsap.timeline({
            scrollTrigger: { trigger: col, start: "top 82%" },
            delay: i * 0.15,
          });
          tl.from(col.querySelector(".disc-head"), {
            yPercent: 60,
            opacity: 0,
            duration: 0.7,
            ease: "expo.out",
          });
          const line = col.querySelector(".disc-line");
          if (line) {
            tl.from(line, { drawSVG: "0%", duration: 1.2, ease: "power2.inOut" }, 0.2);
          }
          const bars = col.querySelectorAll(".disc-bar");
          if (bars.length) {
            tl.from(
              bars,
              {
                scaleY: 0,
                transformOrigin: "bottom",
                duration: 0.7,
                ease: "power3.out",
                stagger: 0.07,
              },
              0.2
            );
          }
          tl.from(
            col.querySelectorAll(".disc-metric"),
            { opacity: 0, y: 10, duration: 0.5, stagger: 0.1, ease: "power2.out" },
            0.7
          );
        });
      });

      mm.add("(prefers-reduced-motion: reduce)", () => {
        gsap.set(".disc-line", { visibility: "visible" });
      });

      // Hover: redraw the measurement (any motion preference honors hover intent)
      gsap.utils.toArray<HTMLElement>(".disc-col").forEach((col) => {
        const line = col.querySelector(".disc-line");
        const bars = col.querySelectorAll(".disc-bar");
        col.addEventListener("mouseenter", () => {
          if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
          if (line)
            gsap.fromTo(
              line,
              { drawSVG: "0%" },
              { drawSVG: "100%", duration: 0.9, ease: "power2.inOut", overwrite: "auto" }
            );
          if (bars.length)
            gsap.fromTo(
              bars,
              { scaleY: 0, transformOrigin: "bottom" },
              { scaleY: 1, duration: 0.5, stagger: 0.05, ease: "power3.out", overwrite: "auto" }
            );
        });
      });
    },
    { scope: root }
  );

  return (
    <section
      ref={root}
      id="disciplines"
      className="relative px-5 md:px-8 py-[clamp(6rem,14vh,11rem)]"
    >
      <div className="flex items-baseline justify-between">
        <p className="label-mono text-ink-muted">fig. 04 · Disciplines</p>
        <p className="label-mono text-ink-faint hidden md:block">Sheet 4 of 6</p>
      </div>

      <h2 className="disc-title display-engraved mt-4 text-[clamp(2.4rem,6vw,5rem)] max-w-[18ch]">
        Three disciplines, one instrument
      </h2>

      <div className="mt-14 md:mt-20 grid grid-cols-1 md:grid-cols-3 border-t border-b border-hairline md:divide-x md:divide-hairline">
        {DISCIPLINES.map((d) => (
          <div
            key={d.id}
            className="disc-col group px-0 md:px-8 first:pl-0 last:pr-0 py-10 border-b border-hairline md:border-b-0 last:border-b-0"
          >
            <div className="disc-head flex items-baseline justify-between">
              <h3 className="display-engraved text-[clamp(1.8rem,3vw,2.6rem)]">
                {d.name}
              </h3>
              <span className="label-mono text-signal-ink">{d.index}</span>
            </div>

            <div className="mt-8 [&_.disc-line]:invisible">{d.diagram}</div>
            <p className="label-mono text-ink-faint mt-3">{d.caption}</p>

            <dl className="mt-8 space-y-3">
              <div className="disc-metric flex justify-between border-t border-hairline pt-3">
                <dt className="label-mono text-ink-muted">{d.metric1[0]}</dt>
                <dd className="font-mono text-sm tabular">{d.metric1[1]}</dd>
              </div>
              <div className="disc-metric flex justify-between border-t border-hairline pt-3">
                <dt className="label-mono text-ink-muted">{d.metric2[0]}</dt>
                <dd className="font-mono text-sm tabular">{d.metric2[1]}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}
