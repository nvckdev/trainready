"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { gsap, ScrollTrigger, SplitText, useGSAP } from "@/lib/gsap";
import { routePoints, routeReadout, TOTAL_KM } from "@/lib/terrain";
import type { ProgressState } from "@/components/three/TerrainScene";

const TerrainScene = dynamic(
  () => import("@/components/three/TerrainScene").then((m) => m.TerrainScene),
  { ssr: false }
);

export function TerrainSection() {
  const root = useRef<HTMLElement>(null);
  const progress = useRef<ProgressState>({ target: 0, value: 0 });
  const [reduced, setReduced] = useState<boolean | null>(null);

  const pts = useMemo(() => routePoints(), []);

  const kmRef = useRef<HTMLSpanElement>(null);
  const elevRef = useRef<HTMLSpanElement>(null);
  const gradeRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const setReadouts = (p: number) => {
        const r = routeReadout(pts, p);
        if (kmRef.current) kmRef.current.textContent = r.km.toFixed(1);
        if (elevRef.current)
          elevRef.current.textContent = String(Math.round(r.elev));
        if (gradeRef.current)
          gradeRef.current.textContent = `${r.grade >= 0 ? "+" : ""}${r.grade.toFixed(1)}`;
        if (barRef.current) gsap.set(barRef.current, { scaleX: p });
      };

      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        setReduced(false);

        ScrollTrigger.create({
          trigger: root.current,
          start: "top top",
          end: "+=280%",
          pin: true,
          scrub: true,
          onUpdate: (self) => {
            progress.current.target = self.progress;
            setReadouts(self.progress);
          },
        });

        SplitText.create(".route-title", {
          type: "lines",
          mask: "lines",
          autoSplit: true,
          onSplit: (self) =>
            gsap.from(self.lines, {
              yPercent: 106,
              duration: 0.9,
              ease: "expo.out",
              stagger: 0.09,
              scrollTrigger: {
                trigger: root.current,
                start: "top 72%",
              },
            }),
        });

        gsap.from(".route-hud", {
          opacity: 0,
          duration: 0.8,
          ease: "power2.out",
          stagger: 0.1,
          scrollTrigger: { trigger: root.current, start: "top 55%" },
        });

        setReadouts(0);
      });

      mm.add("(prefers-reduced-motion: reduce)", () => {
        setReduced(true);
        progress.current.target = 0.62;
        progress.current.value = 0.62;
        setReadouts(0.62);
      });
    },
    { scope: root }
  );

  return (
    <section
      ref={root}
      id="course"
      className="relative h-svh overflow-hidden bg-field"
      aria-label="Course survey: a night contour terrain with the race route drawn across it"
    >
      <div className="absolute inset-0">
        {reduced !== null && (
          <TerrainScene
            progress={progress}
            frameloop={reduced ? "demand" : "always"}
          />
        )}
      </div>

      {/* HUD — survey sheet furniture over the scene */}
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between px-5 md:px-8 pt-24 md:pt-28 pb-6">
        <div>
          <p className="route-hud label-mono text-bone-muted">
            fig. 02 · Course survey
          </p>
          <h2 className="route-title display-engraved mt-3 text-[clamp(2.2rem,5.5vw,4.6rem)] max-w-[15ch]">
            Built for your course
          </h2>
        </div>

        <div>
          <dl className="route-hud flex flex-wrap gap-x-10 gap-y-4 mb-5">
            <div>
              <dt className="label-mono text-bone-faint">Distance</dt>
              <dd className="flex items-baseline gap-1.5">
                <span ref={kmRef} className="font-mono text-2xl md:text-3xl tabular text-bone">
                  0.0
                </span>
                <span className="label-mono text-bone-faint">/ {TOTAL_KM} KM</span>
              </dd>
            </div>
            <div>
              <dt className="label-mono text-bone-faint">Elevation</dt>
              <dd className="flex items-baseline gap-1.5">
                <span ref={elevRef} className="font-mono text-2xl md:text-3xl tabular text-bone">
                  412
                </span>
                <span className="label-mono text-bone-faint">M</span>
              </dd>
            </div>
            <div>
              <dt className="label-mono text-bone-faint">Grade</dt>
              <dd className="flex items-baseline gap-1.5">
                <span ref={gradeRef} className="font-mono text-2xl md:text-3xl tabular text-bone">
                  +0.0
                </span>
                <span className="label-mono text-bone-faint">%</span>
              </dd>
            </div>
          </dl>

          <div className="route-hud">
            <div className="rule" />
            <div
              ref={barRef}
              className="h-[2px] bg-signal origin-left scale-x-0 -mt-[1.5px]"
            />
            <div className="flex justify-between pt-2">
              <span className="label-mono text-bone-faint">Start</span>
              <span className="label-mono text-bone-faint hidden sm:inline">
                Import the race file. The plan climbs what you&apos;ll climb.
              </span>
              <span className="label-mono text-bone-faint">Finish</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
