import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout, clearTimeout } from 'node:timers';
import { Notifications } from '../src/notifications.js';

function fixture(permission = 'granted') {
  const calls = []; let result = { subscribed: true };
  const subscription = { options: { applicationServerKey: Uint8Array.of(65).buffer }, toJSON: () => ({ endpoint: 'https://push.example/secret', keys: { p256dh: 'key', auth: 'secret' } }), async unsubscribe() { calls.push('unsubscribe'); } };
  const registration = { active: {}, pushManager: { async getSubscription() { return subscription; }, async subscribe() { calls.push('subscribe'); return subscription; } } };
  const browser = { Notification: { async requestPermission() { calls.push('prompt'); return permission; } }, PushManager: {}, navigator: { serviceWorker: { async register() { calls.push('worker'); return registration; } } }, atob: () => 'A', setTimeout, clearTimeout };
  const model = new Notifications({ browser, changed() {}, fetch: async (url, options) => {
    const body = options.body && JSON.parse(options.body); calls.push(body?.op || 'key');
    assert.equal(url, '/api/push?workspace=0123456789abcdef');
    return { ok: true, json: async () => body ? result : { public_key: 'QQ', key_id: 'key-1' } };
  } });
  return { model, calls, subscription, setResult(value) { result = value; } };
}

test('only explicit post-pairing enable prompts, permission alone never enables; test and off use server', async () => {
  const f = fixture(); await f.model.enable(); assert.deepEqual(f.calls, []);
  f.model.access(true); f.model.select('0123456789abcdef'); assert.deepEqual(f.calls, []);
  await f.model.enable(); assert.deepEqual(f.calls, ['prompt', 'key', 'worker', 'subscribe']); assert.equal(f.model.enabled, true);
  f.setResult({ sent: true }); await f.model.test(); assert.equal(f.calls.at(-1), 'test'); assert.match(f.model.message, /does not prove display/);
  f.setResult({ subscribed: false }); await f.model.off(); assert.equal(f.model.enabled, false); assert.equal(f.calls.at(-1), 'unsubscribe');
});

test('denied permission has recovery guidance and failed registration stays disabled', async () => {
  const denied = fixture('denied'); denied.model.access(true); denied.model.select('0123456789abcdef');
  await denied.model.enable(); assert.deepEqual(denied.calls, ['prompt']); assert.match(denied.model.message, /settings/); assert.equal(denied.model.enabled, false);
  const failed = fixture(); failed.setResult({ subscribed: false }); failed.model.access(true); failed.model.select('0123456789abcdef');
  await failed.model.enable(); assert.equal(failed.model.enabled, false); assert.match(failed.model.message, /did not confirm/);
});

test('rotation replaces browser subscription; late permission after access loss does nothing', async () => {
  const f = fixture(); f.subscription.options.applicationServerKey = Uint8Array.of(66).buffer;
  f.model.access(true); f.model.select('0123456789abcdef'); await f.model.enable();
  assert.deepEqual(f.calls, ['prompt', 'key', 'worker', 'unsubscribe', 'subscribe', 'subscribe']);
  let resolve; f.model.browser.Notification.requestPermission = () => new Promise((done) => { resolve = done; });
  const enabling = f.model.enable(); f.model.access(false); resolve('granted'); await enabling;
  assert.equal(f.model.enabled, false); assert.equal(f.calls.length, 6);
});
