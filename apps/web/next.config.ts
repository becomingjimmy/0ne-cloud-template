import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@0ne/ui", "@0ne/db", "@0ne/auth"],
  headers: async () => [
    {
      source: "/sw.js",
      headers: [
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Service-Worker-Allowed", value: "/" },
      ],
    },
  ],
};

export default nextConfig;
