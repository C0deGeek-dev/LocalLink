import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { Pairing, PairingCamera, parsePairing, takePairingLink, retryDelay } from '../src/pairing.js';

const origin = 'https://pc.example.test';
const workspace = '0123456789abcdef';
const link = `${origin}/#pair=single-use&w=${workspace}`;
const reply = (status, body, retry = null) => ({ status, text: async () => typeof body === 'string' ? body : JSON.stringify(body), headers: { get: () => retry } });
const unpaired = () => reply(401, 'this device is not paired');
const paired = () => reply(200, { workspaces: [] });
const exchanged = () => reply(200, { device_id: 'phone', scope: 'control' });
function fixture(responses = [], options = {}) {
  const calls = [];
  const changes = [];
  const pairing = new Pairing({
    origin, secure: true, changed: (state) => changes.push(state),
    fetch: async (...args) => {
      calls.push(args);
      const response = responses.shift();
      if (response instanceof Error) throw response;
      assert.ok(response, 'unexpected request');
      return response;
    }, ...options,
  });
  return { pairing, calls, changes };
}

test('manual details and gateway QR links use the issuing workspace', () => {
  assert.deepEqual(parsePairing(link, '', origin), { code: 'single-use', workspace });
  assert.deepEqual(parsePairing(' abc.def ', workspace, origin), { code: 'abc.def', workspace });
  assert.deepEqual(parsePairing(`${origin}/#pair=a%2Bb&w=${workspace}`, '', origin), { code: 'a+b', workspace });
  for (const bad of [
    `${origin}/#pair=x&w=${workspace}&w=${workspace}`, `${origin}/#pair=x&pair=y&w=${workspace}`,
    `${origin}/#pair=x&w=${workspace}&extra=x`, `${origin}/path#pair=x&w=${workspace}`,
    `${origin}/?pair=x#pair=x&w=${workspace}`, `${origin}/#pair=&w=${workspace}`,
    `${origin}/#pair=x&w=abc`, `${origin}/#pair=x%0A&w=${workspace}`,
    `${origin.replace('https://', 'https://user@')}/#pair=x&w=${workspace}`,
  ]) assert.throws(() => parsePairing(bad, '', origin), { state: 'invalid' });
  for (const bad of [link.replace('https:', 'http:'), link.replace('pc.example.test', 'evil.test'), link.replace('pc.example.test', 'pc.example.test.evil.test')]) {
    assert.throws(() => parsePairing(bad, '', origin), { state: 'wrong-origin' });
  }
  assert.throws(() => parsePairing('code', '', origin), { state: 'workspace-required' });
});

test('incoming secret fragments are removed synchronously and valid navigation is preserved', () => {
  const writes = [];
  const location = { href: link, hash: `#pair=single-use&w=${workspace}`, pathname: '/', search: '' };
  assert.equal(takePairingLink(location, { replaceState: (...args) => writes.push(args) }), link);
  assert.deepEqual(writes, [[null, '', '/#sessions']]);
  for (const hash of ['#sessions', '#devices', '#attention', '#main', '']) {
    assert.equal(takePairingLink({ ...location, hash }, {}), null);
  }
});

test('no exchange before explicit confirmation; credential is browser managed and never returned to UI', async () => {
  const { pairing, calls, changes } = fixture([unpaired(), exchanged(), paired()]);
  await pairing.check();
  pairing.prepare(link);
  assert.equal(pairing.state, 'confirm');
  assert.equal(calls.length, 1);
  await pairing.exchange();
  assert.equal(pairing.state, 'paired');
  assert.equal(pairing.scope, 'control');
  assert.deepEqual(calls.map(([path]) => path), ['/api/workspaces', '/api/pair', '/api/workspaces']);
  assert.deepEqual(JSON.parse(calls[1][1].body), { code: 'single-use', workspace });
  for (const [, options] of calls) {
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.mode, 'same-origin');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers?.Origin, undefined);
  }
  assert.doesNotMatch(JSON.stringify(changes), /single-use/);
  pairing.cancel();
  assert.equal(pairing.state, 'paired', 'navigation must not discard established pairing');
});

test('busy exchange excludes duplicate POSTs, new preparations and concurrent checks', async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const { pairing, calls } = fixture([pending, paired()]);
  pairing.prepare(link);
  const exchange = pairing.exchange();
  await pairing.exchange();
  pairing.prepare('other', workspace);
  await pairing.check();
  assert.equal(calls.length, 1);
  finish(exchanged());
  await exchange;
  assert.equal(pairing.state, 'paired');
  assert.equal(calls.filter(([, options]) => options.method === 'POST').length, 1);
});

test('lost POST reply probes the cookie without retrying the single-use exchange', async () => {
  for (const [probe, expected] of [[paired(), 'paired'], [unpaired(), 'unknown'], [new Error('offline'), 'unknown']]) {
    const { pairing, calls } = fixture([new Error('lost reply'), probe]);
    pairing.prepare(link);
    await pairing.exchange();
    assert.equal(pairing.state, expected);
    assert.deepEqual(calls.map(([path]) => path), ['/api/pair', '/api/workspaces']);
    await pairing.exchange();
    assert.equal(calls.length, 2);
  }
});

test('HTTP pairing errors expose distinct recovery states and never reflect server text', async () => {
  for (const [status, body, expected] of [
    [400, 'not a workspace id', 'invalid'], [403, 'forbidden', 'forbidden'],
    [403, 'the pairing code was not accepted', 'rejected'], [403, 'unknown', 'protocol'],
    [404, 'missing', 'missing'], [415, 'media', 'protocol'], [429, 'limited', 'throttled'],
    [500, 'unusable credential', 'server'], [503, 'offline', 'offline'], [418, '<script>evil</script>', 'protocol'],
  ]) {
    const { pairing, calls } = fixture([reply(status, body)]);
    pairing.prepare(link);
    await pairing.exchange();
    assert.equal(pairing.state, expected);
    assert.equal(pairing.pending, null);
    assert.equal(calls.length, 1);
  }
});

test('a failed new exchange checks existing access and preserves a still-valid pairing', async () => {
  for (const response of [reply(403, 'the pairing code was not accepted'), reply(503, 'that workspace is offline'), reply(429, 'limited', '10')]) {
    const { pairing, calls } = fixture([paired(), response, paired()]);
    await pairing.check();
    pairing.prepare(link);
    await pairing.exchange();
    assert.equal(pairing.state, 'paired');
    assert.ok(['rejected', 'offline', 'throttled'].includes(pairing.issue));
    assert.equal(calls.filter(([, options]) => options.method === 'POST').length, 1);
    assert.equal(calls.at(-1)[0], '/api/workspaces');
  }
  const { pairing } = fixture([paired(), reply(403, 'the pairing code was not accepted'), unpaired()]);
  await pairing.check(); pairing.prepare(link); await pairing.exchange();
  assert.equal(pairing.state, 'revoked');
  assert.equal(pairing.issue, null);
});

test('malformed successful exchange responses are protocol errors, not lost replies', async () => {
  for (const body of ['not json', null, {}, { device_id: 'phone', scope: 'admin' }]) {
    const { pairing, calls } = fixture([reply(200, body)]);
    pairing.prepare(link);
    await pairing.exchange();
    assert.equal(pairing.state, 'protocol');
    assert.equal(calls.length, 1);
    assert.equal(pairing.busy, false);
  }
});

test('a real fetch deadline and a refused redirect probe safely without repeating POST', async (t) => {
  let mode = 'timeout';
  const requests = [];
  const server = createServer((request, response) => {
    requests.push([request.method, request.url]);
    if (request.url === '/api/workspaces') return response.writeHead(401).end('this device is not paired');
    if (mode === 'redirect') return response.writeHead(302, { Location: '/must-not-follow' }).end();
    // The exchange was admitted but its reply never arrived.
    request.resume();
  });
  t.after(() => { server.closeAllConnections(); server.close(); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = `http://127.0.0.1:${server.address().port}`;
  for (mode of ['timeout', 'redirect']) {
    requests.length = 0;
    const { pairing } = fixture([], { fetch: (path, options) => fetch(address + path, options), timeout: 150 });
    pairing.prepare(link);
    await pairing.exchange();
    assert.equal(pairing.state, 'unknown');
    assert.equal(pairing.busy, false);
    assert.deepEqual(requests, [['POST', '/api/pair'], ['GET', '/api/workspaces']]);
  }
});

test('retry deadline gates both exchange preparation and connection checks', async () => {
  let now = 1000;
  const { pairing, calls } = fixture([reply(429, 'limited', '10'), unpaired()], { now: () => now });
  pairing.prepare(link);
  await pairing.exchange();
  assert.equal(pairing.retryAt, 11000);
  pairing.prepare(link);
  await pairing.check();
  assert.equal(calls.length, 1);
  assert.equal(pairing.state, 'throttled');
  now = 11000;
  await pairing.check();
  assert.equal(pairing.state, 'unpaired');
  assert.equal(retryDelay('garbage'), 60);
  assert.equal(retryDelay('9999999'), 86400);
  assert.equal(retryDelay('Thu, 01 Jan 1970 00:01:00 GMT', 1000), 59);
});

test('cookie refusal, revoked access, reachability, insecure origin and malformed replies are explicit', async () => {
  const { pairing } = fixture([exchanged(), unpaired(), paired(), unpaired(), new Error('offline'), reply(200, 'invalid json')]);
  pairing.prepare(link);
  await pairing.exchange();
  assert.equal(pairing.state, 'cookie-missing');
  await pairing.check(); assert.equal(pairing.state, 'paired');
  await pairing.check(); assert.equal(pairing.state, 'revoked');
  await pairing.check(); assert.equal(pairing.state, 'unreachable');
  await pairing.check(); assert.equal(pairing.state, 'protocol');
  const insecure = fixture([], { origin: 'http://localhost', secure: true });
  insecure.pairing.prepare(link);
  await insecure.pairing.check();
  assert.equal(insecure.pairing.state, 'insecure');
  assert.equal(insecure.calls.length, 0);
});

function cameraFixture(overrides = {}) {
  const states = [];
  const found = [];
  let stopped = 0;
  const stream = { getTracks: () => [{ stop: () => { stopped++; } }] };
  const video = { srcObject: null, readyState: 2, play: async () => {} };
  const timers = [];
  class Detector {
    static async getSupportedFormats() { return ['qr_code']; }
    async detect() { return []; }
  }
  const camera = new PairingCamera({
    media: { getUserMedia: async () => stream }, Detector, video,
    schedule: (callback) => { timers.push(callback); return timers.length; }, unschedule: () => {},
    found: (value) => found.push(value), changed: (state) => states.push(state), ...overrides,
  });
  return { camera, states, found, stream, video, timers, stopped: () => stopped };
}

test('camera support, permission, missing hardware and busy device have manual recovery', async () => {
  const unsupported = cameraFixture({ Detector: undefined });
  await unsupported.camera.start();
  assert.equal(unsupported.states.at(-1), 'unsupported');
  for (const [name, state] of [['NotAllowedError', 'denied'], ['NotFoundError', 'missing'], ['NotReadableError', 'busy']]) {
    const fixture = cameraFixture({ media: { getUserMedia: async () => { throw Object.assign(new Error(), { name }); } } });
    await fixture.camera.start();
    assert.equal(fixture.states.at(-1), state);
    assert.equal(fixture.video.srcObject, null);
  }
});

test('camera cancellation fences permission and decoder results and releases every track', async () => {
  let resolve;
  const permission = new Promise((done) => { resolve = done; });
  const fixture = cameraFixture({ media: { getUserMedia: () => permission } });
  const started = fixture.camera.start();
  await Promise.resolve();
  fixture.camera.stop();
  resolve(fixture.stream);
  await started;
  assert.equal(fixture.stopped(), 1);
  assert.equal(fixture.video.srcObject, null);
  assert.deepEqual(fixture.found, []);

  let decode;
  class Detector {
    static async getSupportedFormats() { return ['qr_code']; }
    detect() { return new Promise((done) => { decode = done; }); }
  }
  const late = cameraFixture({ Detector });
  const scanning = late.camera.start();
  while (!decode) await Promise.resolve();
  late.camera.stop();
  decode([{ format: 'qr_code', rawValue: link }]);
  await scanning;
  assert.deepEqual(late.found, []);
  assert.equal(late.stopped(), 1);
});

test('one decoded QR stops the camera before confirmation; scan failure also releases it', async () => {
  class Detector {
    static async getSupportedFormats() { return ['qr_code']; }
    async detect() { return [{ format: 'qr_code', rawValue: link }]; }
  }
  const fixture = cameraFixture({ Detector });
  await fixture.camera.start();
  assert.deepEqual(fixture.found, [link]);
  assert.equal(fixture.stopped(), 1);
  assert.equal(fixture.timers.length, 0);
  class Broken extends Detector { async detect() { throw new Error('bad frame'); } }
  const broken = cameraFixture({ Detector: Broken });
  await broken.camera.start();
  assert.equal(broken.states.at(-1), 'failed');
  assert.equal(broken.stopped(), 1);
});
