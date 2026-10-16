// Personal themes and notice views use synthetic catalogue data, without a browser or listening port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../public/js/store.js';
import { createDataStore } from '../../public/js/data.js';
import { createCosmeticLayers } from '../../public/js/assets.js';
import { installContent, catalog, personal, setPersonalPlugin } from '../../public/js/content.js';
import { noticeView, markSeen } from '../../shared/plugins/notices.js';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('personal theme switches apply by id, restore the previous winner and defaults, and send nothing', async () => {
  const previousDoc = globalThis.document;
  const values = new Map();
  globalThis.document = { documentElement: { style: {
    setProperty: (name, value) => values.set(name, value), removeProperty: (name) => values.delete(name),
  } } };
  const entries = [
    { id: 'z-night', class: 'cosmetic', status: 'loaded', scope: ['personal'], loadBefore: ['a-day'], theme: { vars: { '--text-hi': '#abc', '--line': '#123' } } },
    { id: 'a-day', class: 'cosmetic', status: 'loaded', scope: ['personal'], theme: { vars: { '--text-hi': '#fff' } } },
    { id: 'room-only', class: 'cosmetic', status: 'loaded', scope: ['room'], theme: { vars: { '--bg-0': '#fff' } } },
  ];
  const asked = [];
  const fetch = async (url) => { asked.push(url); return { ok: true, json: async () => ({ plugins: entries }) }; };
  catalog.set({ status: 'idle', plugins: [], at: 0 });
  personal.set({ ids: [] });
  const app = createStore({ installedPlugins: 3, room: null });
  let off;
  try {
    off = installContent({ store: app, data: createDataStore({ fetch }), layers: createCosmeticLayers(), fetch });
    assert.deepEqual(asked, []);
    personal.set({ ids: ['a-day', 'z-night', 'room-only'] });
    await settle();
    assert.equal(values.get('--text-hi'), '#abc', 'id order wins even against loadBefore');
    assert.equal(values.get('--line'), '#123');
    assert.equal(values.has('--bg-0'), false, 'a room theme is never applied');
    setPersonalPlugin('z-night', false);
    await settle();
    assert.equal(values.get('--text-hi'), '#fff');
    assert.equal(values.has('--line'), false);
    personal.set({ ids: [] });
    assert.equal(values.size, 0, 'the last switch off restores root defaults synchronously');
    assert.deepEqual(asked, ['/plugins/index.json'], 'theme-only plugins fetch no overlay and send no intent');
  } finally {
    off?.(); personal.set({ ids: [] }); catalog.set({ status: 'idle', plugins: [], at: 0 });
    if (previousDoc === undefined) delete globalThis.document; else globalThis.document = previousDoc;
  }
});

test('notice popup data: absent on vanilla, newest first, translated, plain text and unread persisted', () => {
  assert.deepEqual(noticeView([], 'en', new Set()), { notices: [], unread: false });
  const plugins = [
    { id: 'one', name: 'One', status: 'loaded', notices: [
      { id: 'old', title: 'Old', body: 'Older', date: '2025-01-01' },
      { id: 'new', title: 'New', body: 'First\n<b>literal</b> https://example.test', date: '2026-10-17', i18n: { ja: { title: 'Translated', body: 'Line one\nLine two' } } },
    ] },
    { id: 'off', status: 'disabled', notices: [{ id: 'off', title: 'Hidden', body: 'Hidden' }] },
  ];
  const view = noticeView(plugins, 'ja', new Set());
  assert.deepEqual(view.notices.map((n) => n.id), ['new', 'old']);
  assert.equal(view.notices[0].title, 'Translated');
  assert.equal(view.notices[0].pluginName, 'One');
  assert.equal(noticeView(plugins, 'zh', new Set()).notices[0].body, 'First\n<b>literal</b> https://example.test');
  let saved;
  const storage = { getItem: () => saved ?? null, setItem: (_key, value) => { saved = value; } };
  const seen = markSeen(view.notices.map((n) => n.key), storage);
  assert.equal(noticeView(plugins, 'ja', seen).unread, false);
  assert.deepEqual(JSON.parse(saved), ['one/new', 'one/old']);
});
