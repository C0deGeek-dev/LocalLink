import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composerKey } from '../src/session-view.js';

test('composer keys: Ctrl/Cmd+Enter sends everywhere, Enter only with a keyboard, never while composing', () => {
  const key = (extra) => ({ key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, ...extra });
  for (const [event, coarse, expected] of [
    [key(), false, 'send'],
    [key({ shiftKey: true }), false, 'default'],
    [key({ ctrlKey: true }), false, 'send'],
    [key({ metaKey: true }), true, 'send'],
    [key(), true, 'default'],
    [key({ shiftKey: true }), true, 'default'],
    [key({ isComposing: true, ctrlKey: true }), false, 'default'],
    [key({ key: 'a' }), false, 'default'],
  ]) assert.equal(composerKey(event, coarse), expected, JSON.stringify([event, coarse]));
});
