import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { protocol } from '../src/compatibility.js';

export const contentTypes = Object.freeze({
  html: 'text/html; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  webmanifest: 'application/manifest+json',
  png: 'image/png',
  svg: 'image/svg+xml',
});
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

export async function listFiles(root, prefix = '') {
  const paths = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) paths.push(...await listFiles(root, path));
    else if (entry.isFile()) paths.push(path);
    else throw new Error(`Only regular files are allowed: ${path}`);
  }
  return paths.sort();
}

export async function buildBundle({ root, out, revision, dirty }) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Expected a full Git source revision');
  const version = (await readFile(join(root, 'VERSION'), 'utf8')).trim();
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (pkg.version !== version) throw new Error('VERSION and package.json disagree');
  const sources = new Map();
  for (const path of await listFiles(join(root, 'src'))) {
    const extension = path.split('.').at(-1);
    if (!contentTypes[extension]) throw new Error(`Unsupported source type: ${path}`);
    const bytes = await readFile(join(root, 'src', path));
    sources.set(path, extension === 'png' ? bytes : Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n')));
  }
  // The digest names a complete asset generation; it never depends on timestamps.
  const digest = sha256(json([...sources].map(([path, bytes]) => [path, sha256(bytes)])));
  const payload = new Map();
  for (const [path, bytes] of sources) {
    if (path === 'index.html' || path === 'manifest.webmanifest' || path === 'push-worker.js') {
      payload.set(path, Buffer.from(bytes.toString('utf8').replaceAll('__ASSET_DIGEST__', digest)));
    } else payload.set(`assets/${digest}/${path}`, bytes);
  }
  // The worker does not cache itself. Its exact-byte list pins one full shell.
  const shell = [...payload].filter(([path]) => path !== 'push-worker.js').map(([path, bytes]) => ({
    url: `/${path}`, integrity: `sha256-${createHash('sha256').update(bytes).digest('base64')}`,
  }));
  payload.set('push-worker.js', Buffer.from(payload.get('push-worker.js').toString('utf8')
    .replace('__SHELL_GENERATION__', digest).replace('/* __SHELL_FILES__ */ []', JSON.stringify(shell))));
  const files = [...payload].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, bytes]) => ({
    path, sha256: sha256(bytes), bytes: bytes.length, content_type: contentTypes[path.split('.').at(-1)],
  }));
  const manifest = {
    schema_version: 1, version, source_revision: revision, source_dirty: dirty,
    client_status: 'sessions',
    protocol,
    files,
  };
  // Caller supplies a fresh directory, so stale assets cannot enter the bundle.
  await mkdir(out, { recursive: true });
  if ((await readdir(out)).length) throw new Error('Bundle output directory must be empty');
  for (const [path, bytes] of payload) {
    const parent = path.slice(0, path.lastIndexOf('/'));
    if (path.includes('/')) await mkdir(join(out, parent), { recursive: true });
    await writeFile(join(out, path), bytes);
  }
  await writeFile(join(out, 'bundle.json'), json(manifest));
  return manifest;
}

export async function verifyBundle(root) {
  const raw = await readFile(join(root, 'bundle.json'));
  const manifest = JSON.parse(raw);
  if (manifest.schema_version !== 1 || !/^[a-f0-9]{40}$/.test(manifest.source_revision)) throw new Error('Invalid bundle identity');
  if (typeof manifest.source_dirty !== 'boolean') throw new Error('Missing source cleanliness');
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error('Empty bundle');
  const paths = [];
  for (const file of manifest.files) {
    if (!/^[a-zA-Z0-9_-]+(?:[/.][a-zA-Z0-9_-]+)*$/.test(file.path) || file.path === 'bundle.json') throw new Error('Unsafe bundle path');
    if (paths.includes(file.path)) throw new Error('Duplicate bundle path');
    paths.push(file.path);
    const expectedType = contentTypes[file.path.split('.').at(-1)];
    if (!expectedType || file.content_type !== expectedType) throw new Error('Unsupported content type');
    if (!/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0) throw new Error('Invalid file metadata');
  }
  const actual = await listFiles(root);
  if (JSON.stringify(actual) !== JSON.stringify([...paths, 'bundle.json'].sort())) throw new Error('Bundle file set differs from manifest');
  if (JSON.stringify(paths) !== JSON.stringify([...paths].sort())) throw new Error('Bundle paths must be sorted');
  for (const file of manifest.files) {
    const bytes = await readFile(join(root, file.path));
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error(`Integrity mismatch: ${file.path}`);
  }
  return { manifest, digest: sha256(raw) };
}
