import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout } from 'node:timers';
import { Device } from '../src/device.js';

test('self revoke reconciles a lost reply with a read and never retries', async () => {
  const calls = []; let revoked = 0;
  const device = new Device({ changed() {}, revoked() { revoked++; }, fetch: async (path, options) => {
    calls.push([path, options.method]);
    if (options.method === 'POST') throw new Error('lost');
    return { status: 401 };
  } });
  device.authorized = true; device.record = { id: '0123456789abcdef' };
  await device.revoke(); assert.equal(revoked, 1);
  assert.deepEqual(calls, [['/api/device/revoke', 'POST'], ['/api/device', 'GET']]);
});

test('late device read cannot restore access after revocation', async () => {
  let resolve;
  const device = new Device({ changed() {}, revoked() {}, fetch: () => new Promise((done) => { resolve = done; }) });
  device.access(true); device.access(false);
  resolve({ ok: true, status: 200, json: async () => ({ id: '0123456789abcdef', name: 'Phone', scope: 'control' }) });
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(device.record, null); assert.equal(device.authorized, false);
});
