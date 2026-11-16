import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout, clearTimeout } from 'node:timers';
import { Notifications } from '../src/notifications.js';

function fixture(permission = 'granted') {
  const calls = []; let result = { subscribed: true }; const states = { '0123456789abcdef': 'off' };
  const subscription = { options: { applicationServerKey: Uint8Array.of(65).buffer }, toJSON: () => ({ endpoint: 'https://push.example/secret', keys: { p256dh: 'key', auth: 'secret' } }), async unsubscribe() { calls.push('unsubscribe'); } };
  const registration = { active: {}, pushManager: { async getSubscription() { return subscription; }, async subscribe() { calls.push('subscribe'); return subscription; } } };
  const browser = { Notification: { permission, async requestPermission() { calls.push('prompt'); return permission; } }, PushManager: {}, navigator: { serviceWorker: { async register() { calls.push('worker'); return registration; } } }, atob: () => 'A', setTimeout, clearTimeout };
  const model = new Notifications({ browser, changed() {}, fetch: async (url, options) => {
    const body = options.body && JSON.parse(options.body); calls.push(body?.op || 'key');
    const workspace = new URL(url, 'https://pc.example').searchParams.get('workspace');
    if (body?.op === 'status') {
      if (!(workspace in states)) return { ok: false, status: 400 };
      return { ok: true, json: async () => ({ notifications: states[workspace] }) };
    }
    assert.equal(workspace, '0123456789abcdef');
    return { ok: true, json: async () => body ? result : { public_key: 'QQ', key_id: 'key-1' } };
  } });
  return { model, calls, subscription, states, setResult(value) { result = value; } };
}

test('only explicit post-pairing enable prompts, permission alone never enables; test and off use server', async () => {
  const f = fixture(); await f.model.enable(); assert.deepEqual(f.calls, []);
  f.model.access(true); f.model.select('0123456789abcdef'); assert.deepEqual(f.calls, ['status'], 'reading the state never prompts');
  await f.model.enable(); assert.deepEqual(f.calls, ['status', 'prompt', 'key', 'worker', 'subscribe']); assert.equal(f.model.enabled, true);
  f.setResult({ sent: true }); await f.model.test(); assert.equal(f.calls.at(-1), 'test'); assert.match(f.model.message, /does not prove display/);
  f.setResult({ subscribed: false }); await f.model.off(); assert.equal(f.model.enabled, false); assert.equal(f.calls.at(-1), 'unsubscribe');
});

test('denied permission has recovery guidance and failed registration stays disabled', async () => {
  const denied = fixture('denied'); denied.model.access(true); denied.model.select('0123456789abcdef');
  await denied.model.enable(); assert.deepEqual(denied.calls, ['status', 'prompt']); assert.match(denied.model.message, /settings/); assert.equal(denied.model.enabled, false);
  const failed = fixture(); failed.setResult({ subscribed: false }); failed.model.access(true); failed.model.select('0123456789abcdef');
  await failed.model.enable(); assert.equal(failed.model.enabled, false); assert.match(failed.model.message, /did not confirm/);
});

test('rotation replaces browser subscription; late permission after access loss does nothing', async () => {
  const f = fixture(); f.subscription.options.applicationServerKey = Uint8Array.of(66).buffer;
  f.model.access(true); f.model.select('0123456789abcdef'); await f.model.enable();
  assert.deepEqual(f.calls, ['status', 'prompt', 'key', 'worker', 'unsubscribe', 'subscribe', 'subscribe']);
  let resolve; f.model.browser.Notification.requestPermission = () => new Promise((done) => { resolve = done; });
  const enabling = f.model.enable(); f.model.access(false); resolve('granted'); await enabling;
  assert.equal(f.model.enabled, false); assert.equal(f.calls.length, 7);
});

const settled = () => new Promise((done) => setTimeout(done, 0));

test('choosing a project shows what the PC has for this device, without prompting', async () => {
  for (const [state, enabled, pattern] of [['on', true, /are on/], ['off', false, /are off/], ['lapsed', false, /turn them on again/], ['unavailable', false, /turned off on your PC/]]) {
    const f = fixture(); f.states['0123456789abcdef'] = state; f.model.access(true);
    f.model.select('0123456789abcdef'); await settled();
    assert.equal(f.model.enabled, enabled, state); assert.match(f.model.message, pattern); assert.deepEqual(f.calls, ['status']);
  }
  // On at the PC but blocked in this browser: not enabled, and says why.
  const blocked = fixture('denied'); blocked.states['0123456789abcdef'] = 'on'; blocked.model.access(true);
  blocked.model.select('0123456789abcdef'); await settled();
  assert.equal(blocked.model.enabled, false); assert.match(blocked.model.message, /browser blocks them/);
  // An older PC without the status request leaves the unconfirmed message.
  const older = fixture(); delete older.states['0123456789abcdef']; older.model.access(true);
  older.model.select('0123456789abcdef'); await settled();
  assert.equal(older.model.enabled, false); assert.match(older.model.message, /not confirmed/);
});

test('a status answer arriving after enable never overrides it', async () => {
  const f = fixture(); f.model.access(true);
  let answer; const fetch = f.model.fetch;
  f.model.fetch = (url, options) => JSON.parse(options.body || '{}').op === 'status' ? new Promise((done) => { answer = () => done({ ok: true, json: async () => ({ notifications: 'lapsed' }) }); }) : fetch(url, options);
  f.model.select('0123456789abcdef');
  await f.model.enable(); assert.equal(f.model.enabled, true);
  answer(); await settled();
  assert.equal(f.model.enabled, true); assert.match(f.model.message, /enabled for this project/);
});

test('opening lists the projects whose notifications lapsed, until they are turned on or off', async () => {
  const f = fixture(); f.model.access(true);
  Object.assign(f.states, { '0123456789abcdef': 'lapsed', aaaaaaaaaaaaaaaa: 'on', bbbbbbbbbbbbbbbb: 'lapsed', cccccccccccccccc: 'lapsed' });
  const projects = [
    { id: '0123456789abcdef', label: 'One', online: true }, { id: 'aaaaaaaaaaaaaaaa', label: 'Two', online: true },
    { id: 'bbbbbbbbbbbbbbbb', label: 'Three', online: true }, { id: 'cccccccccccccccc', label: 'Offline', online: false },
  ];
  await f.model.review(projects);
  assert.deepEqual(f.model.lapsed.map((item) => item.label), ['One', 'Three']);
  assert.equal(f.calls.length, 3, 'an offline project is not asked');
  await f.model.review(projects); assert.equal(f.calls.length, 3, 'asked once per project list');
  f.model.select('0123456789abcdef'); await f.model.enable();
  assert.deepEqual(f.model.lapsed.map((item) => item.label), ['Three']);
  // Losing access forgets it.
  f.model.access(false); assert.deepEqual(f.model.lapsed, []);
});
