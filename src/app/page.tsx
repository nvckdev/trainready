import { NavBar } from "@/components/NavBar";
import { SmoothScroll } from "@/components/SmoothScroll";
import { Hero } from "@/components/sections/Hero";
import { ProtocolSection } from "@/components/sections/ProtocolSection";
import { TerrainSection } from "@/components/sections/TerrainSection";
import { InstrumentSection } from "@/components/sections/InstrumentSection";
import { DisciplinesSection } from "@/components/sections/DisciplinesSection";
import { SyncSection } from "@/components/sections/SyncSection";
import { RaceDaySection } from "@/components/sections/RaceDaySection";
import { Footer } from "@/components/sections/Footer";

export default function Home() {
  return (
    <SmoothScroll>
      <NavBar />
      <main>
        <Hero />
        <ProtocolSection />
        <TerrainSection />
        <InstrumentSection />
        <DisciplinesSection />
        <SyncSection />
        <RaceDaySection />
      </main>
      <Footer />
    </SmoothScroll>
  );
}
