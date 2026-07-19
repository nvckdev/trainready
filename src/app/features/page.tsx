import type { Metadata } from "next";
import Link from "next/link";
import { NavBar } from "@/components/NavBar";
import { Footer } from "@/components/sections/Footer";

export const metadata: Metadata = {
  title: "Taper — What the engine does",
  description:
    "Six capabilities, each labeled with the strength of its evidence: intensity distribution, direct volume targets, base-rich ramp rates, tissue constraints, cross-training accounting, and an honesty layer our test suite enforces.",
};

/**
 * The features page: a field-manual spec sheet of the engine's capabilities.
 * Every prescriptive claim on this page carries its evidence tier, and the
 * engine's copy lint (engine/evidence.test.ts EV5) scans this file: if this
 * page ever overclaims causation, the build fails. The marketing is held to
 * the product's own honesty bar.
 */

// ——— evidence-tier chip ————————————————————————————————————————————
const TIER_STYLE: Record<string, string> = {
  observational: "text-bone-muted",
  "elite practice": "text-bone-muted",
  "our best guess": "text-bone-faint",
  "small trials": "text-bone-muted",
  measured: "text-signal-text",
};

function Tier({ label }: { label: string }) {
  return (
    <span className={`label-mono border border-hairline px-2 py-1 ${TIER_STYLE[label] ?? "text-bone-faint"}`}>
      evidence: {label}
    </span>
  );
}

// ——— drawn diagrams (bone lines, signal marks what lives) ———————————————

function DistributionDiagram() {
  return (
    <svg viewBox="0 0 320 120" className="w-full" aria-label="Weekly time split: about ninety percent easy, the remainder moderate and hard">
      <text x="0" y="14" className="fill-bone-faint" fontSize="9" fontFamily="var(--font-fragment)">TIME IN ZONE · ONE BASE WEEK</text>
      <rect x="0" y="30" width="288" height="22" fill="var(--bone)" opacity="0.9" />
      <rect x="290" y="30" width="16" height="22" fill="var(--bone)" opacity="0.45" />
      <rect x="308" y="30" width="12" height="22" fill="var(--signal)" />
      <text x="0" y="72" className="fill-bone-muted" fontSize="10" fontFamily="var(--font-fragment)">90% EASY</text>
      <text x="230" y="72" className="fill-bone-faint" fontSize="10" fontFamily="var(--font-fragment)">5% MOD · 5% HARD</text>
      <line x1="256" y1="20" x2="256" y2="58" stroke="var(--hairline)" strokeWidth="1" strokeDasharray="3 3" />
      <text x="180" y="95" className="fill-bone-faint" fontSize="9" fontFamily="var(--font-fragment)">80% FLOOR · NO WEEK BELOW</text>
    </svg>
  );
}

function VolumeDiagram() {
  return (
    <svg viewBox="0 0 320 120" className="w-full" aria-label="Volume floors: thirty-two kilometres weekly, twenty-one kilometre long run">
      <text x="0" y="14" className="fill-bone-faint" fontSize="9" fontFamily="var(--font-fragment)">DISTANCE FLOORS · HALF MARATHON</text>
      <line x1="0" y1="45" x2="320" y2="45" stroke="var(--hairline)" strokeWidth="1" />
      <line x1="0" y1="45" x2="235" y2="45" stroke="var(--bone)" strokeWidth="3" />
      <circle cx="235" cy="45" r="4" fill="var(--signal)" />
      <text x="0" y="66" className="fill-bone-muted" fontSize="10" fontFamily="var(--font-fragment)">WEEKLY ≥ 32 KM</text>
      <line x1="0" y1="88" x2="320" y2="88" stroke="var(--hairline)" strokeWidth="1" />
      <line x1="0" y1="88" x2="155" y2="88" stroke="var(--bone)" strokeWidth="3" />
      <circle cx="155" cy="88" r="4" fill="var(--signal)" />
      <text x="0" y="109" className="fill-bone-muted" fontSize="10" fontFamily="var(--font-fragment)">LONG RUN ≥ 21 KM</text>
    </svg>
  );
}

function RampDiagram() {
  return (
    <svg viewBox="0 0 320 120" className="w-full" aria-label="Two rebuild curves: a returning athlete climbs faster than a first-time athlete">
      <text x="0" y="14" className="fill-bone-faint" fontSize="9" fontFamily="var(--font-fragment)">SAFE RAMP · SAME START, DIFFERENT HISTORY</text>
      <polyline points="10,100 90,88 170,68 250,42 310,26" fill="none" stroke="var(--signal)" strokeWidth="2.5" />
      <polyline points="10,100 90,94 170,84 250,72 310,62" fill="none" stroke="var(--bone)" strokeWidth="1.5" opacity="0.55" />
      <text x="196" y="34" className="fill-bone-muted" fontSize="10" fontFamily="var(--font-fragment)">RETURNING · +27%/WK</text>
      <text x="226" y="80" className="fill-bone-faint" fontSize="10" fontFamily="var(--font-fragment)">FIRST BUILD · +12%</text>
    </svg>
  );
}

function TissueDiagram() {
  return (
    <svg viewBox="0 0 320 120" className="w-full" aria-label="A long-run cap bracket at twenty-four kilometres, with a written reason">
      <text x="0" y="14" className="fill-bone-faint" fontSize="9" fontFamily="var(--font-fragment)">LONG-RUN CAP · ONLY WHEN A CONSTRAINT IS ON FILE</text>
      <line x1="0" y1="55" x2="320" y2="55" stroke="var(--hairline)" strokeWidth="1" />
      <line x1="0" y1="55" x2="205" y2="55" stroke="var(--bone)" strokeWidth="3" />
      <path d="M 205 40 L 205 70 M 198 40 L 212 40 M 198 70 L 212 70" stroke="var(--signal)" strokeWidth="2" fill="none" />
      <text x="220" y="50" className="fill-bone-muted" fontSize="10" fontFamily="var(--font-fragment)">≤ 24 KM</text>
      <text x="0" y="95" className="fill-bone-faint" fontSize="9" fontFamily="var(--font-fragment)">WHY: CALF TENDON, ROTATION-PROVOKED · HEALTHY = NO CAP, EVER</text>
    </svg>
  );
}

function CrossTrainDiagram() {
  return (
    <svg viewBox="0 0 320 120" className="w-full" aria-label="Two fitness lines: total aerobic load holds while running-specific load stays capped">
      <text x="0" y="14" className="fill-bone-faint" fontSize="9" fontFamily="var(--font-fragment)">TWO LEDGERS · NEVER CONFLATED</text>
      <polyline points="10,95 90,78 170,60 250,46 310,38" fill="none" stroke="var(--bone)" strokeWidth="1.5" />
      <polyline points="10,95 90,86 170,78 250,74 310,72" fill="none" stroke="var(--signal)" strokeWidth="2.5" />
      <text x="216" y="30" className="fill-bone-muted" fontSize="10" fontFamily="var(--font-fragment)">TOTAL AEROBIC</text>
      <text x="226" y="94" className="fill-bone-muted" fontSize="10" fontFamily="var(--font-fragment)">RUNNING ONLY</text>
    </svg>
  );
}

function EvidenceDiagram() {
  const rows = [
    { label: "RANDOMISED TRIALS (SMALL)", w: 90 },
    { label: "OBSERVATIONAL", w: 170 },
    { label: "ELITE PRACTICE", w: 130 },
    { label: "OUR BEST GUESS", w: 200 },
  ];
  return (
    <svg viewBox="0 0 320 120" className="w-full" aria-label="Four evidence tiers, from small randomised trials to stated best guesses">
      <text x="0" y="14" className="fill-bone-faint" fontSize="9" fontFamily="var(--font-fragment)">EVERY CLAIM CARRIES ITS TIER</text>
      {rows.map((r, i) => (
        <g key={r.label}>
          <rect x="0" y={26 + i * 24} width={r.w} height="10" fill="var(--bone)" opacity={0.85 - i * 0.18} />
          <text x={r.w + 8} y={34 + i * 24} className="fill-bone-faint" fontSize="9" fontFamily="var(--font-fragment)">
            {r.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ——— the six plates ————————————————————————————————————————————————

const PLATES = [
  {
    n: "01",
    name: "Intensity distribution, held",
    tier: "elite practice",
    diagram: <DistributionDiagram />,
    body: "A weekly load number is blind: 150 TSS could be a disciplined aerobic week or a fatigue spiral. Taper models every session into time below, between, and above your thresholds, and composes base weeks near the 88 to 92 percent easy band that shows up in elite training logs. A hard floor is pinned by our test suite: no generated week falls below 80 percent easy.",
  },
  {
    n: "02",
    name: "Kilometres first, load second",
    tier: "observational",
    diagram: <VolumeDiagram />,
    body: "In the largest half-marathon cohort study we know of, runners over 32 km a week with a long run past 21 km ran faster, with no measured rise in injury risk. Those are associations, not guarantees, and we say so. Taper turns them into direct targets: your plan builds toward the distance floors, and the load math follows the kilometres instead of the other way round.",
  },
  {
    n: "03",
    name: "Your history sets your ramp",
    tier: "observational",
    diagram: <RampDiagram />,
    body: "A returning athlete and a first-timer at the same current fitness are not the same athlete. Detraining studies find that a trained past leaves durable capacity, and rebuilding goes faster than building. Taper reads years of your logged history, scores how much base you can reclaim, and sets your safe weekly ramp between +10 and +30 percent accordingly.",
  },
  {
    n: "04",
    name: "Injury caps that cite their reason",
    tier: "our best guess",
    diagram: <TissueDiagram />,
    body: "Declare a constraint, or let the pain tracker infer one, and Taper caps only the lever that provokes it: a rotation-aggravated calf tendon caps the long run, not your week; a speed-sensitive achilles caps intensity, not distance. Every cap prints its reason in plain language. Healthy athletes are never capped as a precaution, because the volume evidence gives us no reason to.",
  },
  {
    n: "05",
    name: "Cross-training that keeps two ledgers",
    tier: "our best guess",
    diagram: <CrossTrainDiagram />,
    body: "When a constraint caps your running, Taper converts easy days into bike or pool work so total aerobic load holds while impact drops. Then it refuses to lie about the result: running fitness and total fitness are tracked as separate lines, and your race projection reads from the running line. An engine built on the bike does not promise you a half-marathon time.",
  },
  {
    n: "06",
    name: "An honesty layer with teeth",
    tier: "measured",
    diagram: <EvidenceDiagram />,
    body: "Every prescriptive claim in the product carries an internal confidence tier: small randomised trials, observational cohorts, elite practice, or our stated best guess. A lint in the test suite scans every user-facing file, this page included, and fails the build on causal overclaims. Where the evidence is thin, the copy says we think, because that is the truth.",
  },
];

// ——— category contrasts ————————————————————————————————————————————

const CONTRASTS = [
  {
    them: "Static PDF-style plans, or black-box adjustments you can't interrogate.",
    us: "Every week re-derived from what you actually did, with the why printed on every session.",
  },
  {
    them: "A blanket volume haircut the moment you mention a niggle.",
    us: "Structured constraints that cap only what the tissue provokes, and print their reason.",
  },
  {
    them: "Goal times accepted at face value; the plan quietly assumes a miracle.",
    us: "A goal check that names the gap and projects the honest finish, load-limited.",
  },
  {
    them: "Cross-training minutes silently inflate one fitness score.",
    us: "Running fitness and total fitness kept as two lines that never merge.",
  },
  {
    them: "Marketing that dresses every feature in a borrowed lab coat.",
    us: "A copy lint our own tests run: overclaim causation and the build fails.",
  },
];

// ——— the index (everything else) ————————————————————————————————————

const INDEX: Array<[string, string]> = [
  ["Race-day pack", "negative-split pacing plus a timed fuelling script, from your projected fitness"],
  ["Adaptive re-plan", "one tap re-flows every remaining week from your actual training"],
  ["Goal check", "required fitness vs. reachable fitness, stated before you commit"],
  ["Backtest gate", "engine changes must hold pinned error metrics on years of real data before they ship"],
  ["Strava import", "your history becomes the corpus the engine learns your patterns from"],
  ["Pain tracker", "three simple rules surface flare-ups and can ease upcoming quality sessions"],
  ["Strength protocols", "injury-prevention work scheduled around your quality days, deloads included"],
  ["Weekly digest", "a plain-language readout of what happened and what this week is for"],
  ["Calendar feed", "every session in your calendar app via one subscription URL"],
  ["Installable app", "the dashboard installs to your phone's home screen and runs full-screen"],
];

export default function FeaturesPage() {
  return (
    <>
      <NavBar />
      <main className="pt-14">
        {/* ——— hero ——— */}
        <section className="px-5 md:px-8 max-w-[1100px] mx-auto pt-[clamp(4rem,10vh,7rem)] pb-[clamp(3rem,8vh,6rem)]">
          <p className="label-mono text-bone-faint">Field manual · the engine, itemised</p>
          <h1 className="display-engraved text-[clamp(2.6rem,7vw,5.5rem)] leading-[0.95] mt-4 max-w-[16ch]">
            An engine that shows its work.
          </h1>
          <p className="mt-6 text-[17px] leading-relaxed text-bone-muted max-w-[62ch]">
            Taper plans your season from your race goal and your real training history, then
            re-plans it as life happens. Six capabilities below, each labeled with the strength
            of the evidence behind it. That label is not decoration: our test suite reads this
            page and fails the build if the copy claims more than the evidence holds.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link
              href="/#start"
              className="label-mono bg-signal text-field px-5 py-3 hover:bg-bone transition-colors duration-150"
            >
              Join the beta
            </Link>
            <Link
              href="/app"
              className="label-mono border border-hairline text-bone px-5 py-3 hover:border-bone transition-colors duration-150"
            >
              Open the dashboard
            </Link>
          </div>
        </section>

        <div className="rule max-w-[1100px] mx-5 md:mx-8 xl:mx-auto" />

        {/* ——— the six plates ——— */}
        <section className="px-5 md:px-8 max-w-[1100px] mx-auto py-[clamp(3rem,8vh,6rem)] space-y-[clamp(3.5rem,9vh,6.5rem)]">
          {PLATES.map((p, i) => (
            <article
              key={p.n}
              className={`grid gap-8 md:gap-14 md:grid-cols-[1fr_1fr] items-start ${i % 2 === 1 ? "md:[&>*:first-child]:order-2" : ""}`}
            >
              <div>
                <div className="flex items-baseline gap-4">
                  <span className="label-mono text-signal-text">{p.n}</span>
                  <h2 className="display-engraved text-[clamp(1.4rem,3vw,2rem)]">{p.name}</h2>
                </div>
                <p className="mt-4 text-[15px] leading-relaxed text-bone-muted max-w-[58ch]">{p.body}</p>
                <div className="mt-5">
                  <Tier label={p.tier} />
                </div>
              </div>
              <div className="border border-hairline bg-field-raised p-5 md:mt-2">{p.diagram}</div>
            </article>
          ))}
        </section>

        {/* ——— the honesty fold: the goal check ——— */}
        <section className="bg-field-sunken border-y border-hairline">
          <div className="px-5 md:px-8 max-w-[1100px] mx-auto py-[clamp(3.5rem,9vh,6.5rem)] grid gap-10 md:grid-cols-[1.1fr_1fr] items-center">
            <div>
              <h2 className="display-engraved text-[clamp(1.8rem,4vw,2.8rem)] max-w-[18ch]">
                The only coach that will tell you no.
              </h2>
              <p className="mt-5 text-[15px] leading-relaxed text-bone-muted max-w-[56ch]">
                Type an ambitious goal into most platforms and they will happily schedule the
                fantasy. Taper computes the fitness your goal implies, the fitness your runway
                and your body can actually reach, and names the gap before you train a single
                week. The projection is a load-limited bound, anchored to races you have
                actually run: sharp legs can beat it; the plan never assumes they will.
              </p>
            </div>
            <div className="border border-hairline bg-field p-5">
              <p className="label-mono text-bone-muted">Goal check · sample</p>
              <p className="mt-3 text-[15px] leading-relaxed text-bone">
                1:24:00 implies race-day fitness around 50; a safe climb from ~16 reaches ~21
                → realistic finish <span className="text-signal-text">~1:29</span>{" "}
                <span className="text-bone-faint">(load-limited)</span>.
              </p>
              <p className="mt-3 text-[13px] leading-relaxed text-bone-faint">
                Treat 1:29 as the honest target for this race and 1:24 as a multi-season goal.
                The rails are never loosened to close the gap.
              </p>
            </div>
          </div>
        </section>

        {/* ——— receipts: the backtest gate ——— */}
        <section className="px-5 md:px-8 max-w-[1100px] mx-auto py-[clamp(3.5rem,9vh,6.5rem)]">
          <div className="grid gap-10 md:grid-cols-[1fr_1.2fr] items-start">
            <div>
              <h2 className="display-engraved text-[clamp(1.8rem,4vw,2.8rem)] max-w-[14ch]">
                Changes ship through a gate.
              </h2>
              <p className="mt-5 text-[15px] leading-relaxed text-bone-muted max-w-[52ch]">
                The engine is replayed against years of real training history on every change.
                Its prediction error is pinned; if a feature moves the pins, it does not merge.
                The rails below are hard limits in code, not guidelines.
              </p>
            </div>
            <dl className="border border-hairline divide-y divide-[var(--hairline)]">
              {[
                ["Weekly ramp ceiling", "+10 to +30% per week, set by your training history"],
                ["Form floor", "planned fatigue never drives form below −25"],
                ["Taper protocol", "the final weeks are physiology, not preference: never compressed"],
                ["Backtest pins", "prediction error on the historical replay must hold on every change"],
                ["Honesty lint", "user-facing copy is scanned for causal overclaims on every build"],
              ].map(([k, v]) => (
                <div key={k} className="grid grid-cols-[minmax(120px,180px)_1fr] gap-4 px-4 py-3">
                  <dt className="label-mono text-bone-faint">{k}</dt>
                  <dd className="text-[13px] leading-relaxed text-bone-muted">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ——— category contrast ——— */}
        <section className="bg-field-sunken border-y border-hairline">
          <div className="px-5 md:px-8 max-w-[1100px] mx-auto py-[clamp(3.5rem,9vh,6.5rem)]">
            <h2 className="display-engraved text-[clamp(1.8rem,4vw,2.8rem)]">Where the category cuts corners.</h2>
            <div className="mt-8 space-y-0 border border-hairline divide-y divide-[var(--hairline)]">
              {CONTRASTS.map((c) => (
                <div key={c.us} className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[var(--hairline)]">
                  <p className="px-5 py-4 text-[13px] leading-relaxed text-bone-faint">{c.them}</p>
                  <p className="px-5 py-4 text-[13px] leading-relaxed text-bone">{c.us}</p>
                </div>
              ))}
            </div>
            <p className="label-mono text-bone-faint mt-3">Left: common category behavior · right: Taper</p>
          </div>
        </section>

        {/* ——— the index ——— */}
        <section className="px-5 md:px-8 max-w-[1100px] mx-auto py-[clamp(3.5rem,9vh,6.5rem)]">
          <h2 className="display-engraved text-[clamp(1.8rem,4vw,2.8rem)]">Also in the manual.</h2>
          <div className="mt-8 grid md:grid-cols-2 gap-x-14">
            {INDEX.map(([k, v]) => (
              <div key={k} className="flex gap-4 py-3 border-b border-hairline">
                <span className="label-mono text-bone shrink-0 w-40">{k}</span>
                <span className="text-[13px] leading-relaxed text-bone-faint">{v}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ——— final CTA: the taper mark ——— */}
        <section className="px-5 md:px-8 max-w-[1100px] mx-auto pb-[clamp(4rem,10vh,7rem)]">
          <svg viewBox="0 0 640 40" className="w-full max-w-[640px]" aria-hidden="true">
            <polygon points="0,14 600,18 600,22 0,26" fill="var(--bone)" opacity="0.85" />
            <circle cx="622" cy="20" r="7" fill="var(--signal)" />
          </svg>
          <h2 className="display-engraved text-[clamp(2rem,5vw,3.6rem)] mt-8 max-w-[14ch]">Trust the taper.</h2>
          <p className="mt-4 text-[15px] leading-relaxed text-bone-muted max-w-[52ch]">
            The season narrows to a single morning. Bring a plan that has been honest with you
            the whole way there.
          </p>
          <div className="mt-8">
            <Link
              href="/#start"
              className="label-mono bg-signal text-field px-5 py-3 hover:bg-bone transition-colors duration-150"
            >
              Join the beta
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
