import type { NextConfig } from 'next';

const config: NextConfig = {
  // Allow Next.js to read files from the parent dir (data/ at the repo root)
  // when serving via server components.
  outputFileTracingRoot: require('path').join(__dirname, '..'),
  typedRoutes: true,
};

export default config;
