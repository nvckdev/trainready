import type { MetadataRoute } from "next";

/**
 * Web-app manifest (PWA): makes Taper installable on iOS/Android home screens
 * and desktop, launching straight into the dashboard in standalone (chromeless)
 * mode. Colors mirror the app's field/ink theme so the splash and status bar
 * match the product.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Taper — Adaptive Endurance Training",
    short_name: "Taper",
    description:
      "An evidence-grounded training engine: your season planned from your race goal and real training history, re-planned as life happens.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#241f1a",
    theme_color: "#241f1a",
    categories: ["health", "fitness", "sports"],
    icons: [
      {
        src: "/taper-icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/taper-icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/apple-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
