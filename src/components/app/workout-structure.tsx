import type { Block, WorkoutStructure, Zone } from "../../../engine/types.ts";

/**
 * Visual workout renderer. Pure presentation, driven ENTIRELY by the
 * normalized WorkoutStructure the engine emits (engine/plan.ts) — it never
 * parses the human-readable `structure` string. A threshold session and an
 * easy run look instantly different because every block is color-coded by its
 * intensity zone.
 *
 * Two variants:
 *  - `full`    — Today's next-session detail: a proportional timeline, a
 *                per-block breakdown (warmup/cooldown BARS, main REP GROUPS
 *                with pace pills + recovery, strides as MARKERS, progression
 *                runs as adjacent shaded SEGMENTS), and computed totals.
 *  - `compact` — Plan calendar day cards: just the slim proportional timeline
 *                plus a one-line duration · TSS micro-total.
 *
 * Every block field is optional (docs/workout-structure.md §2.1); the renderer
 * degrades gracefully when one is missing and falls back cleanly for sessions
 * that carry no `workout` at all (the caller renders the `structure` string).
 *
 * Colors: the documented ember/bone INTENSITY-ZONE ramp below — a separate,
 * accessible scale, NOT the fixed chart SERIES slots (taper-rules rule 14) and
 * never reused as body-text color (rule 15; identity comes from a swatch).
 */

/* ————————————————————————————————————————————————————————————————
 * Zone → color: the intensity ramp (coldest → hottest)
 *
 * A temperature ramp on the dark `--field` surface (oklch L≈0.17): the cool /
 * faint bone end reads as "easy", warming through gold/amber into the ember
 * `--signal` family at the hot end. Chroma rises and hue sweeps blue→orange
 * monotonically toward intensity, so the zones separate on BOTH lightness and
 * the protan/deutan-safe blue↔orange axis — and every block also carries a
 * text label, so color is never the only channel (accessible by construction).
 *
 * Mapping to the design language (docs/workout-structure.md §5):
 *   recovery  faintest, cool desaturated   easy   cool / faint bone
 *   tempo     signal-dim (gold)            threshold  signal-dim (amber)
 *   cv        signal (ember)               vo2    signal-bright (bright ember)
 *   race      full/hot ember
 * These are OKLCH values distinct from the SERIES hexes; they live only here
 * and mean intensity, never CTL/ATL/TSB/other.
 * ———————————————————————————————————————————————————————————————— */
export const ZONE_COLOR: Record<Zone, string> = {
  recovery: "oklch(0.55 0.018 250)", // faintest — cool, desaturated
  easy: "oklch(0.70 0.038 232)", // cool / faint bone-blue
  tempo: "oklch(0.70 0.100 80)", // warm gold — signal-dim
  threshold: "oklch(0.66 0.150 55)", // amber — signal-dim
  cv: "oklch(0.66 0.185 45)", // ember — signal
  vo2: "oklch(0.74 0.190 42)", // bright ember — signal-bright
  race: "oklch(0.62 0.220 30)", // deep hot ember — full signal
};

export const ZONE_LABEL: Record<Zone, string> = {
  recovery: "recovery",
  easy: "easy",
  tempo: "tempo",
  threshold: "threshold",
  cv: "CV",
  vo2: "VO2",
  race: "race",
};

/* Physiological intensity factor per zone (fraction of threshold). Squared,
 * it drives the structure-derived TSS estimate. These are standard endurance
 * values; the derived TSS is an ESTIMATE (like pipeline plannedTssEst, rule
 * 10) and is expected to sit within tolerance of the engine's stored tss. */
const ZONE_IF: Record<Zone, number> = {
  recovery: 0.55,
  easy: 0.68,
  tempo: 0.85,
  threshold: 0.96,
  cv: 0.99,
  vo2: 1.06,
  race: 0.93,
};

const HARD_ZONES: ReadonlySet<Zone> = new Set<Zone>(["tempo", "threshold", "cv", "vo2", "race"]);

/* ————————————————————————————————————————————————————————————————
 * Totals derived from the structure
 * ———————————————————————————————————————————————————————————————— */

export interface StructureTotals {
  /** Total wall-clock time in seconds: work + between-rep recovery, summed
   *  over every block. Null when NO block carries a duration (a purely
   *  distance-defined session that gives no time signal). */
  durationSec: number | null;
  /** Total distance in metres, or null when it can't be derived from the
   *  structure (e.g. a bike block with watts but neither pace nor distance). */
  distanceM: number | null;
  /** Seconds spent in a non-easy zone (work portion of tempo/threshold/CV/
   *  VO2/race blocks) — the "time at intensity". */
  timeAtIntensitySec: number;
  /** Estimated Training Stress Score from Σ block-time · zoneIF² · 100. */
  tss: number;
  /** True when any distance contribution was inferred from pace × time rather
   *  than an explicit distanceM (renderer labels it "≈"). */
  distanceEstimated: boolean;
}

/** Repeat count for a block (absent/1 = a single continuous effort). */
function repsOf(b: Block): number {
  return b.reps && b.reps > 0 ? b.reps : 1;
}

/** Average of the pace window (sec/km), or null when the block carries no pace. */
function avgPaceSecPerKm(b: Block): number | null {
  const lo = b.paceMinSecPerKm;
  const hi = b.paceMaxSecPerKm;
  if (lo != null && hi != null) return (lo + hi) / 2;
  if (lo != null) return lo;
  if (hi != null) return hi;
  return null;
}

/**
 * Fold a WorkoutStructure into totals. Every field is treated as optional:
 * a block with no size contributes nothing to time/distance, a block with no
 * recovery adds no recovery time, etc. Pure — safe to call anywhere.
 */
export function computeTotals(workout: WorkoutStructure | undefined | null): StructureTotals {
  let workSec = 0;
  let recSec = 0;
  let timeAtIntensitySec = 0;
  let distanceM = 0;
  let sawDistance = false;
  let sawDuration = false;
  let distanceEstimated = false;
  let distanceUnknown = false; // a sized block whose distance we cannot derive
  let tss = 0;

  for (const b of workout?.blocks ?? []) {
    const reps = repsOf(b);
    const perDur = b.durationSec ?? 0;
    const blockWork = perDur * reps;
    const blockRec = (b.recoverySec ?? 0) * Math.max(0, reps - 1);

    if (perDur > 0) {
      sawDuration = true;
      workSec += blockWork;
      recSec += blockRec;
      if (HARD_ZONES.has(b.zone)) timeAtIntensitySec += blockWork;
      // Load: work at the block's zone IF, recovery as easy jogging/spinning.
      tss += (blockWork / 3600) * ZONE_IF[b.zone] ** 2 * 100;
      tss += (blockRec / 3600) * ZONE_IF.easy ** 2 * 100;
    }

    // Distance: explicit metres win; otherwise infer from pace × time (runs).
    if (b.distanceM != null) {
      sawDistance = true;
      distanceM += b.distanceM * reps;
    } else if (perDur > 0) {
      const pace = avgPaceSecPerKm(b);
      if (pace != null && pace > 0) {
        sawDistance = true;
        distanceEstimated = true;
        distanceM += (blockWork / pace) * 1000;
      } else {
        distanceUnknown = true; // sized, but no way to measure distance (bike watts)
      }
    }
  }

  return {
    durationSec: sawDuration ? Math.round(workSec + recSec) : null,
    distanceM: sawDistance && !distanceUnknown ? Math.round(distanceM) : null,
    timeAtIntensitySec: Math.round(timeAtIntensitySec),
    tss: Math.round(tss),
    distanceEstimated,
  };
}

/* ————————————————————————————————————————————————————————————————
 * Formatting helpers
 * ———————————————————————————————————————————————————————————————— */

function fmtDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  const totalMin = Math.round(sec / 60);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

function fmtDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)} km` : `${Math.round(m)} m`;
}

function fmtPace(secPerKm: number): string {
  const mm = Math.floor(secPerKm / 60);
  const ss = Math.round(secPerKm % 60);
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

/** The size label for a single rep / continuous block (time or distance). */
function sizeLabel(b: Block): string | null {
  if (b.distanceM != null) return `${b.distanceM}m`;
  if (b.durationSec != null) return fmtDuration(b.durationSec);
  return null;
}

function paceLabel(b: Block): string | null {
  const lo = b.paceMinSecPerKm;
  const hi = b.paceMaxSecPerKm;
  if (lo != null && hi != null) return lo === hi ? `${fmtPace(lo)}/km` : `${fmtPace(lo)}–${fmtPace(hi)}/km`;
  if (lo != null) return `${fmtPace(lo)}/km`;
  return null;
}

/* ————————————————————————————————————————————————————————————————
 * Proportional timeline — the shared at-a-glance visual
 *
 * Each block expands into work / recovery sub-segments so recovery reads
 * between the reps; segment width is proportional to time (or, for a purely
 * distance-defined session, to distance). This is what makes intensity legible
 * at a glance in both variants.
 * ———————————————————————————————————————————————————————————————— */

interface Seg {
  zone: Zone;
  weight: number; // time (s) or distance (m) — whichever the session uses
  label: string;
}

function timelineSegments(blocks: Block[]): { segs: Seg[]; byTime: boolean } {
  const byTime = blocks.some((b) => (b.durationSec ?? 0) > 0);
  const segs: Seg[] = [];
  for (const b of blocks) {
    const reps = repsOf(b);
    const recZone: Zone = b.recoveryNote?.toLowerCase().includes("rest") ? "recovery" : "easy";
    const size = sizeLabel(b) ?? "";
    const zLabel = ZONE_LABEL[b.zone];
    for (let i = 0; i < reps; i++) {
      const weight = byTime ? b.durationSec ?? 0 : b.distanceM ?? 0;
      if (weight > 0) segs.push({ zone: b.zone, weight, label: `${zLabel} ${size}`.trim() });
      const isLast = i === reps - 1;
      if (!isLast) {
        const recWeight = byTime ? b.recoverySec ?? 0 : 0;
        if (recWeight > 0) segs.push({ zone: recZone, weight: recWeight, label: `recovery ${fmtDuration(b.recoverySec ?? 0)}` });
      }
    }
  }
  return { segs, byTime };
}

function Timeline({ blocks, height = 10 }: { blocks: Block[]; height?: number }) {
  const { segs } = timelineSegments(blocks);
  const total = segs.reduce((s, x) => s + x.weight, 0);
  if (total <= 0) return null;
  return (
    <div
      className="flex w-full overflow-hidden rounded-[2px]"
      style={{ height }}
      role="img"
      aria-label={`Intensity timeline: ${segs.map((s) => s.label).join(", ")}`}
    >
      {segs.map((s, i) => (
        <div
          key={i}
          title={s.label}
          style={{
            width: `${(s.weight / total) * 100}%`,
            background: ZONE_COLOR[s.zone],
            minWidth: 2,
          }}
        />
      ))}
    </div>
  );
}

/* ————————————————————————————————————————————————————————————————
 * Per-block detail (full variant)
 * ———————————————————————————————————————————————————————————————— */

function Swatch({ zone }: { zone: Zone }) {
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-[2px] shrink-0"
      style={{ background: ZONE_COLOR[zone] }}
      aria-hidden="true"
    />
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[11px] tabular text-bone-muted border border-hairline rounded-full px-2 py-0.5 whitespace-nowrap">
      {children}
    </span>
  );
}

const KIND_LABEL: Record<Block["kind"], string> = {
  warmup: "Warmup",
  cooldown: "Cooldown",
  main: "Main",
  strides: "Strides",
  recovery: "Recovery",
  segment: "Segment",
};

function BlockRow({ block }: { block: Block }) {
  const reps = repsOf(block);
  const size = sizeLabel(block);
  const pace = paceLabel(block);
  const isRepGroup = reps > 1;
  const isStrides = block.kind === "strides";

  return (
    <li className="flex items-start gap-3 py-2.5 border-t border-hairline first:border-t-0">
      <span className="mt-1">
        <Swatch zone={block.zone} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="label-mono text-bone-faint">{KIND_LABEL[block.kind]}</span>
          <span className="label-mono text-bone-faint">·</span>
          <span className="label-mono" style={{ color: "var(--bone-muted)" }}>
            {ZONE_LABEL[block.zone]}
          </span>

          {/* Rep group: N × size, or strides as small markers */}
          {isStrides ? (
            <span className="flex items-center gap-1.5">
              <span className="font-mono text-[13px] tabular text-bone">{reps} ×</span>
              <span className="flex items-center gap-0.5" aria-hidden="true">
                {Array.from({ length: Math.min(reps, 8) }, (_, i) => (
                  <span key={i} className="inline-block w-0.5 h-3 rounded-full" style={{ background: ZONE_COLOR[block.zone] }} />
                ))}
              </span>
              {size && <span className="font-mono text-[13px] tabular text-bone-muted">{size}</span>}
            </span>
          ) : (
            <span className="font-mono text-[13px] tabular text-bone">
              {isRepGroup && <span>{reps} × </span>}
              {size ?? "—"}
            </span>
          )}

          {pace && <Pill>{pace}</Pill>}
        </div>

        {/* Recovery between reps + any effort cue */}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 mt-1">
          {isRepGroup && block.recoverySec != null && (
            <span className="label-mono text-bone-faint">
              {fmtDuration(block.recoverySec)} {block.recoveryNote ?? "recovery"} between
            </span>
          )}
          {block.effortNote && <span className="text-[12px] leading-relaxed text-bone-faint">{block.effortNote}</span>}
        </div>
      </div>
    </li>
  );
}

/* ————————————————————————————————————————————————————————————————
 * Totals row
 * ———————————————————————————————————————————————————————————————— */

function Total({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="border-l border-hairline pl-4 first:border-l-0 first:pl-0">
      <div className="label-mono text-bone-faint">{label}</div>
      <div className="flex items-baseline gap-1 mt-0.5">
        <span className="font-mono text-lg tabular text-bone">{value}</span>
        {unit && <span className="label-mono text-bone-faint">{unit}</span>}
      </div>
    </div>
  );
}

/* ————————————————————————————————————————————————————————————————
 * Public component
 * ———————————————————————————————————————————————————————————————— */

export function WorkoutStructureView({
  workout,
  variant = "full",
  stored,
  className = "",
}: {
  workout: WorkoutStructure;
  variant?: "full" | "compact";
  /** Authoritative engine totals. When present the headline TSS / duration
   *  show these (the card's numbers); the structure-derived values still power
   *  distance and time-at-intensity. Absent → everything is derived. */
  stored?: { tss?: number; durationHr?: number };
  className?: string;
}) {
  const blocks = workout?.blocks ?? [];
  if (blocks.length === 0) return null;
  const totals = computeTotals(workout);

  const durationSec =
    stored?.durationHr != null ? Math.round(stored.durationHr * 3600) : totals.durationSec;
  const tss = stored?.tss ?? totals.tss;

  if (variant === "compact") {
    return (
      <div className={className}>
        <Timeline blocks={blocks} height={8} />
        <div className="mt-1.5 flex items-center gap-2 label-mono text-bone-faint">
          {durationSec != null && <span>{fmtDuration(durationSec)}</span>}
          {durationSec != null && <span>·</span>}
          <span>{tss} TSS</span>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <Timeline blocks={blocks} height={12} />

      <ul className="mt-4">
        {blocks.map((b, i) => (
          <BlockRow key={i} block={b} />
        ))}
      </ul>

      <div className="mt-4 pt-4 border-t border-hairline flex flex-wrap gap-x-6 gap-y-3">
        {totals.distanceM != null && (
          <Total
            label="Distance"
            value={`${totals.distanceEstimated ? "≈" : ""}${fmtDistance(totals.distanceM)}`}
          />
        )}
        {durationSec != null && <Total label="Duration" value={fmtDuration(durationSec)} />}
        <Total label="At intensity" value={fmtDuration(totals.timeAtIntensitySec)} />
        <Total label="Load" value={String(tss)} unit="TSS" />
      </div>
    </div>
  );
}
