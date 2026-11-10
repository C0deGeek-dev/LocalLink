// Isolated, synthetic browser fixtures. No real gateway, credentials or Android.
/* global window, document, innerWidth, MutationObserver, getComputedStyle */
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import axe from 'axe-core';
import { verifyBundle } from './bundle.js';

const root = new URL('../dist/', import.meta.url);
const { manifest } = await verifyBundle(fileURLToPath(root));
const files = new Map(manifest.files.map((file) => [`/${file.path}`, file]));
const channel = process.argv.find((arg) => arg.startsWith('--channel='))?.split('=')[1];
const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
const output = process.env.LOCALLINK_A11Y_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const results = [];
const workspace = '0123456789abcdef';
const session = '11111111-1111-4111-8111-111111111111';
const origin = 'https://locallink.test';
try {
  for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 320, height: 960 }, colorScheme, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [], commands = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let paired = false, peer, seq = 5;
    let asks = [];
    const send = (event, extra = {}) => peer.send(JSON.stringify({ v: 1, event, ...extra }));
    const live = (event) => {
      if (event.type === 'permission_ask') asks.push(event);
      if (event.type === 'permission_resolved') asks = asks.filter((ask) => ask.ask_id !== event.ask_id);
      send(event, { seq: ++seq });
    };
    const storedReply = { role: 'assistant', text: 'Stored response.\n```js\nconst stored = 1;\n```\n' };
    await page.route(`${origin}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/__test/axe.js') return route.fulfill({ contentType: 'application/javascript', body: axe.source });
      if (path.startsWith('/api/')) {
        let status = 200, body = {};
        if (path === '/api/workspaces') { status = paired ? 200 : 401; body = { scope: 'control', workspaces: [{ id: workspace, label: 'Example project', online: true }] }; }
        else if (path === '/api/sessions') body = { sessions: [{ id: session, name: 'Accessibility review', live: true }] };
        else if (path === '/api/device') body = { id: 'abcdef0123456789', name: 'Test phone', scope: 'control', this_workspace_only: false, paired_unix: 1 };
        else status = 404;
        return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      }
      const file = files.get(path === '/' ? '/index.html' : path);
      if (!file) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ contentType: file.content_type, body: await readFile(new URL(file.path, root)), headers: {
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'",
      } });
    });
    await page.routeWebSocket('**/api/socket?*', (ws) => {
      peer = ws;
      ws.onMessage((data) => {
        const record = JSON.parse(data); commands.push(record);
        if (record.command.type === 'commands') send({ type: 'commands', items: [{ name: 'effort', description: 'Choose effort', args: 'optional', scope: 'control' }] }, { id: record.id });
      });
      send({ type: 'attached', session_id: session, epoch: 'fixture', capabilities: ['acks', 'resume', 'commands'] });
      send({ type: 'snapshot', epoch: 'fixture', seq, turn: 'running', busy: true, queued: 0,
        history: [{ role: 'user', text: 'Review accessibility.' }, storedReply], turn_text: 'Example response.\n```js\nconst value = "' + 'x'.repeat(180) + '";\n```\n', plan: [], asks });
    });
    async function scan(state) {
      if (!await page.evaluate(() => !!window.axe)) await page.addScriptTag({ url: `${origin}/__test/axe.js` });
      const result = await page.evaluate(async () => {
        const audit = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } });
        return { violations: audit.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })), incomplete: audit.incomplete.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) })) };
      });
      assert.deepEqual(result.violations, [], `${colorScheme}/${state}: ${JSON.stringify(result.violations)}`);
      assert.equal(result.incomplete.every((item) => item.id === 'color-contrast'), true, `Unreviewed manual-check category: ${JSON.stringify(result.incomplete)}`);
      // Axe cannot determine backgrounds for clipped/scrolled code or overlays.
      // Check the actual computed palette separately; screenshots still need review.
      const contrasts = await page.locator('.code-block:visible, #approval-detail:visible, nav a:visible').evaluateAll((nodes) => {
        const rgb = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number);
        const luminance = (color) => rgb(color).map((value) => { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
        return nodes.map((node) => {
          let parent = node;
          while (getComputedStyle(parent).backgroundColor === 'rgba(0, 0, 0, 0)') parent = parent.parentElement;
          const a = luminance(getComputedStyle(node).color), b = luminance(getComputedStyle(parent).backgroundColor);
          return { target: node.id || node.className || node.textContent, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
        });
      });
      assert.equal(contrasts.every(({ ratio }) => ratio >= 4.5), true, JSON.stringify(contrasts));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${state}: horizontal page overflow`);
      const shortTargets = await page.locator('button:visible, input:visible, select:visible, textarea:visible, summary:visible, nav a:visible, .standalone-link:visible').evaluateAll((nodes) => nodes.filter((node) => node.getBoundingClientRect().height < 48 || node.getBoundingClientRect().width < 48).map((node) => node.id || node.textContent));
      assert.deepEqual(shortTargets, [], `${state}: touch targets`);
      results.push({ colorScheme, state, ...result, computedContrast: contrasts });
      if (output) await page.screenshot({ path: join(output, `${state}-${colorScheme}.png`), fullPage: true });
    }
    await page.goto(origin);
    await page.locator('#pair-title').filter({ hasText: 'Connect' }).waitFor();
    await scan('pairing');
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await scan('large-text-pairing');
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.skip').evaluate((node) => node === document.activeElement), true);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement.id === 'main');
    assert.equal(await page.locator('#main').evaluate((node) => node === document.activeElement), true);
    paired = true;
    await page.locator('#check-connection').click();
    await page.locator('.project-group summary').click();
    await page.locator('.session-choice').click();
    await page.getByText('Working', { exact: true }).waitFor();
    await page.locator('.code-block').last().focus();
    await page.evaluate(() => {
      window.focusedCode = document.activeElement;
      window.replyMutations = 0;
      new MutationObserver((mutations) => { window.replyMutations += mutations.length; }).observe(document.getElementById('reply-announcement'), { childList: true, characterData: true, subtree: true });
    });
    for (let index = 0; index < 20; index++) live({ type: 'text_delta', text: ' More text.' });
    await page.getByText(/More text\./).waitFor();
    assert.equal(await page.evaluate(() => window.focusedCode === document.activeElement && window.focusedCode.isConnected), true);
    assert.equal(await page.evaluate(() => window.replyMutations), 0);
    await page.locator('.code-block').first().focus();
    await page.evaluate(() => { window.focusedHistory = document.activeElement; });
    send({ type: 'resync_required', epoch: 'fixture' });
    send({ type: 'snapshot', epoch: 'fixture', seq: ++seq, turn: 'running', busy: true, queued: 0, history: [storedReply], history_truncated: true,
      turn_text: 'Example response.\n```js\nconst live = 1;\n```\n', plan: [], asks: [] });
    await page.locator('#history-limit').filter({ hasText: 'recent' }).waitFor();
    assert.equal(await page.evaluate(() => window.focusedHistory === document.activeElement && window.focusedHistory.isConnected), true);
    live({ type: 'tool_started', id: 'tool1', name: 'shell' });
    live({ type: 'tool_finished', id: 'tool1', name: 'shell', output: 'x'.repeat(250), is_error: false });
    await page.locator('.activity-group summary').click();
    live({ type: 'text_delta', text: '```js\nconst streamed = 2;' });
    await page.locator('.message-text').filter({ hasText: 'const streamed' }).waitFor();
    live({ type: 'text_delta', text: '\n```\n' });
    await page.locator('.code-block').filter({ hasText: 'const streamed' }).waitFor();
    assert.equal(await page.locator('.code-block').last().textContent(), 'const streamed = 2;\n');
    await scan('session');
    live({ type: 'stopped', reason: 'complete' });
    await page.locator('#reply-announcement').filter({ hasText: 'Reply finished' }).waitFor({ state: 'attached' });
    assert.equal(await page.evaluate(() => window.replyMutations), 1);
    live({ type: 'turn_started' }); live({ type: 'text_delta', text: 'Short reply.' }); live({ type: 'stopped', reason: 'complete' });
    await page.waitForFunction(() => window.replyMutations === 3);
    live({ type: 'permission_ask', ask_id: 'ask1', tool: 'shell', detail: 'echo example\n' + 'x'.repeat(240), risk: 'low', expires_at_ms: Date.now() + 120000 });
    await page.locator('[data-destination="attention"]').click();
    await page.waitForFunction(() => document.activeElement.id === 'attention-title');
    assert.equal(await page.locator('#attention-title').evaluate((node) => node === document.activeElement), true);
    await page.locator('#attention-list button').first().focus();
    await page.evaluate(() => { window.focusedAsk = document.activeElement; });
    live({ type: 'permission_ask', ask_id: 'ask2', tool: 'read_file', detail: 'README.md', risk: 'low', expires_at_ms: Date.now() + 120000 });
    await page.locator('#attention-list button').nth(1).waitFor();
    assert.equal(await page.evaluate(() => window.focusedAsk === document.activeElement && window.focusedAsk.isConnected), true);
    await scan('attention');
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await scan('large-text-attention');
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    await page.locator('#attention-list button').first().click();
    assert.equal(await page.locator('#approval-tool').evaluate((node) => node === document.activeElement), true);
    await scan('approval');
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await scan('large-text-approval');
    await page.locator('#close-approval').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#close-approval').evaluate((node) => {
      const control = node.getBoundingClientRect(), sheet = document.getElementById('approval-sheet').getBoundingClientRect();
      return control.top >= sheet.top && control.bottom <= sheet.bottom;
    }), true);
    if (output) await page.screenshot({ path: join(output, `large-text-approval-controls-${colorScheme}.png`) });
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    for (let index = 0; index < 8; index++) {
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement === document.body || document.getElementById('approval-sheet').contains(document.activeElement)), true);
    }
    for (let index = 0; index < 8; index++) {
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement === document.body || document.getElementById('approval-sheet').contains(document.activeElement)), true);
    }
    const before = commands.filter((record) => record.command.type !== 'commands').length;
    await page.keyboard.press('Escape');
    await page.locator('#approval-sheet').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.focusedAsk === document.activeElement);
    assert.equal(commands.filter((record) => record.command.type !== 'commands').length, before);
    assert.equal(await page.evaluate(() => window.focusedAsk === document.activeElement), true);
    await page.locator('#attention-list button').first().click();
    live({ type: 'permission_resolved', ask_id: 'ask1', outcome: 'denied' });
    await page.locator('#approval-status').filter({ hasText: 'Answered on another device' }).waitFor();
    await page.locator('#close-approval').click();
    await page.waitForFunction(() => document.activeElement.id === 'attention-title');
    await page.locator('[data-destination="devices"]').click();
    await scan('devices');
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await scan('large-text-devices');
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    await page.locator('#theme-preference').selectOption(colorScheme === 'light' ? 'dark' : 'light');
    const override = colorScheme === 'light' ? 'dark' : 'light';
    assert.equal(await page.locator('html').getAttribute('data-theme'), override);
    await page.reload();
    assert.equal(await page.locator('#theme-preference').inputValue(), override);
    await page.locator('#theme-preference').selectOption('system');
    await page.emulateMedia({ colorScheme: 'dark' });
    assert.equal(await page.locator('html').evaluate((node) => getComputedStyle(node).backgroundColor), 'rgb(28, 36, 34)');
    await page.emulateMedia({ colorScheme: 'light' });
    assert.equal(await page.locator('html').evaluate((node) => getComputedStyle(node).backgroundColor), 'rgb(245, 243, 236)');
    await page.emulateMedia({ colorScheme });
    await page.locator('[data-destination="sessions"]').click();
    await page.locator('.project-group summary').click();
    await page.locator('.session-choice').click();
    await page.getByText('Working', { exact: true }).waitFor();
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await scan('large-text-session');
    peer.close({ code: 1001 });
    await page.locator('#session-state').filter({ hasText: 'Connection lost' }).waitFor();
    await scan('disconnected');
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(JSON.stringify({ result: 'PASS', fixtureOnly: true, scans: results.map(({ colorScheme, state, violations, incomplete }) => ({ colorScheme, state, violations: violations.length, manualChecks: incomplete.map(({ id }) => id) })) }, null, 2));
  if (output) await import('node:fs/promises').then(({ writeFile }) => writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2)));
} finally { await browser.close(); }
