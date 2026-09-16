import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  turbopack: {
    resolveAlias: {
      fs: {
        browser: "./empty.ts",
      },
      path: {
        browser: "./empty.ts",
      },
      crypto: {
        browser: "./empty.ts",
      },
    },
  },
};

export default nextConfig;
