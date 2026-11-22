// Builds the API into one CommonJS file, dist/app.cjs, that the tiny api/index.js entry loads.
// Our own TypeScript is bundled; npm packages stay external and are installed by Vercel.
import { mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

// Vercel expects the output folder named in vercel.json to exist, even though the API serves nothing static
mkdirSync('public', { recursive: true });
writeFileSync('public/robots.txt', ['User-agent: *', 'Disallow: /', ''].join('\n'));

await build({
  entryPoints: ['src/vercel.ts'],
  outfile: 'dist/app.cjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
});
