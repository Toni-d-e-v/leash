import type { NextConfig } from "next";
import { resolve } from "node:path";

const nextConfig: NextConfig = {
  devIndicators: false,
  turbopack: { root: resolve(__dirname) },
  outputFileTracingRoot: resolve(__dirname),
};

export default nextConfig;
