import assert from 'node:assert/strict';
import { test } from 'node:test';
import { destinationFromHash, showDestination } from '../src/app.js';
import { pageTitle } from '../src/accessibility.js';

test('unknown routes and pairing fragments fall back without being displayed', () => {
  for (const hash of ['', '#unknown', '#pair=secret', '#<script>']) assert.equal(destinationFromHash(hash), 'sessions');
  for (const destination of ['sessions', 'attention', 'devices']) assert.equal(destinationFromHash(`#${destination}`), destination);
});

test('navigation exposes exactly one panel and marks the current destination', () => {
  const names = ['sessions', 'attention', 'devices'];
  const panels = names.map((name) => ({ dataset: { panel: name }, hidden: false }));
  const links = names.map((name) => ({
    dataset: { destination: name }, attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
  }));
  const document = { querySelectorAll: (selector) => selector === '[data-panel]' ? panels : links };
  for (const destination of ['devices', 'attention', 'sessions']) {
    showDestination(document, `#${destination}`);
    assert.deepEqual(panels.filter((panel) => !panel.hidden).map((panel) => panel.dataset.panel), [destination]);
    assert.deepEqual(links.filter((link) => link.attributes['aria-current'] === 'page').map((link) => link.dataset.destination), [destination]);
    assert.equal(document.title, `${destination[0].toUpperCase()}${destination.slice(1)} – LocalLink`);
  }
});

test('the page title names the destination, or the open session', () => {
  assert.equal(pageTitle('attention'), 'Attention – LocalLink');
  assert.equal(pageTitle('sessions', 'Accessibility review'), 'Accessibility review – LocalLink');
  assert.equal(pageTitle('unknown'), 'Sessions – LocalLink');
});
