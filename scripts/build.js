import { execFileSync } from 'node:child_process';
import { mkdtemp, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBundle, verifyBundle } from './bundle.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--release')) throw new Error('Usage: node scripts/build.js [--release]');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const revision = git('rev-parse', 'HEAD');
const dirty = git('status', '--porcelain', '--untracked-files=all').length > 0;
if (args.includes('--release') && dirty) throw new Error('Release builds require a clean checkout; commit source changes first');
const out = await mkdtemp(join(root, '.bundle-'));
try {
  await buildBundle({ root, out, revision, dirty });
  const { digest } = await verifyBundle(out);
  // Both targets are fixed direct children of this repository, never user paths.
  await rm(join(root, 'dist'), { recursive: true, force: true });
  await rename(out, join(root, 'dist'));
  console.log(`LocalLink ${revision}${dirty ? ' (development, dirty source)' : ''}\nbundle.json sha256 ${digest}`);
} finally {
  await rm(out, { recursive: true, force: true });
}
