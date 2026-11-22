import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // the Node API lives in ./backend and has its own package.json
  turbopack: { root: __dirname },
  // lets a test build run beside a running dev server (NEXT_DIST_DIR=.next-build)
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default nextConfig;
