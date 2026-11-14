// Synthetic gateway and socket fixtures; never connects to a real user session.
/* global document, innerWidth */
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { verifyBundle } from './bundle.js';

const root = new URL('../dist/', import.meta.url);
const { manifest } = await verifyBundle(fileURLToPath(root));
const files = new Map(manifest.files.map((file) => [`/${file.path}`, file]));
const channel = process.argv.find((arg) => arg.startsWith('--channel='))?.split('=')[1];
const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
const output = process.env.LOCALLINK_CONVERSATION_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const origin = 'https://locallink.test';
const workspace = '0123456789abcdef';
const session = '11111111-1111-4111-8111-111111111111';
const results = [];
try {
  for (const width of [320, 390, 820, 1024, 1440]) {
    for (const colorScheme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 760, hasTouch: width < 760, colorScheme, serviceWorkers: 'block' });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const errors = [], commands = [];
      page.on('pageerror', (error) => errors.push(error.message));
      let peer, releaseListing, seq = 1;
      const send = (event, extra = {}) => peer.send(JSON.stringify({ v: 1, event, ...extra }));
      const live = (event) => send(event, { seq: ++seq });
      await page.route(`${origin}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.startsWith('/api/')) {
          let body;
          if (path === '/api/workspaces') body = { scope: 'control', workspaces: [
            { id: workspace, label: 'LocalPilot', online: true },
            { id: 'fedcba9876543210', label: 'LocalLink', online: true },
            { id: 'aaaaaaaaaaaaaaaa', label: 'LocalMind', online: false },
          ] };
          else if (path === '/api/sessions') {
            await new Promise((resolve) => { releaseListing = resolve; });
            body = { sessions: [{ id: session, name: 'Companion layout improvements', live: true }] };
          } else if (path === '/api/device') body = { id: 'abcdef0123456789', name: 'Browser fixture', scope: 'control', this_workspace_only: false, paired_unix: 1 };
          else return route.fulfill({ status: 404 });
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
        }
        const file = files.get(path === '/' ? '/index.html' : path);
        return file ? route.fulfill({ contentType: file.content_type, body: await readFile(new URL(file.path, root)) }) : route.fulfill({ status: 404 });
      });
      await page.routeWebSocket('**/api/socket?*', (ws) => {
        peer = ws;
        ws.onMessage((data) => commands.push(JSON.parse(data)));
        send({ type: 'attached', session_id: session, epoch: 'fixture', capabilities: ['acks', 'resume'] });
      });
      const latest = () => page.evaluate(() => {
        const node = document.getElementById('conversation-scroll');
        return node.scrollHeight - node.clientHeight - node.scrollTop < 5;
      });
      async function screenshot(name) {
        if (output) await page.screenshot({ path: `${output}/${width}-${colorScheme}-${name}.png` });
      }
      await page.goto(origin);
      const group = page.locator(`.project-group[data-key="${workspace}"]`);
      await group.locator('summary').click();
      await group.locator('.session-skeleton').waitFor();
      await screenshot('projects-loading');
      releaseListing();
      await group.locator('.session-choice').click();
      await page.locator('#session-loading').waitFor();
      await screenshot('conversation-loading');
      send({ type: 'snapshot', epoch: 'fixture', seq, turn: 'idle', busy: false, queued: 0, asks: [], plan: [], history:
        Array.from({ length: 40 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', text: index === 39 ?
          'The responsive layout is ready. Projects stay alongside the conversation on wider screens, and the composer stays in reach. What would you like to adjust next?' :
          index % 2 ? 'I will check the layout, the message delivery states and the scrolling behaviour across screen sizes.\n\nThe conversation should remain easy to follow while work continues.' : `Review step ${index / 2 + 1}: improve the companion experience.` })) });
      await page.getByText('Ready', { exact: true }).waitFor();
      await page.waitForFunction(() => { const s = document.getElementById('conversation-scroll'); return s.scrollTop > 0 && s.scrollHeight - s.clientHeight - s.scrollTop < 5; });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const boxes = await page.locator('#session-browser, #session-view').evaluateAll((nodes) => nodes.map((node) => { const b = node.getBoundingClientRect(); return { x: b.x, width: b.width, right: b.right }; }));
      if (width >= 760) assert.ok(boxes[1].x >= boxes[0].right - 1, 'tablet and desktop have a persistent sidebar');
      const composer = await page.locator('#session-draft').boundingBox();
      assert.ok(composer.y > 0 && composer.y + composer.height <= 900, 'composer is in the viewport');
      await screenshot('ready');
      await page.locator('#session-draft').fill('Please also show delivery progress while the AI is working.');
      await page.locator('#send-input').click();
      await page.locator('.delivery-status').getByText('Sending…', { exact: true }).waitFor();
      assert.equal(commands.length, 1);
      assert.equal(await page.locator('.message.user').last().textContent().then((text) => text.includes('Please also show delivery')), true);
      assert.equal(await page.locator('#send-input').isDisabled(), true);
      assert.equal(await latest(), true);
      await screenshot('sending');
      if (width === 1440) {
        live({ type: 'turn_started' });
        await page.getByText('Thinking…', { exact: true }).waitFor();
        assert.equal(await page.locator('[data-delivery="sending"]').count(), 1, 'PC work is visible even before the delivery acknowledgement');
        send({ type: 'accepted' }, { id: commands[0].id });
      } else {
        send({ type: 'accepted' }, { id: commands[0].id });
        await page.getByText('Waiting for LocalPilot…', { exact: true }).waitFor();
        live({ type: 'turn_started' });
      }
      await page.getByText('Thinking…', { exact: true }).waitFor();
      await page.waitForFunction(() => document.getElementById('session-draft').value === '');
      await screenshot('thinking');
      // The reader may scroll back without token updates pulling them away.
      await page.locator('#conversation-scroll').evaluate((node) => { node.scrollTop = 0; });
      await page.locator('#jump-latest').waitFor();
      live({ type: 'text_delta', text: 'I am checking the wider layout and the live delivery feedback.' });
      await page.getByText('Responding…', { exact: true }).waitFor();
      assert.equal(await page.locator('#conversation-scroll').evaluate((node) => node.scrollTop), 0);
      await page.locator('#jump-latest').click();
      assert.equal(await latest(), true);
      live({ type: 'text_delta', text: '\n\nThe newest messages now stay in view unless you scroll back to read earlier work.' });
      await page.getByText(/The newest messages now stay/).waitFor();
      await page.waitForFunction(() => { const s = document.getElementById('conversation-scroll'); return s.scrollHeight - s.clientHeight - s.scrollTop < 5; });
      await screenshot('responding');
      live({ type: 'permission_ask', ask_id: 'ask', tool: 'shell', detail: 'npm run check', risk: 'low' });
      await page.getByText('Waiting for your approval', { exact: true }).waitFor();
      live({ type: 'permission_resolved', ask_id: 'ask', outcome: 'allowed' });
      live({ type: 'stopped', reason: 'complete' });
      await page.locator('#turn-activity').waitFor({ state: 'hidden' });
      // Refused input remains visible but must never claim delivery or clear the draft.
      await page.locator('#session-draft').fill('A refused message'); await page.locator('#send-input').click();
      await page.waitForFunction(() => document.querySelector('[data-delivery="sending"]'));
      send({ type: 'rejected', code: 'refused', message: 'Fixture refusal' }, { id: commands.at(-1).id });
      await page.getByText('Not sent · draft kept below', { exact: true }).waitFor();
      assert.equal(await page.locator('#session-draft').inputValue(), 'A refused message');
      assert.equal(commands.length, 2);
      assert.deepEqual(errors, []);
      results.push(`${width}/${colorScheme}`);
      await context.close();
    }
  }
  console.log(JSON.stringify({ result: 'PASS', fixtureOnly: true, viewports: results }, null, 2));
} finally { await browser.close(); }
