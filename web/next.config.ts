import type { NextConfig } from 'next';

const config: NextConfig = {
  // Allow Next.js to read files from the parent dir (data/ at the repo root)
  // when serving via server components.
  outputFileTracingRoot: require('path').join(__dirname, '..'),
  // typedRoutes adds friction when adding new routes (requires regenerated .next/types)
  // and the dashboard has a small static route set — easier to grep references.
  typedRoutes: false,
};

export default config;
