"use client";

const rowsAbove: { tags: string[]; opacity: string }[] = [
  {
    tags: ["Open Water", "FTP", "Strides", "Aero", "Tempo", "Kudos", "Trail"],
    opacity: "opacity-20",
  },
  {
    tags: ["Power Zones", "Leaderboard", "Heart Rate", "Vo2 Max", "Log Fuel", "Cadence"],
    opacity: "opacity-35",
  },
  {
    tags: ["Paceboard", "Elevation", "Cadence", "Brick Session", "Interval", "Breadcrumbs"],
    opacity: "opacity-50",
  },
];

const rowsBelow: { tags: string[]; opacity: string }[] = [
  {
    tags: ["Long Ride", "Threshold Run", "Duration", "Easy Swim", "Peaking", "Race Day"],
    opacity: "opacity-50",
  },
  {
    tags: ["Recovery Spin", "Goal Progress", "Weekly Volume", "Avg Pace", "Watts", "Stride"],
    opacity: "opacity-35",
  },
  {
    tags: ["Pool", "Tempo", "Splits", "Trail", "Kudos", "T1/T2 Splits", "Pace Coach"],
    opacity: "opacity-20",
  },
];

function TagRow({ tags, opacity }: { tags: string[]; opacity: string }) {
  return (
    <div className={`flex gap-3 justify-center flex-wrap ${opacity}`}>
      {tags.map((tag) => (
        <span
          key={tag}
          className="border border-white/15 rounded-full px-5 py-2 text-sm text-white/70 whitespace-nowrap select-none"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

export function TagCloud() {
  return (
    <section className="py-24 md:py-32 flex flex-col items-center overflow-hidden relative px-6">
      {/* Top fade */}
      <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-[#0A0505] to-transparent z-10 pointer-events-none" />
      {/* Bottom fade */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#0A0505] to-transparent z-10 pointer-events-none" />

      <div className="flex flex-col gap-4 w-full max-w-[900px]">
        {rowsAbove.map((row, i) => (
          <TagRow key={i} {...row} />
        ))}
      </div>

      {/* CTA */}
      <div className="flex justify-center items-center py-10 relative z-20">
        <button className="bg-gradient-to-r from-[#FF2D55] to-pink-500 rounded-full px-12 py-5 text-xl font-extrabold text-white tracking-tight shadow-[0_0_60px_rgba(255,45,85,0.5)] hover:shadow-[0_0_90px_rgba(255,45,85,0.7)] hover:scale-105 active:scale-95 transition-all duration-200">
          Own The Race
        </button>
      </div>

      <div className="flex flex-col gap-4 w-full max-w-[900px]">
        {rowsBelow.map((row, i) => (
          <TagRow key={i} {...row} />
        ))}
      </div>
    </section>
  );
}
