import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Integration logos served from third-party CDNs (marquee strip)
      {
        protocol: "https",
        hostname: "cdn.mcmillanrunning.com",
      },
      {
        protocol: "https",
        hostname: "wpassets.trainingpeaks.com",
      },
    ],
  },
};

export default nextConfig;
