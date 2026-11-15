import assert from 'node:assert/strict';
import { test } from 'node:test';
import { saveUpdateState, takeUpdateState } from '../src/update-state.js';

const id = '0123456789abcdef/11111111-1111-4111-8111-111111111111';
function fixture() {
  const values = new Map();
  const browser = { sessionStorage: { setItem: (k, v) => values.set(k, v), getItem: (k) => values.get(k), removeItem: (k) => values.delete(k) } };
  const sessions = { key: id, drafts: new Map([[id, 'Unsent message']]), pending: new Map([['action', {}]]), history: [{ text: 'Private transcript' }], credential: 'never-store-this' };
  return { values, browser, sessions };
}
test('update handoff retains only per-tab drafts, active identity and unknown-action flag, and is consumed once', () => {
  const f = fixture(); assert.equal(saveUpdateState(f.browser, f.sessions), true);
  const raw = [...f.values.values()][0]; assert.doesNotMatch(raw, /Private transcript|credential|never-store-this/);
  assert.deepEqual(takeUpdateState(f.browser), { drafts: [[id, 'Unsent message']], active: id, uncertain: true });
  assert.equal(f.values.size, 0); assert.equal(takeUpdateState(f.browser), null);
});
test('invalid handoff is deleted and blocked storage defers a reload with unsent or unconfirmed input', () => {
  const f = fixture();
  f.values.set('locallink-update-drafts', '{broken'); assert.equal(takeUpdateState(f.browser), null); assert.equal(f.values.size, 0);
  f.values.set('locallink-update-drafts', JSON.stringify({ drafts: [['invalid', 'draft']], active: id, uncertain: false }));
  assert.equal(takeUpdateState(f.browser), null);
  const blocked = { get sessionStorage() { throw new Error('blocked'); } };
  assert.equal(saveUpdateState(blocked, f.sessions), false);
  f.sessions.drafts.clear(); f.sessions.pending.clear(); assert.equal(saveUpdateState(blocked, f.sessions), true);
});
