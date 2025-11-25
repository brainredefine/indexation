// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true, // ⛔️ Désactive ESLint pour Vercel/Next build
  },
};

export default nextConfig;
