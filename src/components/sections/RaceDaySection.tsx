"use client";

import { useEffect, useRef, useState } from "react";
import { gsap, SplitText, useGSAP } from "@/lib/gsap";

function useStopwatch(running: boolean) {
  const [text, setText] = useState("00:00:00.0");
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!running) return;
    if (startRef.current === null) startRef.current = performance.now();
    let raf: number;
    let last = "";
    const tick = (now: number) => {
      const ms = now - (startRef.current ?? now);
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      const d = Math.floor((ms % 1000) / 100);
      const pad = (n: number) => String(n).padStart(2, "0");
      const t = `${pad(h)}:${pad(m)}:${pad(s)}.${d}`;
      if (t !== last) {
        last = t;
        setText(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  return text;
}

export function RaceDaySection() {
  const root = useRef<HTMLElement>(null);
  const [running, setRunning] = useState(false);

  const time = useStopwatch(running);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        // The recording strip: the orange field opens from a hairline
        gsap.from(".race-field", {
          scaleY: 0.012,
          transformOrigin: "center top",
          duration: 1.1,
          ease: "power4.inOut",
          scrollTrigger: { trigger: root.current, start: "top 78%" },
        });
        gsap.from(".race-inner", {
          opacity: 0,
          duration: 0.7,
          delay: 0.75,
          scrollTrigger: { trigger: root.current, start: "top 78%" },
        });

        SplitText.create(".race-title", {
          type: "words,chars",
          mask: "chars",
          autoSplit: true,
          onSplit: (self) =>
            gsap.from(self.chars, {
              yPercent: 108,
              duration: 0.9,
              ease: "expo.out",
              stagger: 0.03,
              scrollTrigger: { trigger: root.current, start: "top 60%" },
            }),
        });

        // The gun: stopwatch starts when the section is in view
        gsap.timeline({
          scrollTrigger: {
            trigger: root.current,
            start: "top 55%",
            onEnter: () => setRunning(true),
          },
        });
      });

      mm.add("(prefers-reduced-motion: reduce)", () => {
        // Static: the field is open, the watch face shows zero
      });
    },
    { scope: root }
  );

  return (
    <section ref={root} id="start" className="relative px-5 md:px-8 py-[clamp(5rem,12vh,9rem)]">
      <div className="race-field bg-signal">
        <div className="race-inner px-6 md:px-14 py-16 md:py-24">
          <div className="flex items-baseline justify-between">
            <p className="label-mono text-ink">fig. 06 · The gun</p>
            <p className="label-mono text-ink/70 hidden md:block">Final sheet</p>
          </div>

          <h2 className="race-title display-engraved text-ink mt-6 text-[clamp(3.4rem,11vw,10rem)]">
            Race day
          </h2>

          <div
            className="font-mono tabular text-paper text-[clamp(2rem,6.5vw,5.5rem)] mt-4 leading-none"
            aria-label="Race stopwatch running"
          >
            {time}
          </div>

          <div className="mt-10 md:mt-14 md:flex items-end justify-between gap-10">
            <p className="max-w-[40ch] text-ink text-[15px] md:text-base leading-relaxed">
              Months of meters, calibrated into one number that says go. The
              instrument is ready. The only measurement left is yours.
            </p>
            <a
              href="#instrument"
              className="label-mono inline-block mt-8 md:mt-0 bg-ink text-paper px-8 py-4 hover:bg-paper hover:text-ink transition-colors duration-150 shrink-0"
            >
              Start recording
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
