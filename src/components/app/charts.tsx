import type { PmcRow, WeeklyRow } from "@/lib/athlete-data";

/**
 * Server-rendered SVG charts. Palette validated (dataviz six checks, dark
 * surface): slot order orange → blue → gold → rose, assigned by entity and
 * never cycled. Text wears text tokens; native <title> supplies the hover
 * layer for this server-rendered v1.
 */

export const SERIES = {
  ctl: "#e05f2b", // slot 1 — also run
  atl: "#6f86c9", // slot 2 — also bike
  tsb: "#a8862a", // slot 3 — also swim
  other: "#b04a72", // slot 4
};

const W = 720;
const H = 240;
const PAD = { l: 40, r: 64, t: 12, b: 24 };

function xScale(n: number) {
  return (i: number) => PAD.l + (i / Math.max(1, n - 1)) * (W - PAD.l - PAD.r);
}

function path(points: Array<[number, number]>): string {
  return points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
}

export function PmcChart({ rows }: { rows: PmcRow[] }) {
  // Weekly sampling keeps the path light without changing the story.
  const sampled = rows.filter((_, i) => i % 7 === 0 || i === rows.length - 1);
  const n = sampled.length;
  const x = xScale(n);
  const maxY = Math.max(...sampled.map((r) => Math.max(r.ctl, r.atl)), 10) * 1.1;
  const minY = Math.min(...sampled.map((r) => r.tsb), 0) * 1.15;
  const y = (v: number) => PAD.t + ((maxY - v) / (maxY - minY)) * (H - PAD.t - PAD.b);

  const line = (key: "ctl" | "atl" | "tsb") =>
    path(sampled.map((r, i) => [x(i), y(r[key])]));

  const years: Array<{ i: number; label: string }> = [];
  sampled.forEach((r, i) => {
    const label = r.date.slice(0, 4);
    if (!years.length || years[years.length - 1].label !== label) years.push({ i, label });
  });

  const last = sampled[n - 1];
  const gridVals = [0, Math.round(maxY / 2 / 10) * 10, Math.round(maxY / 10) * 10];

  return (
    <figure>
      <div className="flex items-center gap-5 mb-2">
        {(
          [
            ["Fitness · CTL", SERIES.ctl],
            ["Fatigue · ATL", SERIES.atl],
            ["Form · TSB", SERIES.tsb],
          ] as const
        ).map(([label, c]) => (
          <span key={label} className="flex items-center gap-2 label-mono text-bone-muted">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />
            {label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Fitness, fatigue, and form over the full training history">
        {gridVals.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--hairline)" strokeWidth={v === 0 ? 1.25 : 0.75} />
            <text x={PAD.l - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="var(--bone-faint)" fontFamily="var(--font-fragment)">
              {v}
            </text>
          </g>
        ))}
        {years.map(({ i, label }) => (
          <text key={label} x={x(i)} y={H - 6} fontSize="10" fill="var(--bone-faint)" fontFamily="var(--font-fragment)">
            {label}
          </text>
        ))}
        <path d={line("tsb")} fill="none" stroke={SERIES.tsb} strokeWidth="2">
          <title>Form (TSB): yesterday&apos;s fitness minus fatigue</title>
        </path>
        <path d={line("atl")} fill="none" stroke={SERIES.atl} strokeWidth="2">
          <title>Fatigue (ATL): 7-day weighted load</title>
        </path>
        <path d={line("ctl")} fill="none" stroke={SERIES.ctl} strokeWidth="2.25">
          <title>Fitness (CTL): 42-day weighted load</title>
        </path>
        {(
          [
            ["CTL", last.ctl, SERIES.ctl],
            ["ATL", last.atl, SERIES.atl],
            ["TSB", last.tsb, SERIES.tsb],
          ] as const
        ).map(([label, v, c]) => (
          <g key={label}>
            <circle cx={x(n - 1)} cy={y(v)} r="3" fill={c} stroke="var(--field)" strokeWidth="1.5" />
            <text x={x(n - 1) + 8} y={y(v) + 3} fontSize="10" fill="var(--bone-muted)" fontFamily="var(--font-fragment)">
              {label} {Math.round(v)}
            </text>
          </g>
        ))}
      </svg>
      <details className="mt-2">
        <summary className="label-mono text-bone-faint cursor-pointer">Table view</summary>
        <div className="max-h-56 overflow-y-auto mt-2">
          <table className="w-full text-left">
            <thead>
              <tr>{["Date", "TSS", "CTL", "ATL", "TSB"].map((h) => <th key={h} className="label-mono text-bone-faint py-1">{h}</th>)}</tr>
            </thead>
            <tbody className="font-mono text-xs text-bone-muted tabular">
              {sampled.slice(-26).reverse().map((r) => (
                <tr key={r.date} className="border-t border-hairline">
                  <td className="py-1">{r.date}</td><td>{Math.round(r.tss)}</td><td>{r.ctl.toFixed(1)}</td><td>{r.atl.toFixed(1)}</td><td>{r.tsb.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** One week of the pain-vs-load comparison: engine-side weekly TSS (null =
 *  week beyond the derived corpus) against athlete-reported pain 7d average
 *  (null = no entries that week — never coerced to zero). */
export interface PainLoadRow {
  weekStart: string;
  tss: number | null;
  pain: number | null;
}

/**
 * Pain trend (7-day average per week, 0–10 NRS) against weekly training
 * load. Colors reuse the validated slots (taper-rules 14): TSS bars wear
 * slot 1 (the load/CTL color), the pain line wears slot 4 ("other") — no
 * new hex, identity from the swatch labels, text in text tokens.
 */
export function PainVsLoadChart({ rows }: { rows: PainLoadRow[] }) {
  const n = Math.max(1, rows.length);
  const maxTss = Math.max(...rows.map((r) => r.tss ?? 0), 10) * 1.05;
  const innerW = W - PAD.l - PAD.r;
  const step = innerW / n;
  const barW = Math.max(4, step * 0.55);
  const yTss = (v: number) => PAD.t + ((maxTss - v) / maxTss) * (H - PAD.t - PAD.b);
  const yPain = (v: number) => PAD.t + ((10 - v) / 10) * (H - PAD.t - PAD.b);
  const cx = (i: number) => PAD.l + i * step + step / 2;

  const painPts = rows
    .map((r, i) => (r.pain === null ? null : ([cx(i), yPain(r.pain), r.pain] as const)))
    .filter((p): p is readonly [number, number, number] => p !== null);

  return (
    <figure>
      <div className="flex items-center gap-5 mb-2">
        <span className="flex items-center gap-2 label-mono text-bone-muted">
          <span className="w-2.5 h-2.5" style={{ background: SERIES.ctl }} />
          weekly TSS
        </span>
        <span className="flex items-center gap-2 label-mono text-bone-muted">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: SERIES.other }} />
          pain · 7d avg (0–10, athlete-reported)
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Weekly pain average against weekly training load">
        {[0.5, 1].map((f) => (
          <line key={f} x1={PAD.l} x2={W - PAD.r} y1={yTss(maxTss * f)} y2={yTss(maxTss * f)} stroke="var(--hairline)" strokeWidth="0.75" />
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={yTss(0)} y2={yTss(0)} stroke="var(--hairline)" strokeWidth="1.25" />
        <text x={PAD.l - 6} y={yTss(maxTss) + 3} textAnchor="end" fontSize="10" fill="var(--bone-faint)" fontFamily="var(--font-fragment)">
          {Math.round(maxTss)}
        </text>
        <text x={PAD.l - 6} y={yTss(0) + 3} textAnchor="end" fontSize="10" fill="var(--bone-faint)" fontFamily="var(--font-fragment)">
          0
        </text>
        {[0, 5, 10].map((v) => (
          <text key={v} x={W - PAD.r + 8} y={yPain(v) + 3} fontSize="10" fill="var(--bone-faint)" fontFamily="var(--font-fragment)">
            {v}
          </text>
        ))}
        {rows.map((r, i) =>
          r.tss !== null && r.tss > 1 ? (
            <rect
              key={r.weekStart}
              x={cx(i) - barW / 2}
              y={yTss(r.tss)}
              width={barW}
              height={Math.max(1, yTss(0) - yTss(r.tss))}
              fill={SERIES.ctl}
              rx="1"
            >
              <title>{`wk ${r.weekStart}: ${Math.round(r.tss)} TSS${r.pain !== null ? ` · pain ${r.pain.toFixed(1)}/10` : ""}`}</title>
            </rect>
          ) : null
        )}
        {painPts.length > 1 && (
          <path d={path(painPts.map(([x, y]) => [x, y]))} fill="none" stroke={SERIES.other} strokeWidth="2" />
        )}
        {painPts.map(([x, y, v], i) => (
          <circle key={i} cx={x} cy={y} r="3" fill={SERIES.other} stroke="var(--field)" strokeWidth="1.5">
            <title>{`pain ${v.toFixed(1)}/10 · 7d avg`}</title>
          </circle>
        ))}
        {[0, Math.floor((n - 1) / 2), n - 1]
          .filter((i, idx, arr) => arr.indexOf(i) === idx)
          .map((i) =>
            rows[i] ? (
              <text key={i} x={cx(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--bone-faint)" fontFamily="var(--font-fragment)">
                {rows[i].weekStart.slice(5)}
              </text>
            ) : null
          )}
      </svg>
    </figure>
  );
}

export function WeeklyVolumeChart({ rows }: { rows: WeeklyRow[] }) {
  const recent = rows.slice(-52);
  const n = recent.length;
  const maxY = Math.max(...recent.map((r) => r.tss), 10) * 1.05;
  const innerW = W - PAD.l - PAD.r + 40;
  const step = innerW / n;
  const barW = Math.max(3, step - 2);
  const y = (v: number) => PAD.t + ((maxY - v) / maxY) * (H - PAD.t - PAD.b);

  const order = [
    ["run", SERIES.ctl],
    ["bike", SERIES.atl],
    ["swim", SERIES.tsb],
    ["other", SERIES.other],
  ] as const;

  return (
    <figure>
      <div className="flex items-center gap-5 mb-2">
        {order.map(([k, c]) => (
          <span key={k} className="flex items-center gap-2 label-mono text-bone-muted">
            <span className="w-2.5 h-2.5" style={{ background: c }} />
            {k}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Weekly training load by discipline, last 52 weeks">
        {[0.5, 1].map((f) => (
          <line key={f} x1={PAD.l} x2={W - PAD.r + 40} y1={y(maxY * f)} y2={y(maxY * f)} stroke="var(--hairline)" strokeWidth="0.75" />
        ))}
        <text x={PAD.l - 6} y={y(maxY) + 3} textAnchor="end" fontSize="10" fill="var(--bone-faint)" fontFamily="var(--font-fragment)">{Math.round(maxY)}</text>
        <line x1={PAD.l} x2={W - PAD.r + 40} y1={y(0)} y2={y(0)} stroke="var(--hairline)" strokeWidth="1.25" />
        {recent.map((r, i) => {
          let acc = 0;
          return (
            <g key={r.weekStart}>
              <title>{`wk ${r.weekStart}: ${Math.round(r.tss)} TSS (run ${Math.round(r.run)}, bike ${Math.round(r.bike)}, swim ${Math.round(r.swim)})`}</title>
              {order.map(([k, c]) => {
                const v = r[k as "run" | "bike" | "swim" | "other"];
                if (v <= 1) return null;
                const y1 = y(acc + v);
                const h = y(acc) - y1;
                acc += v;
                return (
                  <rect key={k} x={PAD.l + i * step} y={y1} width={barW} height={Math.max(1, h - 1.5)} fill={c} rx="1" />
                );
              })}
            </g>
          );
        })}
        {[0, Math.floor(n / 2), n - 1].map((i) =>
          recent[i] ? (
            <text key={i} x={PAD.l + i * step} y={H - 6} fontSize="10" fill="var(--bone-faint)" fontFamily="var(--font-fragment)">
              {recent[i].weekStart.slice(2, 7)}
            </text>
          ) : null
        )}
      </svg>
    </figure>
  );
}
