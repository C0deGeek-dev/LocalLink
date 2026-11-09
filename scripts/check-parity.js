import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { verifyBundle } from './bundle.js';

const root = process.argv[2];
if (!root) throw new Error('Usage: node scripts/check-parity.js <artifacts-directory>');
const entries = await readdir(root, { withFileTypes: true });
assert.equal(entries.length, 3, 'Expected bundles from all three operating systems');
let expected;
for (const entry of entries) {
  assert.ok(entry.isDirectory());
  const { digest, manifest } = await verifyBundle(join(root, entry.name));
  assert.equal(manifest.source_dirty, false, 'CI artifacts must have clean provenance');
  expected ??= digest;
  assert.equal(digest, expected, 'Cross-platform bundle bytes differ');
}
console.log(`Three platforms produced the same bundle: ${expected}`);
