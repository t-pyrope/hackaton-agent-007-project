import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: { "/api/tools/*": ["./sandbox-runtime/*"] },
  experimental: {
    agentFeedback: true,
  },
  // Explicit Node.js route runtime is incompatible with Cache Components.
  cacheComponents: false,
  partialPrefetching: false,
};

export default nextConfig;
