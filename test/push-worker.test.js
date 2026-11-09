import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('push uses generic copy; notification opens only refetch, never execute or trust payload links', async () => {
  const listeners = {}, calls = [];
  let existing = true;
  const client = { url: 'https://pc.example/', postMessage(message) { calls.push(message.type); }, async focus() { calls.push('focus'); } };
  const self = {
    location: { origin: 'https://pc.example' },
    addEventListener(type, listener) { listeners[type] = listener; },
    registration: { async showNotification(title, options) { calls.push([title, options.body]); assert.equal(options.actions, undefined); assert.equal(options.data, undefined); } },
    clients: { async matchAll() { return existing ? [client] : []; }, async openWindow(url) { calls.push(url); } },
  };
  runInNewContext(await readFile(new URL('../src/push-worker.js', import.meta.url), 'utf8'), { self, URL });
  assert.deepEqual(Object.keys(listeners).sort(), ['notificationclick', 'push']);
  let pending;
  listeners.push({ data: { json() { throw new Error('must not use private payload'); } }, waitUntil(promise) { pending = promise; } });
  await pending; assert.deepEqual(calls.pop(), ['LocalLink', 'There is an update on your PC. Open LocalLink to check.']);
  const click = { notification: { close() {}, data: { url: 'https://evil.example/approve' } }, waitUntil(promise) { pending = promise; } };
  listeners.notificationclick(click); await pending; assert.deepEqual(calls.splice(0), ['notification-open', 'focus']);
  existing = false; listeners.notificationclick(click); await pending; assert.deepEqual(calls, ['/#attention']);
});
