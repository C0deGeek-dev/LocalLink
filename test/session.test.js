import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Sessions } from '../src/session.js';

const origin = 'https://pc.example.test';
const workspace = { id: '0123456789abcdef', label: 'Project A', online: true };
const first = { id: '11111111-1111-4111-8111-111111111111', name: 'First', live: true };
const second = { id: '22222222-2222-4222-8222-222222222222', name: 'Second', live: true };
function fixture(scope = 'control') {
  const connections = [], timers = new Map(), requests = [];
  let clock = 0;
  const model = new Sessions({
    origin, changed() {}, now: () => ++clock,
    schedule(fn) { const key = ++clock; timers.set(key, fn); return key; },
    unschedule(key) { timers.delete(key); },
    fetch: async (...args) => { requests.push(args); return { ok: true, status: 200, json: async () => ({ sessions: [first, second] }) }; },
    socket(url) {
      const socket = { url, sent: [], close() {}, send(data) { this.sent.push(JSON.parse(data)); } };
      connections.push(socket); return socket;
    },
  });
  model.access(scope, [workspace]);
  const emit = (event, extra = {}, socket = connections.at(-1)) => socket.onmessage({ data: JSON.stringify({ v: 1, event, ...extra }) });
  const snapshot = (overrides = {}) => ({ type: 'snapshot', epoch: 'epoch', seq: 5, turn: 'idle', busy: false, queued: 0,
    history: [{ role: 'user', text: 'Earlier' }], asks: [], plan: [], ...overrides });
  async function attach(overrides = {}) {
    await model.list(workspace.id); model.attach(first.id);
    emit({ type: 'attached', session_id: first.id, epoch: 'epoch', capabilities: ['acks', 'resume', 'commands'] });
    assert.equal(model.canControl, false);
    emit(snapshot(overrides));
  }
  function catalogue() {
    emit({ type: 'commands', items: [
      { name: 'clear', description: 'Clear', args: 'none', scope: 'control' },
      { name: 'name', description: 'Rename', args: 'required', scope: 'control' },
      { name: 'effort', description: 'Effort', args: 'optional', scope: 'control' },
    ] }, { id: model.catalogueId });
  }
  return { model, connections, emit, snapshot, attach, catalogue, timers, requests };
}

test('existing sessions are explicitly selected through same-origin WSS and snapshot gates controls', async () => {
  const f = fixture();
  await f.model.list(workspace.id);
  assert.equal(f.connections.length, 0);
  f.model.attach(first.id);
  assert.equal(f.model.canSubmit, false);
  assert.equal(f.connections[0].url, `${origin.replace('https:', 'wss:')}/api/socket?workspace=${workspace.id}&session=${first.id}`);
  f.emit({ type: 'attached', session_id: first.id, epoch: 'epoch', capabilities: ['acks', 'resume', 'commands'] });
  assert.equal(f.model.canSubmit, false);
  f.emit(f.snapshot());
  assert.equal(f.model.canSubmit, true);
  assert.deepEqual(f.connections[0].sent.map((record) => record.command.type), ['commands']);
  assert.equal(f.requests[0][1].credentials, 'same-origin');
  assert.equal(f.requests[0][1].redirect, 'error');
});

test('observe, missing scope, unknown turn and incompatible attach all lock mutations', async () => {
  for (const scope of ['observe', null, 'invented']) {
    const f = fixture(scope); await f.attach();
    f.model.submit('hello'); f.model.stop();
    assert.equal(f.model.canControl, false);
    assert.equal(f.connections[0].sent.length, 1);
  }
  const f = fixture(); await f.attach({ turn: 'unknown', busy: true });
  assert.equal(f.model.canSubmit, false); assert.equal(f.model.canStop, false);
  f.model.attach(first.id);
  f.emit({ type: 'attached', session_id: second.id, epoch: 'epoch', capabilities: ['acks', 'resume'] });
  assert.equal(f.model.phase, 'incompatible');
});

test('stream projection applies tools, plans, asks and text; sequence gaps alone are valid', async () => {
  const f = fixture(); await f.attach({ turn: 'running', busy: true, turn_text: 'Current' });
  const live = (event, seq) => f.emit(event, { seq });
  live({ type: 'text_delta', text: ' answer' }, 7);
  live({ type: 'text_delta', text: ' duplicate' }, 7);
  live({ type: 'tool_started', id: 'tool-1', name: 'read' }, 10);
  live({ type: 'tool_finished', id: 'tool-1', name: 'read', output: '<script>literal</script>', is_error: false }, 11);
  live({ type: 'plan', steps: [{ title: 'Read', status: 'done' }] }, 12);
  live({ type: 'permission_ask', ask_id: 'ask-1', tool: 'shell' }, 13);
  assert.equal(f.model.asks.length, 1);
  live({ type: 'permission_resolved', ask_id: 'ask-1' }, 14);
  live({ type: 'stopped', reason: 'complete' }, 15);
  assert.equal(f.model.entries[0].text, 'Current answer');
  assert.equal(f.model.entries[1].output, '<script>literal</script>');
  assert.equal(f.model.plan[0].title, 'Read');
  assert.equal(f.model.asks.length, 0);
  assert.equal(f.model.canStop, false);
});

test('held and rejected inputs keep drafts; explicit accepted or queued acknowledgements clear only the submitted draft', async () => {
  const f = fixture(); await f.attach();
  f.model.setDraft('Hello'); f.model.submit(f.model.draft); f.model.submit(f.model.draft);
  assert.equal(f.model.draft, 'Hello');
  const sent = f.connections[0].sent.filter((record) => record.command.type === 'prompt');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].command.disposition, 'immediate');
  f.emit({ type: 'rejected', code: 'busy', message: 'Busy' }, { id: sent[0].id });
  assert.equal(f.model.draft, 'Hello'); assert.match(f.model.notice, /Not accepted/);
  f.emit({ type: 'turn_started' }, { seq: 6 });
  f.model.submit(f.model.draft);
  const queued = f.connections[0].sent.at(-1);
  assert.equal(queued.command.disposition, 'follow_up');
  f.model.setDraft('Next draft');
  f.emit({ type: 'queued', disposition: 'follow_up' }, { id: queued.id });
  assert.equal(f.model.draft, 'Next draft');
  assert.match(f.model.notice, /queued/);
});

test('catalogue drives typed slash invocation, argument validation and busy gating without prompt fallback', async () => {
  const f = fixture(); await f.attach(); f.catalogue();
  for (const value of ['/unknown hello', '/name', '/clear extra']) f.model.submit(value);
  assert.equal(f.connections[0].sent.length, 1);
  f.model.setDraft('/name Better'); f.model.submit(f.model.draft);
  const command = f.connections[0].sent.at(-1);
  assert.deepEqual(command.command, { type: 'run_command', name: 'name', args: 'Better' });
  f.emit({ type: 'turn_started' }, { seq: 6 });
  f.emit({ type: 'command_result', name: 'name', message: 'Renamed' }, { id: command.id });
  assert.equal(f.model.busy, true, 'command completion cannot end a turn');
  assert.equal(f.model.draft, '');
  f.model.submit('/clear'); assert.equal(f.connections[0].sent.length, 2);
  f.model.submit('/effort high'); assert.equal(f.connections[0].sent.at(-1).command.type, 'run_command');
  assert.equal(f.connections[0].sent.some((record) => record.command.type === 'prompt'), false);
});

test('lost mutation reply, send failure and timeout never replay and disclose unknown outcome', async () => {
  for (const mode of ['close', 'timeout', 'send-error']) {
    const f = fixture(); await f.attach();
    f.model.setDraft('Once');
    if (mode === 'send-error') f.connections[0].send = () => { throw new Error('gone'); };
    f.model.submit(f.model.draft);
    if (mode === 'close') f.connections[0].onclose();
    if (mode === 'timeout') [...f.timers.values()].at(-1)();
    assert.equal(f.model.phase, 'disconnected');
    assert.equal(f.model.canSubmit, false);
    assert.equal(f.model.draft, 'Once'); assert.match(f.model.notice, /Outcome unknown/);
    f.model.attach(first.id);
    assert.equal(f.connections[1].sent.length, 0, 'reattach never resends a mutation');
  }
});

test('Stop can interrupt an unacknowledged input but does not declare the turn stopped', async () => {
  const f = fixture(); await f.attach({ turn: 'running', busy: true });
  f.model.setDraft('Later'); f.model.submit(f.model.draft);
  f.model.stop(); f.model.stop();
  const cancel = f.connections[0].sent.filter((record) => record.command.type === 'cancel');
  assert.equal(cancel.length, 1);
  f.emit({ type: 'accepted' }, { id: cancel[0].id });
  assert.equal(f.model.busy, true);
  assert.match(f.model.notice, /Waiting for the turn to end/);
});

test('late accepted and queued outcomes never overwrite a completed turn or its plan', async () => {
  for (const type of ['accepted', 'queued']) {
    const f = fixture(); await f.attach();
    f.model.setDraft('Fast turn'); f.model.submit(f.model.draft);
    const sent = f.connections[0].sent.at(-1);
    f.emit({ type: 'turn_started' }, { seq: 6 });
    assert.equal(f.model.plan.length, 0);
    f.emit({ type: 'stopped', reason: 'complete' }, { seq: 7 });
    f.emit({ type, disposition: 'follow_up' }, { id: sent.id });
    assert.equal(f.model.turn, 'idle'); assert.equal(f.model.busy, false);
    assert.equal(f.model.canStop, false); assert.equal(f.model.canSubmit, true);
    assert.equal(f.model.draft, '');
  }
});

test('switching session fences late socket events and replies and keeps drafts separate', async () => {
  const f = fixture(); await f.attach();
  f.model.setDraft('First draft'); const old = f.connections[0];
  f.model.attach(second.id);
  f.emit({ type: 'snapshot', epoch: 'epoch', seq: 100 }, {}, old);
  old.onclose();
  assert.equal(f.model.phase, 'connecting');
  assert.equal(f.model.draft, '');
  f.model.setDraft('Second draft');
  f.model.attach(first.id);
  assert.equal(f.model.draft, 'First draft');
});

test('late listings cannot overwrite the selected workspace and revoked listing removes access', async () => {
  const f = fixture();
  let finish;
  f.model.fetch = () => new Promise((resolve) => { finish = resolve; });
  const old = f.model.list(workspace.id);
  f.model.access('control', [workspace, { ...workspace, id: 'fedcba9876543210', label: 'Project B' }]);
  const finishOld = finish;
  const current = f.model.list('fedcba9876543210');
  finishOld({ ok: true, status: 200, json: async () => ({ sessions: [first] }) }); await old;
  assert.equal(f.model.items.length, 0);
  finish({ status: 401 }); await current;
  assert.equal(f.model.phase, 'unpaired'); assert.equal(f.model.scope, null);
});

test('resync locks controls until a fresh snapshot and session closure remains terminal', async () => {
  const f = fixture(); await f.attach();
  f.emit({ type: 'resync_required', epoch: 'new', seq: 0 });
  assert.equal(f.model.canSubmit, false);
  f.emit({ type: 'text_delta', text: 'stale' }, { seq: 6 });
  assert.equal(f.model.entries.length, 0);
  f.emit(f.snapshot({ epoch: 'new', seq: 1 })); assert.equal(f.model.canSubmit, true);
  f.emit({ type: 'session_closed', reason: 'terminal closed' }, { seq: 2 });
  assert.equal(f.model.phase, 'closed');
  f.emit(f.snapshot({ epoch: 'new', seq: 3 })); assert.equal(f.model.phase, 'closed');
});

test('relay boundary snapshots own their epoch, preserve the view through unknown state and use snapshot admission', async () => {
  const f = fixture(); await f.attach({ history: [{ role: 'assistant', text: 'First answer' }], turn_text: 'First answer' });
  assert.equal(f.model.entries.length, 0, 'idle turn text already belongs to stored history');
  f.emit({ type: 'resync_required', epoch: 'begin-2', seq: 23 });
  const oldDeadline = [...f.timers.values()].at(-1);
  f.emit(f.snapshot({ epoch: 'begin-2', seq: 24, turn: 'unknown', busy: false, history: [], history_truncated: true }));
  assert.equal(f.model.phase, 'syncing'); assert.equal(f.model.canSubmit, false);
  assert.equal(f.model.history[0].text, 'First answer'); assert.equal(f.model.viewStale, true);
  f.emit({ type: 'resync_required', epoch: 'install-2', seq: 25 });
  oldDeadline();
  assert.equal(f.model.phase, 'syncing', 'an earlier resync deadline cannot retire a newer wait');
  f.emit(f.snapshot({ epoch: 'newer-install', seq: 26, busy: true, turn: 'running', turn_text: 'Second answer', history: [{ role: 'assistant', text: 'First answer' }] }));
  assert.equal(f.model.phase, 'ready'); assert.equal(f.model.epoch, 'newer-install');
  assert.equal(f.model.canStop, true); assert.equal(f.model.busy, true);
  assert.equal(f.model.viewStale, false); assert.equal(f.model.entries[0].text, 'Second answer');
  f.emit({ type: 'stopped', reason: 'complete' }, { seq: 38 });
  f.emit({ type: 'resync_required', epoch: 'begin-3', seq: 39 });
  f.emit(f.snapshot({ epoch: 'begin-3', seq: 39, turn: 'unknown', history: [] }));
  f.emit({ type: 'resync_required', epoch: 'install-3', seq: 40 });
  f.emit(f.snapshot({ epoch: 'another-newer', seq: 41, history: [{ role: 'assistant', text: 'Second answer' }], turn_text: 'Second answer' }));
  assert.equal(f.model.phase, 'ready'); assert.equal(f.model.canSubmit, true);
  assert.equal(f.model.entries.length, 0); assert.equal(f.model.history.at(-1).text, 'Second answer');
  assert.equal(f.connections[0].sent.filter((record) => record.command.type === 'commands').length, 1, 'catalogue requested once per attach');
});

test('a retired attachment deadline cannot close a replacement session', async () => {
  const f = fixture(); await f.attach();
  f.emit({ type: 'resync_required', epoch: 'other', seq: 6 });
  const late = [...f.timers.values()].at(-1);
  f.model.attach(second.id); late();
  assert.equal(f.model.phase, 'connecting');
});

test('authoritative completion clears stale action notices but preserves unknown-outcome explanations', async () => {
  const f = fixture(); await f.attach({ turn: 'running', busy: true });
  f.model.stop();
  f.emit({ type: 'accepted' }, { id: f.connections[0].sent.at(-1).id });
  assert.match(f.model.notice, /Waiting for the turn/);
  f.emit({ type: 'stopped', reason: 'cancelled' }, { seq: 6 });
  assert.equal(f.model.notice, '');
  f.model.setDraft('Ambiguous'); f.model.submit(f.model.draft); f.connections[0].onclose();
  f.model.attach(first.id);
  f.emit({ type: 'attached', session_id: first.id, epoch: 'new', capabilities: ['acks', 'resume'] });
  f.emit(f.snapshot({ epoch: 'new' }));
  f.emit({ type: 'warning', message: 'A separate warning' }, { seq: 6 });
  assert.match(f.model.outcomeIssue, /Outcome unknown/);
  assert.equal(f.model.notice, 'A separate warning');
});
