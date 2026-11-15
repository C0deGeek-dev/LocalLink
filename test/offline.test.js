import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { buildBundle } from '../scripts/bundle.js';
import { prepareOffline } from '../src/offline.js';

async function fixture(t) {
  const out = await mkdtemp(join(tmpdir(), 'locallink-offline-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  const manifest = await buildBundle({ root: fileURLToPath(new URL('../', import.meta.url)), out,
    revision: '0123456789abcdef0123456789abcdef01234567', dirty: false });
  const source = await readFile(join(out, 'push-worker.js'), 'utf8');
  const listeners = {}, stores = new Map(), fetched = [];
  let failPath, liveHTML;
  let skipped = 0, claimed = 0;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return { async put(url, response) { store.set(url, response); }, async match(url) { return store.get(url); } };
    },
    async keys() { return [...stores.keys()]; }, async delete(name) { return stores.delete(name); },
  };
  runInNewContext(source, {
    self: { location: { origin: 'https://pc.test' }, async skipWaiting() { skipped++; }, clients: { async claim() { claimed++; }, async matchAll() { return []; } }, addEventListener(type, fn) { listeners[type] = fn; } },
    URL, caches, fetch: async (url, options) => {
      if (typeof url !== 'string') {
        assert.equal(options.cache, 'no-store');
        if (!liveHTML) throw new Error('offline');
        return { ok: true, body: liveHTML, clone: () => ({ text: async () => liveHTML }), headers: { get: () => 'text/html' } };
      }
      fetched.push([url, options]);
      if (url === failPath) throw new Error('offline');
      return { ok: true, body: await readFile(join(out, url.slice(1)), 'utf8') };
    },
  });
  const lifecycle = async (type) => {
    let pending; listeners[type]({ waitUntil(promise) { pending = promise; } }); await pending;
  };
  function request(path, options = {}) {
    let result;
    listeners.fetch({ request: { url: new URL(path, 'https://pc.test').href, method: 'GET', mode: 'cors', destination: '', ...options }, respondWith(promise) { result = promise; } });
    return result;
  }
  return { manifest, source, stores, fetched, lifecycle, request, fail(path) { failPath = path; }, live(html) { liveHTML = html; }, skipped: () => skipped, claimed: () => claimed };
}

test('offline shell contains exact static generation; APIs and non-document fetches never intercepted', async (t) => {
  const f = await fixture(t); await f.lifecycle('install');
  assert.equal(f.fetched.length, f.manifest.files.length - 1);
  for (const [url, options] of f.fetched) {
    assert.ok(!url.startsWith('/api')); assert.notEqual(url, '/push-worker.js');
    assert.match(options.integrity, /^sha256-/); assert.equal(options.credentials, 'omit');
  }
  const response = await f.request('/', { mode: 'navigate', destination: 'document' });
  assert.match(response.body, /<!doctype html>/);
  const asset = f.manifest.files.find((file) => file.path.endsWith('/app.js'));
  assert.ok((await f.request(`/${asset.path}`, { destination: 'script' })).body);
  for (const path of ['/api/sessions', '/api/pair', '/api/workspaces', '/api/socket', '/api/push', '/pair', '/push-worker.js', '/bundle.json', '/', '/index.html', '/manifest.webmanifest?token=secret', 'https://other.test/']) {
    assert.equal(f.request(path), undefined, path);
  }
  assert.equal(f.request('/api/sessions', { mode: 'navigate', destination: 'document' }), undefined);
  assert.equal(f.request('/index.html', { method: 'POST', mode: 'navigate', destination: 'document' }), undefined);
  f.fail('/api/sessions'); // Fallthrough means the browser's own network error, never synthetic HTML.
  assert.equal(f.request('/api/sessions'), undefined);
});

test('failed install retains the previous generation; verified activation takes over and cleans only owned caches', async (t) => {
  const f = await fixture(t);
  f.stores.set('locallink-shell-previous', new Map([['/index.html', 'old shell']]));
  f.stores.set('another-app', new Map());
  f.fail('/index.html'); await assert.rejects(f.lifecycle('install'), /offline/);
  assert.equal(f.stores.get('locallink-shell-previous').get('/index.html'), 'old shell');
  f.fail(null); await f.lifecycle('install');
  assert.equal(f.stores.size, 3); // install never deletes the active generation
  await f.lifecycle('activate');
  assert.equal(f.stores.size, 2); assert.ok(f.stores.has('another-app'));
  assert.equal(f.skipped(), 1); assert.equal(f.claimed(), 1);
});

test('online navigation revalidates the installed generation; offline navigation uses the complete installed shell', async (t) => {
  const f = await fixture(t); await f.lifecycle('install');
  const generation = [...f.stores.keys()][0].replace('locallink-shell-', '');
  f.live(`<!doctype html><meta name="locallink-generation" content="${generation}"><title>Current network HTML</title>`);
  assert.match((await f.request('/', { mode: 'navigate', destination: 'document' })).body, /Current network HTML/);
  f.live(null);
  assert.match((await f.request('/', { mode: 'navigate', destination: 'document' })).body, /LocalLink/);
});

test('registration checks at startup, focus, reconnect and visibility; update handoff preserves drafts before reload', async () => {
  const messages = [], callbacks = {}, workerCallbacks = {};
  let checks = 0, saves = 0;
  const registration = { active: {}, waiting: null, installing: { addEventListener(type, fn) { callbacks[type] = fn; } },
    async update() { checks++; }, addEventListener(type, fn) { callbacks[type] = fn; } };
  const browser = { isSecureContext: true, document: { hidden: false, querySelector: () => ({ content: 'old' }), addEventListener(type, fn) { callbacks[type] = fn; } },
    addEventListener(type, fn) { callbacks[type] = fn; }, setInterval(fn, delay) { assert.equal(delay, 60000); callbacks.interval = fn; },
    navigator: { serviceWorker: { addEventListener(type, fn) { workerCallbacks[type] = fn; }, async register(url, options) {
      assert.equal(url, '/push-worker.js'); assert.equal(options.updateViaCache, 'none'); return registration;
    } } } };
  await prepareOffline(browser, (message) => messages.push(message), () => { saves++; return true; });
  assert.match(messages.at(-1), /available offline/);
  for (const name of ['focus', 'online', 'visibilitychange', 'interval']) { callbacks[name](); await Promise.resolve(); }
  assert.equal(checks, 5);
  let reply;
  workerCallbacks.message({ data: { type: 'shell-update', generation: 'new' }, ports: [{ postMessage(value) { reply = value; } }] });
  assert.equal(saves, 1); assert.deepEqual(reply, { generation: 'old', defer: false });
  assert.match(messages.at(-1), /Updating the app/);
  workerCallbacks.message({ data: { type: 'shell-update', generation: 'old' }, ports: [{ postMessage() {} }] });
  assert.equal(saves, 1, 'the already-current page never prepares a reload loop');
});
