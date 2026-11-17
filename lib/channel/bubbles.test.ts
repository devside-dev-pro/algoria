import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatLiveDm, formatProgDm, inLiveWindow, inProgWindow, isBubbleRow, pendingLive, pendingProg,
  renderBubblesPlanSection, dubaiNow, type BubbleRow,
} from './bubbles';
import { WEEK_BUBBLES, bubbleInsertRows as bubbleRows } from './bubbles.week';

const row = (o: Partial<BubbleRow> & { id: number; scheduled_at: string; report: unknown }): BubbleRow => ({
  day: '2026-11-18', slot: 'bubble1', kind: 'video', text: 'A live day in Dubai', status: 'info', ...o,
});

test('catalog has 24 unique (day, slot) rows, bubble1 to bubble4 only, 18–24 Nov', () => {
  assert.equal(WEEK_BUBBLES.length, 24);
  const keys = WEEK_BUBBLES.map((b) => `${b.day}:${b.slot}`);
  assert.equal(new Set(keys).size, 24);
  assert.ok(WEEK_BUBBLES.every((b) => /^bubble[1-4]$/.test(b.slot)));
  assert.deepEqual([...new Set(WEEK_BUBBLES.map((b) => b.day))], [
    '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24',
  ]);
  const rows = bubbleRows();
  assert.equal(rows.length, 24);
  assert.ok(rows.every((r) => r.kind === 'video' && r.status === 'info' && r.scheduled_at.endsWith('+04')));
  assert.equal(rows.filter((r) => r.day === '2026-11-18').length, 3);
  assert.equal(rows.filter((r) => r.day === '2026-11-19').length, 4);
});

test('PROG window: 09:30–11:00 Dubai on a weekday, 10:00–11:30 on Saturday', () => {
  const wed0930 = Date.parse('2026-11-18T09:30:00+04:00');
  const wed0929 = Date.parse('2026-11-18T09:29:00+04:00');
  const wed1100 = Date.parse('2026-11-18T11:00:00+04:00');
  assert.equal(inProgWindow(dubaiNow(wed0930)), true);
  assert.equal(inProgWindow(dubaiNow(wed0929)), false);
  assert.equal(inProgWindow(dubaiNow(wed1100)), false);
  const sat0959 = Date.parse('2026-11-21T09:59:00+04:00');
  const sat1000 = Date.parse('2026-11-21T10:00:00+04:00');
  assert.equal(inProgWindow(dubaiNow(sat0959)), false);
  assert.equal(inProgWindow(dubaiNow(sat1000)), true);
});

test('LIVE window is the 10 minutes before the slot, not after', () => {
  const at = '2026-11-18T20:35:00+04:00';
  assert.equal(inLiveWindow(at, Date.parse('2026-11-18T20:25:00+04:00')), true);
  assert.equal(inLiveWindow(at, Date.parse('2026-11-18T20:24:00+04:00')), false);
  assert.equal(inLiveWindow(at, Date.parse('2026-11-18T20:35:00+04:00')), false);
});

test('pending PROG/LIVE ignore rows already sent or marked faite', () => {
  const prog = row({
    id: 1, slot: 'bubble1', scheduled_at: '2026-11-18T11:24:00+04:00',
    report: { mode: 'prog', subject: 'A live day in Dubai', duration: '30 s', points: ['A'] },
  });
  const sent = row({ id: 2, slot: 'bubble2', scheduled_at: '2026-11-18T14:22:00+04:00', report: { mode: 'prog', sent_at: 'x' } });
  const live = row({
    id: 3, slot: 'bubble3', scheduled_at: '2026-11-18T20:35:00+04:00',
    report: { mode: 'live', subject: 'Setting up the live, 2 hours before', points: ['Desk'], duration: '30 s' },
  });
  assert.deepEqual(pendingProg([prog, sent, live]).map((r) => r.id), [1]);
  const now = Date.parse('2026-11-18T20:25:00+04:00');
  assert.deepEqual(pendingLive([prog, live], now).map((r) => r.id), [3]);
  assert.deepEqual(pendingLive([row({ ...live, report: { ...(live.report as object), faite: true } })], now), []);
});

test('PROG DM is one message with Faite / Pas cette fois under each bubble', () => {
  const rows = [
    row({
      id: 11, slot: 'bubble1', scheduled_at: '2026-11-18T11:24:00+04:00',
      report: { mode: 'prog', subject: 'A live day in Dubai', duration: '30 s', points: ['Morning', 'Why I still do these lives'] },
    }),
    row({
      id: 12, slot: 'bubble2', scheduled_at: '2026-11-18T14:22:00+04:00',
      report: { mode: 'prog', subject: 'Why I show the product live', duration: '40 s', points: ['An ad shows 20 seconds'] },
    }),
  ];
  const dm = formatProgDm(rows);
  assert.equal(dm.title, '🎥 Bulles à programmer aujourd\'hui');
  assert.equal(dm.buttonRows.length, 2);
  assert.deepEqual(dm.buttonRows[0].map((b) => b.data), ['cmb:ok:11', 'cmb:no:11']);
  assert.ok(dm.buttonRows[0][0].text.includes('Faite'));
  assert.ok(dm.buttonRows[0][1].text.includes('Pas cette fois'));
  assert.match(dm.lines.join('\n'), /11:24/);
  assert.match(dm.lines.join('\n'), /A live day in Dubai/);
});

test('LIVE DM wording and buttons', () => {
  const dm = formatLiveDm(row({
    id: 33, slot: 'bubble3', scheduled_at: '2026-11-18T20:35:00+04:00',
    report: { mode: 'live', subject: 'Setting up the live, 2 hours before', points: ['Show the desk'], duration: '30 s' },
  }));
  assert.match(dm.title, /C'est le moment de faire une bulle/);
  assert.match(dm.lines.join(' '), /Parle de Setting up the live/);
  assert.match(dm.lines.join(' '), /30 s/);
  assert.deepEqual(dm.buttonRows[0].map((b) => b.text), ['✅ Faite', '⏭ Pas cette fois']);
  assert.deepEqual(dm.buttonRows[0].map((b) => b.data), ['cmb:ok:33', 'cmb:no:33']);
});

test('plan section lists tomorrow\'s bubbles and replaces the single video idea', () => {
  const idea = { slot: 'video', kind: 'video', scheduled_at: '2026-11-18T22:30:00+04:00', text: 'How do I connect?', report: {} };
  const b1 = row({
    id: 1, slot: 'bubble1', scheduled_at: '2026-11-18T11:24:00+04:00',
    report: { mode: 'prog', theme: 'Vie à Dubaï', subject: 'A live day in Dubai' },
  });
  const sec = renderBubblesPlanSection([idea, b1]);
  assert.match(sec ?? '', /Bulles de demain/);
  assert.match(sec ?? '', /11:24 · PROG · Vie à Dubaï — A live day in Dubai/);
  assert.equal(renderBubblesPlanSection([idea]), null);
  assert.equal(isBubbleRow(idea), false);
  assert.equal(isBubbleRow(b1), true);
});
