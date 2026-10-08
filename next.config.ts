import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  // Explicit Node.js route runtime is incompatible with Cache Components.
  cacheComponents: false,
  partialPrefetching: false,
};

export default nextConfig;
