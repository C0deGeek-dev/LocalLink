import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('push uses generic copy; a tap goes to a fixed destination for its kind and never trusts payload links', async () => {
  const listeners = {}, calls = [], shown = [];
  let existing = true;
  const client = { url: 'https://pc.example/', postMessage(message) { calls.push(JSON.parse(JSON.stringify(message))); }, async focus() { calls.push('focus'); } };
  const self = {
    location: { origin: 'https://pc.example' },
    addEventListener(type, listener) { listeners[type] = listener; },
    registration: { async showNotification(title, options) { shown.push(JSON.parse(JSON.stringify([title, options.body, options.data, options.tag]))); assert.equal(options.actions, undefined); } },
    clients: { async matchAll() { return existing ? [client] : []; }, async openWindow(url) { calls.push(url); } },
  };
  runInNewContext(await readFile(new URL('../src/push-worker.js', import.meta.url), 'utf8'), { self, URL });
  assert.deepEqual(Object.keys(listeners).sort(), ['activate', 'fetch', 'install', 'notificationclick', 'push']);
  let pending;
  const push = async (json) => { listeners.push({ data: { json }, waitUntil(promise) { pending = promise; } }); await pending; return shown.pop(); };
  const body = 'There is an update on your PC. Open LocalLink to check.';
  assert.deepEqual(await push(() => { throw new Error('unreadable'); }), ['LocalLink', body, { k: 'update' }, 'locallink-update']);
  assert.deepEqual(await push(() => ({ k: 'stopped', url: 'https://evil.example/approve' })), ['LocalLink', body, { k: 'stopped' }, 'locallink-stopped']);
  assert.deepEqual(await push(() => ({ k: 'constructor' })), ['LocalLink', body, { k: 'update' }, 'locallink-update']);
  const click = async (data) => { listeners.notificationclick({ notification: { close() {}, data }, waitUntil(promise) { pending = promise; } }); await pending; return calls.splice(0); };
  assert.deepEqual(await click({ k: 'ask', url: 'https://evil.example/approve' }), [{ type: 'notification-open', destination: 'attention' }, 'focus']);
  assert.deepEqual(await click({ k: 'stopped' }), [{ type: 'notification-open', destination: 'sessions' }, 'focus']);
  existing = false;
  assert.deepEqual(await click({ k: 'test' }), ['/#devices']);
  assert.deepEqual(await click({ k: 'stopped' }), ['/#sessions']);
  assert.deepEqual(await click({ url: 'https://evil.example/approve' }), ['/#attention']);
  assert.deepEqual(await click(undefined), ['/#attention']);
});
