// Builds the API into one CommonJS file, dist/app.cjs, that the tiny api/index.js entry loads.
// Our own TypeScript is bundled; npm packages stay external and are installed by Vercel.
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';

// Vercel expects the output folder named in vercel.json to exist, even though the API serves nothing static
mkdirSync('public', { recursive: true });

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
