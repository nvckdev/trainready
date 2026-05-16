import { NavBar } from "@/components/NavBar";
import { HeroSection } from "@/components/sections/HeroSection";
import { AppShowcase } from "@/components/sections/AppShowcase";
import { FeaturesGrid } from "@/components/sections/FeaturesGrid";
import { BuiltForSection } from "@/components/sections/BuiltForSection";
import { CrewSection } from "@/components/sections/CrewSection";
import { WatchSection } from "@/components/sections/WatchSection";
import { TagCloud } from "@/components/sections/TagCloud";
import { Footer } from "@/components/sections/Footer";

export default function Home() {
  return (
    <div className="bg-[#0A0505] text-white overflow-x-hidden">
      <NavBar />
      <main>
        <HeroSection />
        <AppShowcase />
        <FeaturesGrid />
        <BuiltForSection />
        <CrewSection />
        <WatchSection />
        <TagCloud />
      </main>
      <Footer />
    </div>
  );
}
