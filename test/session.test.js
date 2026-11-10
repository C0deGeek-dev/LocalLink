import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Sessions } from '../src/session.js';

const origin = 'https://pc.example.test';
const workspace = { id: '0123456789abcdef', label: 'Project A', online: true };
const first = { id: '11111111-1111-4111-8111-111111111111', name: 'First', live: true };
const second = { id: '22222222-2222-4222-8222-222222222222', name: 'Second', live: true };
const ask = { ask_id: 'ask-1', tool: 'shell', detail: 'echo hello', risk: 'Run a command', expires_at_ms: 99999999 };

test('healthy unknown mirror stays attached beyond the deadline and later authoritative state recovers', async () => {
  for (const recovery of ['snapshot', 'turn_started', 'stopped']) {
    const f = fixture(); await f.attach();
    f.model.setDraft('Keep this');
    const history = f.model.history, synced = f.model.synced;
    f.emit({ type: 'resync_required', epoch: 'next' });
    const deadline = [...f.timers.values()].at(-1);
    f.emit(f.snapshot({ epoch: 'next', turn: 'unknown', history: [] }));
    deadline();
    assert.equal(f.model.phase, 'syncing'); assert.equal(f.model.canControl, false);
    assert.equal(f.model.connection, f.connections[0]);
    assert.equal(f.model.history, history); assert.equal(f.model.synced, synced);
    assert.equal(f.model.draft, 'Keep this');
    if (recovery === 'snapshot') f.emit(f.snapshot({ epoch: 'next', history: [{ role: 'user', text: 'Caught up' }] }));
    else f.emit({ type: recovery }, { seq: 6 });
    assert.equal(f.model.ready, true); assert.equal(f.model.canControl, true);
    assert.equal(f.model.viewStale, recovery !== 'snapshot');
  }
});

test('unknown snapshot retains authoritative pending asks read-only instead of hiding a blocked PC request', async () => {
  const f = fixture(); await f.attach({ turn: 'unknown', history: [], asks: [ask] });
  assert.deepEqual(f.model.asks, [ask]);
  f.model.openApproval(ask.ask_id);
  assert.equal(f.model.approval.ask_id, ask.ask_id);
  assert.equal(f.model.canApprove, false);
  f.model.answerApproval(true);
  assert.deepEqual(f.connections[0].sent, []);
  f.emit({ type: 'stopped' }, { seq: 6 });
  assert.equal(f.model.canApprove, true);
  assert.equal(f.model.viewStale, true);
});

test('reconnect retains the old view but replaces cursor, asks and admission before controls unlock', async () => {
  const f = fixture(); await f.attach({ asks: [ask] });
  f.model.setDraft('Unsent draft'); f.model.openApproval(ask.ask_id);
  f.model.submit('Unsent draft'); f.connections[0].onclose();
  const before = f.model.synced;
  f.model.attach(first.id);
  assert.equal(f.model.history[0].text, 'Earlier'); assert.equal(f.model.synced, before);
  assert.equal(f.model.canControl, false); assert.equal(f.model.canApprove, false);
  assert.equal(f.model.viewStale, true); assert.equal(f.model.draft, 'Unsent draft');
  assert.match(f.model.outcomeIssue, /Outcome unknown/);
  const url = new URL(f.connections[1].url);
  assert.equal(url.searchParams.has('epoch'), false); assert.equal(url.searchParams.has('seq'), false);
  f.emit({ type: 'attached', session_id: first.id, epoch: 'new', capabilities: ['acks', 'resume'] });
  assert.equal(f.model.canControl, false);
  f.emit(f.snapshot({ epoch: 'new', seq: 1, asks: [], history: [{ role: 'assistant', text: 'After reconnect' }] }));
  assert.equal(f.model.canControl, true); assert.equal(f.model.canApprove, false);
  assert.equal(f.model.approval.state, 'unavailable'); assert.equal(f.model.seq, 1);
  assert.equal(f.model.history[0].text, 'After reconnect');
  assert.deepEqual(f.connections[1].sent, []); // no replay; no optional catalogue
});

test('old installed client/new server and new client/old server refuse before any action', async () => {
  for (const [supported, serverWire, issue] of [
    [{ min: 1, max: 1, required_capabilities: ['acks', 'resume'] }, 2, 'new-server'],
    [{ min: 2, max: 2, required_capabilities: ['acks', 'resume'] }, 1, 'old-server'],
  ]) {
    const f = fixture('control', supported);
    await f.model.list(workspace.id); f.model.attach(first.id);
    f.connections[0].onmessage({ data: JSON.stringify({ v: serverWire, event: { type: 'attached', session_id: first.id,
      server_version: serverWire === 1 ? '0.1.0' : '2.0.0', epoch: 'epoch', capabilities: ['acks', 'resume', 'commands'] } }) });
    f.model.submit('must not run'); f.model.stop();
    assert.equal(f.model.phase, 'incompatible'); assert.equal(f.model.compatibility, issue);
    assert.deepEqual(f.connections[0].sent, []);
  }
  const f = fixture(); await f.model.list(workspace.id); f.model.attach(first.id);
  f.emit({ type: 'attached', session_id: first.id, epoch: 'epoch', server_version: '0.0.1', capabilities: ['acks'] });
  assert.equal(f.model.compatibility, 'old-server'); assert.deepEqual(f.connections[0].sent, []);
});

test('compatible newer product release and additive capabilities retain the wire contract', async () => {
  const f = fixture(); await f.model.list(workspace.id); f.model.attach(first.id);
  f.emit({ type: 'attached', session_id: first.id, epoch: 'epoch', server_version: '99.0.0', capabilities: ['acks', 'resume', 'future'] });
  f.emit(f.snapshot());
  assert.equal(f.model.canControl, true); assert.equal(f.model.serverVersion, '99.0.0');
  assert.deepEqual(f.connections[0].sent, []);
});

test('approval waits for correlated ack, prevents double taps and handles resolution-before-ack', async () => {
  const f = fixture(); await f.attach({ asks: [ask] });
  f.model.openApproval(ask.ask_id); f.model.answerApproval(true); f.model.answerApproval(false);
  const replies = f.connections[0].sent.filter((record) => record.command.type === 'permission_reply');
  assert.equal(replies.length, 1); assert.equal(f.model.approval.state, 'submitting');
  f.emit({ type: 'permission_resolved', ask_id: ask.ask_id, outcome: 'allowed', by: { kind: 'device', id: 'other' } }, { seq: 6 });
  assert.equal(f.model.approval.state, 'submitting');
  f.emit({ type: 'accepted' }, { id: replies[0].id });
  assert.equal(f.model.approval.state, 'resolved'); assert.equal(f.model.approval.allow, true);
});

test('approval races, expiry, unknown outcomes and unavailable asks never replay', async () => {
  for (const [code, state] of [['already_resolved', 'elsewhere'], ['expired', 'expired'], ['unknown_ask', 'unavailable'], ['outcome_unknown', 'unknown'], ['forbidden', 'refused']]) {
    const f = fixture(); await f.attach({ asks: [ask] });
    f.model.openApproval(ask.ask_id); f.model.answerApproval(false);
    const id = f.connections[0].sent.at(-1).id;
    f.emit({ type: 'rejected', code, message: 'PC refusal' }, { id });
    assert.equal(f.model.approval.state, state); assert.equal(f.model.canApprove, false);
    f.model.answerApproval(true);
    assert.equal(f.connections[0].sent.filter((r) => r.command.type === 'permission_reply').length, 1);
  }
});

test('approval deadline, observe scope, stale epoch, resync and disconnect lock answers', async () => {
  for (const scope of ['observe', null]) {
    const f = fixture(scope); await f.attach({ asks: [ask] }); f.model.openApproval(ask.ask_id);
    assert.equal(f.model.canApprove, false);
  }
  const f = fixture(); await f.attach({ asks: [{ ...ask, expires_at_ms: 1 }] }); f.model.openApproval(ask.ask_id);
  assert.equal(f.model.canApprove, false);
  f.model.approval = null; f.model.asks = [ask]; f.model.openApproval(ask.ask_id);
  f.emit({ type: 'resync_required', epoch: 'new' }); assert.equal(f.model.canApprove, false);
  f.emit(f.snapshot({ epoch: 'new', asks: [ask] })); assert.equal(f.model.canApprove, true);
  f.model.approval = null; f.model.openApproval(ask.ask_id); f.model.answerApproval(true);
  f.connections[0].onclose(); assert.equal(f.model.approval.state, 'unknown'); assert.equal(f.model.canApprove, false);
});

test('an unchanged approval survives unknown and full snapshots across epochs; changed detail locks it', async () => {
  const f = fixture(); await f.attach({ asks: [ask] }); f.model.openApproval(ask.ask_id);
  f.emit({ type: 'resync_required', epoch: 'X' });
  f.emit(f.snapshot({ epoch: 'X', turn: 'unknown', history: [], asks: [] }));
  assert.equal(f.model.approval.state, 'pending'); assert.equal(f.model.canApprove, false);
  f.emit({ type: 'resync_required', epoch: 'Y' });
  f.emit(f.snapshot({ epoch: 'Y', asks: [ask] }));
  assert.equal(f.model.approval.epoch, 'Y'); assert.equal(f.model.canApprove, true);
  f.emit({ type: 'asks_resync', asks: [{ ...ask, detail: 'different command' }] }, { seq: 6 });
  assert.equal(f.model.approval.state, 'unavailable'); assert.equal(f.model.canApprove, false);
});

test('approval ack before feed remains resolved and unknown refusal stays disclosed after reattach', async () => {
  const f = fixture(); await f.attach({ asks: [ask] }); f.model.openApproval(ask.ask_id); f.model.answerApproval(false);
  f.emit({ type: 'accepted' }, { id: f.connections[0].sent.at(-1).id });
  f.emit({ type: 'permission_resolved', ask_id: ask.ask_id, outcome: 'denied' }, { seq: 6 });
  assert.equal(f.model.approval.state, 'resolved');
  f.model.approval = null; f.model.asks = [ask]; f.model.openApproval(ask.ask_id); f.model.answerApproval(true);
  f.emit({ type: 'rejected', code: 'outcome_unknown', message: 'Unknown' }, { id: f.connections[0].sent.at(-1).id });
  assert.match(f.model.outcomeIssue, /Approval outcome unknown/);
  f.model.attach(first.id); assert.match(f.model.outcomeIssue, /Approval outcome unknown/);
});
function fixture(scope = 'control', supported) {
  const connections = [], timers = new Map(), requests = [];
  let clock = 0;
  const model = new Sessions({
    origin, supported, changed() {}, now: () => ++clock,
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
