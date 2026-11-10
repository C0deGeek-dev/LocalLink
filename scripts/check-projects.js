// Isolated gateway fixtures: no real server, device credential or Android proof.
/* global window, document, innerWidth */
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import axe from 'axe-core';
import { verifyBundle } from './bundle.js';

const root = new URL('../dist/', import.meta.url);
const { manifest } = await verifyBundle(fileURLToPath(root));
const files = new Map(manifest.files.map((file) => [`/${file.path}`, file]));
const channel = process.argv.find((arg) => arg.startsWith('--channel='))?.split('=')[1];
const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
const output = process.env.LOCALLINK_PROJECTS_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const origin = 'https://locallink.test';
const a = '0123456789abcdef', b = 'fedcba9876543210', offline = 'aaaaaaaaaaaaaaaa', empty = 'bbbbbbbbbbbbbbbb';
const session = '11111111-1111-4111-8111-111111111111';
const label = 'A project with a deliberately long duplicate folder name';
const results = [];
try {
  for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 320, height: 960 }, colorScheme, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const errors = [], reads = [], commands = [], sockets = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let workspaces = [{ id: a, label, online: true }, { id: b, label, online: true },
      { id: offline, label: 'Offline project', online: false }, { id: empty, label: 'Empty project', online: true }];
    let listingStatus = 200, inventoryStatus = 200, held;
    await page.route(`${origin}/**`, async (route) => {
      const url = new URL(route.request().url()), path = url.pathname;
      if (path === '/__test/axe.js') return route.fulfill({ contentType: 'application/javascript', body: axe.source });
      if (path.startsWith('/api/')) {
        let status = 200, body = {};
        if (path === '/api/workspaces') { status = inventoryStatus; body = { scope: 'control', workspaces }; }
        else if (path === '/api/sessions') {
          reads.push(url.searchParams.get('workspace')); status = listingStatus;
          if (held) await new Promise((resolve) => { held.resolve = resolve; });
          body = { sessions: url.searchParams.get('workspace') === empty ? [] : [{ id: session, name: 'Shared terminal', live: true }] };
        } else if (path === '/api/device') body = { id: 'abcdef0123456789', name: 'Fixture phone', scope: 'control', this_workspace_only: false, paired_unix: 1 };
        else status = 404;
        return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      }
      const file = files.get(path === '/' ? '/index.html' : path);
      if (!file) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ contentType: file.content_type, body: await readFile(new URL(file.path, root)) });
    });
    await page.routeWebSocket('**/api/socket?*', (ws) => {
      const workspace = new URL(ws.url()).searchParams.get('workspace');
      sockets.push({ workspace, closed: false, ws });
      const record = sockets.at(-1);
      ws.onClose(() => { record.closed = true; });
      ws.onMessage((data) => commands.push({ workspace, ...JSON.parse(data) }));
      const send = (event) => ws.send(JSON.stringify({ v: 1, event }));
      send({ type: 'attached', session_id: session, epoch: workspace, capabilities: ['acks', 'resume'] });
      send({ type: 'snapshot', epoch: workspace, seq: 5, turn: 'running', busy: true, queued: 0,
        history: [{ role: 'user', text: `History for ${workspace}` }], plan: [], asks: [] });
      ws.send(JSON.stringify({ v: 1, seq: 6, event: { type: 'permission_ask', ask_id: 'same-ask-id',
        tool: 'shell', detail: 'echo harmless\n' + 'x'.repeat(180), risk: 'low' } }));
    });
    const group = (id) => page.locator(`.project-group[data-key="${id}"]`);
    async function scan(state) {
      if (!await page.evaluate(() => !!window.axe)) await page.addScriptTag({ url: `${origin}/__test/axe.js` });
      const violations = await page.evaluate(async () => (await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
      })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })));
      assert.deepEqual(violations, [], `${colorScheme}/${state}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, state);
      assert.deepEqual(await page.locator('button:visible, summary:visible').evaluateAll((nodes) => nodes.filter((node) => node.getBoundingClientRect().height < 48 || node.getBoundingClientRect().width < 48).map((node) => node.textContent)), [], state);
      if (output) await page.screenshot({ path: `${output}/${state}-${colorScheme}.png`, fullPage: true });
      results.push(`${colorScheme}/${state}`);
    }
    await page.goto(origin);
    await group(a).waitFor(); assert.deepEqual(reads, []);
    await group(a).locator('summary').focus(); await page.keyboard.press('Enter');
    await group(a).locator('.session-choice').waitFor(); assert.deepEqual(reads, [a]);
    await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
    assert.deepEqual(reads, [a]);
    await group(offline).locator('summary').click(); assert.deepEqual(reads, [a]);
    await group(empty).locator('summary').click();
    await group(empty).getByText('No shared sessions.', { exact: false }).waitFor();
    await scan('groups');
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await scan('groups-large-text');
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    await group(a).locator('.session-choice').click();
    await page.locator('#session-state').getByText('Working', { exact: true }).waitFor();
    await page.locator('#session-draft').fill('Draft for A');
    await page.locator('#session-browser-title').click();
    await group(b).locator('summary').click(); await group(b).locator('.session-choice').waitFor();
    assert.equal(sockets.length, 1); assert.equal(sockets[0].closed, false);
    assert.equal(await page.locator('#session-draft').inputValue(), 'Draft for A');
    assert.match(await page.locator('#stop-project').textContent(), new RegExp(a));
    // Inventory recheck does not fan out or detach the active socket.
    const before = reads.length;
    await page.locator('#refresh-projects').click(); await page.locator('#refresh-projects').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.getElementById('refresh-projects').disabled);
    assert.equal(reads.length, before); assert.equal(sockets.length, 1); assert.equal(sockets[0].closed, false);
    await group(b).locator('.session-choice').click();
    await page.locator('#session-state').getByText('Working', { exact: true }).waitFor();
    assert.equal(await page.locator('#session-draft').inputValue(), '');
    await page.locator('#session-draft').fill('Draft for B');
    await page.locator('[data-destination="attention"]').click(); await page.locator('#attention-list button').click();
    assert.match(await page.locator('#approval-project').textContent(), new RegExp(b));
    assert.match(await page.locator('#approval-action-project').textContent(), new RegExp(b));
    assert.equal(await page.locator('#allow-approval').isEnabled(), true);
    await scan('approval-project');
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await scan('approval-project-large-text');
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    await page.locator('#close-approval').click();
    await page.locator('[data-destination="sessions"]').click(); await page.locator('#session-browser-title').click();
    await group(a).locator('.session-choice').click();
    await page.locator('#session-state').getByText('Working', { exact: true }).waitFor();
    assert.equal(await page.locator('#session-draft').inputValue(), 'Draft for A');
    assert.match(await page.locator('#stop-project').textContent(), new RegExp(a));
    await page.locator('#session-browser-title').click();
    // A transient reachability miss in a list does not close a healthy socket.
    listingStatus = 503;
    await group(a).getByRole('button', { name: 'Refresh sessions' }).click();
    await group(a).getByText('This project is offline.', { exact: false }).waitFor();
    assert.equal(sockets.length, 3); assert.equal(sockets[2].closed, false);
    assert.equal(await page.locator('#stop-turn').isEnabled(), true);
    listingStatus = 429;
    await group(b).getByRole('button', { name: 'Refresh sessions' }).click();
    await group(b).getByText('Too many requests.', { exact: false }).waitFor();
    const after429 = reads.length;
    await scan('groups-rate-limit'); assert.equal(reads.length, after429);
    listingStatus = 200;
    await group(b).getByRole('button', { name: 'Try again' }).click(); await group(b).locator('.session-choice').waitFor();
    assert.equal(reads.length, after429 + 1);
    // A held group response cannot restore a project removed by an access refresh.
    held = {};
    await group(b).getByRole('button', { name: 'Refresh sessions' }).click();
    await group(b).getByText('Loading shared sessions…').waitFor();
    workspaces = workspaces.filter((workspace) => workspace.id !== b);
    await page.locator('#refresh-projects').click(); await group(b).waitFor({ state: 'detached' });
    held.resolve(); held = null;
    assert.equal(await page.locator('#session-draft').inputValue(), 'Draft for A');
    inventoryStatus = 500;
    await page.locator('#refresh-projects').click();
    await page.locator('#projects-status').getByText('Previously loaded projects.', { exact: false }).waitFor();
    assert.equal(await group(a).count(), 1); assert.equal(await page.locator('#stop-turn').isDisabled(), true);
    assert.equal(commands.length, 0); assert.deepEqual(errors, []);
    assert.equal(sockets.length, 3);
    await context.close();
  }
  console.log(JSON.stringify({ result: 'PASS', fixtureOnly: true, scans: results }, null, 2));
} finally { await browser.close(); }
