import Image from "next/image";
import { AnimateIn } from "@/components/AnimateIn";

const labels = [
  { text: "Swim Tracking", position: "top-[18%] left-[5%]" },
  { text: "Power Output", position: "top-[28%] right-[6%]" },
  { text: "Run Dynamics", position: "bottom-[22%] left-[7%]" },
  { text: "Race Strategy", position: "bottom-[14%] right-[5%]" },
];

export function BuiltForSection() {
  return (
    <section className="py-8 md:py-16 px-4 md:px-6" id="training">
      <AnimateIn>
        <div className="max-w-[1200px] mx-auto relative rounded-2xl md:rounded-3xl overflow-hidden h-[340px] md:h-[420px]">
          <Image
            src="https://images.unsplash.com/photo-1774050021466-369013ca33ef?w=1920&q=90&auto=format&fit=crop"
            alt="Cyclist and runner racing on city street"
            fill
            quality={90}
            className="object-cover object-center"
            sizes="(max-width: 1200px) 100vw, 1200px"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/30 to-black/20" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          <div className="absolute inset-0 bg-black/30" />

          <div className="absolute inset-0 flex items-center justify-center">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-white tracking-tight text-center drop-shadow-xl leading-tight px-6">
              Built for Every Athlete
            </h2>
          </div>

          {labels.map((label) => (
            <div
              key={label.text}
              className={`absolute ${label.position} text-xs text-white/80 border border-white/20 rounded-full px-3 py-1.5 backdrop-blur-md bg-white/5 hover:bg-white/10 hover:border-white/40 transition-all duration-200 cursor-default select-none hidden sm:block`}
            >
              {label.text}
            </div>
          ))}
        </div>
      </AnimateIn>
    </section>
  );
}
