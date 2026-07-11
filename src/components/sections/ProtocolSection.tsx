"use client";

import { useRef } from "react";
import { gsap, useGSAP } from "@/lib/gsap";

const STEPS = [
  {
    n: "01",
    name: "Connect",
    body: "Import every season you've recorded: TrainingPeaks, Strava, Garmin, COROS. Your history is the syllabus.",
  },
  {
    n: "02",
    name: "Aim",
    body: "Pick the race, the date, the goal. Taper back-casts the season from the start line: base, build, peak, taper.",
  },
  {
    n: "03",
    name: "Adapt",
    body: "Every morning the plan re-flows around what you actually did, how you recovered, and the hours you have left.",
  },
];

export function ProtocolSection() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.utils.toArray<HTMLElement>(".proto-step").forEach((step, i) => {
          const tl = gsap.timeline({
            scrollTrigger: { trigger: step, start: "top 88%" },
            delay: i * 0.12,
          });
          tl.from(step.querySelector(".proto-rule"), {
            scaleX: 0,
            transformOrigin: "left center",
            duration: 0.9,
            ease: "power3.inOut",
          }).from(
            step.querySelector(".proto-body"),
            { opacity: 0, y: 14, duration: 0.6, ease: "power3.out" },
            0.3
          );
        });
      });
    },
    { scope: root }
  );

  return (
    <section
      ref={root}
      id="protocol"
      className="relative px-5 md:px-8 py-[clamp(5rem,11vh,9rem)]"
    >
      <p className="label-mono text-bone-muted mb-8">fig. 01 · Protocol</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-10">
        {STEPS.map((s) => (
          <div key={s.n} className="proto-step">
            <div className="proto-rule rule" />
            <div className="proto-body py-6">
              <div className="flex items-baseline justify-between">
                <h2 className="display-engraved text-[clamp(1.5rem,2.4vw,2.1rem)]">
                  {s.name}
                </h2>
                <span className="label-mono text-signal-bright">{s.n}</span>
              </div>
              <p className="mt-3 text-bone-muted text-[15px] leading-relaxed max-w-[44ch]">
                {s.body}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
