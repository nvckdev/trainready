import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      // beforeFiles overrides page files: the static animated marketing
      // site (public/landing/) is served at the root; the previous React
      // landing page lives on at /classic.
      beforeFiles: [
        {
          source: "/",
          destination: "/landing/index.html",
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
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
