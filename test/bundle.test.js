import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buildBundle, listFiles, sha256, verifyBundle } from '../scripts/bundle.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const revision = '0123456789abcdef0123456789abcdef01234567';
async function fixture(t) {
  const temp = await mkdtemp(join(tmpdir(), 'locallink-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const out = join(temp, 'dist');
  await buildBundle({ root, out, revision, dirty: false });
  return { temp, out };
}

test('independent builds match every byte despite source mtimes and CRLF checkouts', async (t) => {
  const { temp, out } = await fixture(t);
  const copy = join(temp, 'checkout');
  await cp(join(root, 'src'), join(copy, 'src'), { recursive: true });
  for (const path of ['VERSION', 'package.json']) await cp(join(root, path), join(copy, path));
  for (const path of await listFiles(join(copy, 'src'))) {
    const target = join(copy, 'src', path);
    if (!path.endsWith('.png')) await writeFile(target, (await readFile(target, 'utf8')).replace(/\r?\n/g, '\r\n'));
    await utimes(target, 1000000000, 1000000000);
  }
  const rebuilt = join(temp, 'rebuilt');
  await buildBundle({ root: copy, out: rebuilt, revision, dirty: false });
  assert.deepEqual(await listFiles(out), await listFiles(rebuilt));
  for (const path of await listFiles(out)) assert.deepEqual(await readFile(join(out, path)), await readFile(join(rebuilt, path)), path);
});

test('manifest hashes exactly the complete tree, with portable paths and local references', async (t) => {
  const { out } = await fixture(t);
  const { manifest, digest } = await verifyBundle(out);
  assert.equal(digest, sha256(await readFile(join(out, 'bundle.json'))));
  assert.equal(manifest.source_revision, revision);
  assert.equal(manifest.source_dirty, false);
  assert.equal(manifest.client_status, 'sessions');
  const html = await readFile(join(out, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /__ASSET_DIGEST__|https?:\/\/|\son\w+=|<script(?![^>]*src=)/);
  const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  for (const url of urls.filter((url) => !url.startsWith('#'))) {
    assert.ok(url.startsWith('/'), url);
    assert.ok(manifest.files.some((file) => file.path === url.slice(1)), url);
  }
  const webmanifest = JSON.parse(await readFile(join(out, 'manifest.webmanifest'), 'utf8'));
  assert.equal(webmanifest.scope, '/');
  assert.equal(webmanifest.start_url, '/');
  for (const icon of webmanifest.icons) {
    assert.ok(manifest.files.some((file) => file.path === icon.src.slice(1)));
    const bytes = await readFile(join(out, icon.src.slice(1)));
    assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes);
  }
});

test('verification refuses modified, missing and injected files', async (t) => {
  const { out } = await fixture(t);
  const original = await readFile(join(out, 'index.html'));
  await writeFile(join(out, 'index.html'), 'tampered');
  await assert.rejects(verifyBundle(out), /Integrity mismatch/);
  await writeFile(join(out, 'index.html'), original);
  await writeFile(join(out, 'extra.js'), 'unlisted');
  await assert.rejects(verifyBundle(out), /file set differs/);
  await rm(join(out, 'extra.js'));
  await rm(join(out, 'index.html'));
  await assert.rejects(verifyBundle(out), /file set differs/);
});

test('verification rejects unsafe paths, duplicate entries and MIME substitution', async (t) => {
  const { out } = await fixture(t);
  const file = join(out, 'bundle.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  for (const path of ['../outside.js', '/absolute.js', 'assets\\file.js', 'bundle.json']) {
    const bad = structuredClone(manifest);
    bad.files[0].path = path;
    await writeFile(file, JSON.stringify(bad));
    await assert.rejects(verifyBundle(out), /Unsafe bundle path/);
  }
  const duplicate = structuredClone(manifest);
  duplicate.files.push(duplicate.files[0]);
  await writeFile(file, JSON.stringify(duplicate));
  await assert.rejects(verifyBundle(out), /Duplicate/);
  manifest.files[0].content_type = 'application/octet-stream';
  await writeFile(file, JSON.stringify(manifest));
  await assert.rejects(verifyBundle(out), /content type/);
});

test('build refuses stale output and invalid provenance', async (t) => {
  const { out, temp } = await fixture(t);
  await assert.rejects(buildBundle({ root, out, revision, dirty: true }), /must be empty/);
  await assert.rejects(buildBundle({ root, out: join(temp, 'bad'), revision: 'main', dirty: false }), /full Git/);
});
