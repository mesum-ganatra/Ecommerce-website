import type { NextConfig } from 'next';

// When the API lives on another address (e.g. two *.vercel.app projects), the browser talks to this app
// at /api/v1 and we forward it. That keeps the sign-in cookie on one site, which browsers require.
const API_PROXY_TARGET = (process.env.API_PROXY_TARGET ?? '').replace(/\/$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // the Node API lives in ./backend and has its own package.json
  turbopack: { root: __dirname },
  // lets a test build run beside a running dev server (NEXT_DIST_DIR=.next-build)
  distDir: process.env.NEXT_DIST_DIR || '.next',
  async rewrites() {
    return API_PROXY_TARGET ? [{ source: '/api/v1/:path*', destination: `${API_PROXY_TARGET}/api/v1/:path*` }] : [];
  },
};

export default nextConfig;
