import { cp, readFile, rm } from 'node:fs/promises';
import { build } from 'esbuild';

const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
// Third-party packages stay in node_modules; the workspace's shared TypeScript is bundled in.
const external = Object.keys(pkg.dependencies).filter((name) => !name.startsWith('@parley/'));

await rm('dist', { recursive: true, force: true });
await build({
  // Both entry points sit at the dist root so `migrations/` resolves next to them.
  entryPoints: { server: 'src/server.ts', migrate: 'src/db/migrate-cli.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external,
  sourcemap: false,
  logLevel: 'info',
});
await cp('src/db/migrations', 'dist/migrations', { recursive: true });
