import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replyAnnouncer } from '../src/accessibility.js';
import { mountTheme } from '../src/theme.js';

test('a streamed reply announces completion once and reconnect never announces old text', () => {
  let mutations = 0;
  let text = '';
  const node = { get textContent() { return text; }, set textContent(value) { text = value; mutations++; } };
  const announce = replyAnnouncer(node);
  const model = { key: 'project/session', ready: true, busy: true, turn: 'running' };
  announce(model);
  for (let i = 0; i < 200; i++) announce(model);
  assert.equal(mutations, 0);
  announce({ ...model, busy: false, turn: 'idle' });
  for (let i = 0; i < 20; i++) announce({ ...model, busy: false, turn: 'idle' });
  assert.equal(mutations, 1);
  assert.match(text, /Reply finished/);
  announce({ ...model, ready: false });
  announce({ ...model, busy: false, turn: 'idle' });
  assert.equal(text, '');
  announce({ ...model, key: 'another/session', busy: false, turn: 'idle' });
  assert.equal(text, '');
});

function themeFixture({ saved = null, blocked = false } = {}) {
  const events = {}, attributes = {};
  const select = { value: '', addEventListener: (name, callback) => { events[name] = callback; } };
  const metas = [{ media: '(prefers-color-scheme: light)' }, { media: '(prefers-color-scheme: dark)' }];
  const document = { getElementById: () => select, querySelectorAll: () => metas,
    documentElement: { setAttribute: (name, value) => { attributes[name] = value; }, removeAttribute: (name) => { delete attributes[name]; } } };
  const storage = new Map(saved ? [['locallink-appearance', saved]] : []);
  const access = () => { if (blocked) throw new Error('Storage blocked'); };
  const window = { addEventListener: (name, callback) => { events[name] = callback; },
    get localStorage() { access(); return { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) }; } };
  mountTheme(document, window);
  return { select, metas, attributes, storage, events };
}

test('theme defaults to system, restores only valid appearance and supports cross-tab changes', () => {
  const fixture = themeFixture();
  const { select, events, attributes, storage, metas } = fixture;
  assert.equal(select.value, 'system'); assert.equal(attributes['data-theme'], undefined);
  select.value = 'dark'; events.change();
  assert.equal(attributes['data-theme'], 'dark');
  assert.deepEqual(metas.map((meta) => meta.content), ['#1c2422', '#1c2422']);
  assert.equal(storage.get('locallink-appearance'), 'dark');
  events.storage({ key: 'unrelated', newValue: 'light' });
  assert.equal(select.value, 'dark');
  events.storage({ key: 'locallink-appearance', newValue: 'light' });
  assert.equal(select.value, 'light');
  select.value = 'system'; events.change();
  assert.equal(attributes['data-theme'], undefined); assert.equal(storage.size, 0);
  assert.deepEqual(metas.map((meta) => meta.content), ['#f5f3ec', '#1c2422']);
  assert.equal(themeFixture({ saved: 'dark' }).select.value, 'dark');
  assert.equal(themeFixture({ saved: 'invalid' }).select.value, 'system');
});

test('blocked appearance storage still allows a manual choice in the current page', () => {
  const { select, events, attributes } = themeFixture({ blocked: true });
  select.value = 'light'; events.change();
  assert.equal(attributes['data-theme'], 'light');
});
