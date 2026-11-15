// Real service-worker lifecycle over loopback. No user gateway or credentials.
/* global document, navigator, caches, Event, dispatchEvent */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildBundle } from './bundle.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'locallink-update-browser-'));
const channel = process.argv.find((arg) => arg.startsWith('--channel='))?.split('=')[1];
let browser, server;
try {
  async function build(version, legacy = false) {
    const checkout = join(temp, `source-${version}`), out = join(temp, `dist-${version}`);
    await cp(join(root, 'src'), join(checkout, 'src'), { recursive: true });
    const pkg = JSON.parse(await readFile(join(root, 'package.json'))); pkg.version = version;
    await writeFile(join(checkout, 'package.json'), JSON.stringify(pkg)); await writeFile(join(checkout, 'VERSION'), `${version}\n`);
    if (legacy) await writeFile(join(checkout, 'src/offline.js'), `export async function prepareOffline(browser, changed) {
      await browser.navigator.serviceWorker.register('/push-worker.js', { scope: '/', updateViaCache: 'none' }); changed('Legacy cached shell');
    }`);
    const manifest = await buildBundle({ root: checkout, out, revision: '0123456789abcdef0123456789abcdef01234567', dirty: false });
    const files = new Map(await Promise.all(manifest.files.map(async (file) => [`/${file.path}`, { ...file, body: await readFile(join(out, file.path)) }])));
    if (legacy) {
      // Previous policy: cache-first and wait for every old tab to close.
      const urls = manifest.files.filter((file) => file.path !== 'push-worker.js').map((file) => `/${file.path}`);
      files.get('/push-worker.js').body = Buffer.from(`
        self.addEventListener('install', e => e.waitUntil(caches.open('locallink-shell-legacy').then(c => c.addAll(${JSON.stringify(urls)}))));
        self.addEventListener('fetch', e => {
          const u = new URL(e.request.url);
          if (e.request.method !== 'GET' || u.origin !== self.location.origin || u.pathname === '/push-worker.js' || u.pathname.startsWith('/api/')) return;
          e.respondWith(caches.open('locallink-shell-legacy').then(async c => (await c.match(u.pathname === '/' ? '/index.html' : u.pathname)) || fetch(e.request)));
        });`);
    }
    files.set('/', files.get('/index.html'));
    return { version, files, generation: /name="locallink-generation" content="([a-f0-9]+)"/.exec(files.get('/').body.toString())[1] };
  }
  const legacy = await build('0.1.0', true), current = await build('0.1.1'), future = await build('0.1.2'), incomplete = await build('0.1.3');
  let active = legacy, offline = false, missing = '';
  server = createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    if (offline || path === missing) { response.writeHead(503).end('Fixture offline'); return; }
    const file = active.files.get(path);
    if (!file) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': file.content_type, 'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' }).end(file.body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
  const context = await browser.newContext();
  const a = await context.newPage(), b = await context.newPage();
  a.setDefaultTimeout(20000); b.setDefaultTimeout(20000);
  const errors = []; a.on('pageerror', (error) => errors.push(error.message)); b.on('pageerror', (error) => errors.push(error.message));
  const waitVersion = (page, version) => page.waitForFunction((wanted) => document.querySelector('meta[name="application-version"]').content === wanted, version);
  const update = (page) => page.evaluate(() => { void navigator.serviceWorker.getRegistration().then((registration) => registration.update()).catch(() => {}); });
  await a.goto(origin); await a.evaluate(async () => { await navigator.serviceWorker.ready; }); await a.reload();
  await b.goto(origin);
  await a.waitForFunction(() => !!navigator.serviceWorker.controller);
  await waitVersion(a, '0.1.0'); await waitVersion(b, '0.1.0');
  // The legacy app cannot acknowledge the update. New activation must still
  // replace it, without requiring either of its open windows to close.
  active = current; await update(a);
  await waitVersion(a, '0.1.1'); await waitVersion(b, '0.1.1');
  assert.deepEqual(await a.evaluate(() => caches.keys()), [`locallink-shell-${current.generation}`]);
  // A version-only bump, discovered on focus, refreshes both tabs automatically.
  active = future;
  await a.evaluate(() => dispatchEvent(new Event('focus')));
  await waitVersion(a, '0.1.2'); await waitVersion(b, '0.1.2');
  for (const page of [a, b]) {
    const assets = await page.locator('link[rel="stylesheet"], script[type="module"]').evaluateAll((nodes) => nodes.map((node) => node.href || node.src));
    assert.equal(assets.every((url) => url.includes(future.generation)), true, 'CSS and JS belong to the new generation');
  }
  // Reopening offline still gets the last complete app, including its assets.
  offline = true; await a.reload(); await waitVersion(a, '0.1.2'); offline = false;
  // A partially downloadable build must not replace the working shell or serve
  // its unverified HTML on navigation.
  active = incomplete; missing = [...incomplete.files.keys()].find((path) => path.endsWith('/style.css'));
  await a.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration.update().catch(() => {});
    const installing = registration.installing;
    if (installing && installing.state !== 'redundant') await new Promise((resolve) => installing.addEventListener('statechange', () => { if (installing.state === 'redundant') resolve(); }));
  });
  await a.reload(); await waitVersion(a, '0.1.2');
  assert.deepEqual(await a.evaluate(() => caches.keys()), [`locallink-shell-${future.generation}`]);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', realServiceWorker: true, checks: ['legacy cached app migrates with two tabs open', 'version-only upgrade updates CSS and JS', 'focus checks for updates', 'offline reopen retains a complete shell', 'partial download cannot activate or mix HTML'] }, null, 2));
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
