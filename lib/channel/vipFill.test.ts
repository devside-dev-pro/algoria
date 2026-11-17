import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Trade } from './recap';
import {
  fillFromTrades, fillVipTemplate, fillsFromWin, hasVipPlaceholders, pickBestWinsOfWeek, pickLastWinOfDay,
  recapWeekOf, usd, vipTemplateOf,
} from './vipFill';

const t = (o: Partial<Trade> & { ticket: string; closed_at: string; pnl: number; lot?: number }): Trade => ({
  symbol: 'XAUUSD', lot: o.lot ?? 1, strategy: 2, direction: 'long', entry: 2600, exit: 2610, reason: 'tp',
  ...o,
});

const NOW = Date.parse('2026-11-21T18:00:00Z');

// 1 lot, +2000 $ → +200 $ à 0.10 lot ; 1 lot, +180 $ → +18.00 $ à 0.10 lot (seuil 150 $ à 1 lot)

test('usd formats like the rest of the channel', () => {
  assert.equal(usd(148), '+$148');
  assert.equal(usd(14.8), '+$14.80');
  assert.equal(usd(-20.5), '−$20.50');
});

test('fillVipTemplate keeps English punctuation, italicises the risk line, does not double +$', () => {
  const raw = 'What the VIP got: +$[X] at [lot] lot on gold. Want the next one on your account? *Trading involves risk. Past results don\'t guarantee future results.*';
  const out = fillVipTemplate(raw, { X: '+$182', lot: '0.10' });
  assert.ok(out);
  assert.match(out!, /\+\$182 at 0\.10 lot/);
  assert.match(out!, /account\?/);
  assert.doesNotMatch(out!, /account \?/);
  assert.doesNotMatch(out!, /\+\$\+\$/);
  assert.match(out!, /<i>Trading involves risk\. Past results don't guarantee future results\.<\/i>/);
  assert.equal(hasVipPlaceholders(out), false);
});

test('fillVipTemplate returns null when a requested placeholder is missing', () => {
  assert.equal(fillVipTemplate('+$[X] and +$[Y]', { X: '+$10' }), null);
});

test('vipTemplateOf prefers placeholders still in the stored text, else report templates', () => {
  assert.equal(vipTemplateOf('Hello +$[X]', { vip_template: 'other +$[X]' }), 'Hello +$[X]');
  assert.equal(vipTemplateOf('Week done on gold for the VIP.', { recap_template: 'Best: +$[X], +$[Y] and +$[Z] at [lot] lot.' }), 'Best: +$[X], +$[Y] and +$[Z] at [lot] lot.');
  assert.equal(vipTemplateOf('Week done on gold for the VIP.', {}), null);
});

test('pickLastWinOfDay takes the most recently closed qualifying win, excluding already-shown tickets', () => {
  const day = '2026-11-18';
  const trades = [
    t({ ticket: '1', pnl: 3000, closed_at: '2026-11-18T08:00:00Z' }), // +300 at 0.10, earlier
    t({ ticket: '2', pnl: 2000, closed_at: '2026-11-18T12:00:00Z' }), // later, still a win
    t({ ticket: '3', pnl: 100, closed_at: '2026-11-18T13:00:00Z' }),  // under +150 at 1 lot
    t({ ticket: '4', pnl: 2500, closed_at: '2026-11-17T12:00:00Z' }), // other day
  ];
  assert.equal(pickLastWinOfDay(trades, day, [], NOW)!.ticket, '2');
  assert.equal(pickLastWinOfDay(trades, day, ['2'], NOW)?.ticket, '1');
  assert.equal(pickLastWinOfDay(trades, day, ['1', '2'], NOW), null);
});

test('recap week of Saturday 21 Nov is Monday 16 to Friday 20', () => {
  assert.deepEqual(recapWeekOf('2026-11-21'), { monday: '2026-11-16', friday: '2026-11-20' });
});

test('fillFromTrades daily: last win of the day, skip if none left', () => {
  const template = 'The VIP: +$[X] at [lot] lot.';
  const trades = [
    t({ ticket: '10', pnl: 2000, closed_at: '2026-11-18T10:00:00Z' }),
    t({ ticket: '11', pnl: 1800, closed_at: '2026-11-18T11:00:00Z' }),
  ];
  const ok = fillFromTrades(template, trades, { day: '2026-11-18', usedTickets: [], now: NOW });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.ref, '11');
    assert.match(ok.text, /\+\$180 at 0\.10 lot/);
  }
  const skip = fillFromTrades(template, trades, { day: '2026-11-18', usedTickets: ['10', '11'], now: NOW });
  assert.equal(skip.ok, false);
});

test('fillFromTrades weekly: three best wins, no total required, skip if fewer than 3', () => {
  const template = "The VIP's best trades this week: +$[X], +$[Y] and +$[Z] at [lot] lot. *Trading involves risk. Past results don't guarantee future results.*";
  const trades = [
    t({ ticket: 'a', pnl: 3000, closed_at: '2026-11-16T10:00:00Z' }),
    t({ ticket: 'b', pnl: 2500, closed_at: '2026-11-17T10:00:00Z' }),
    t({ ticket: 'c', pnl: 1800, closed_at: '2026-11-20T10:00:00Z' }),
    t({ ticket: 'd', pnl: 4000, closed_at: '2026-11-15T10:00:00Z' }), // Sunday before the week
  ];
  const ok = fillFromTrades(template, trades, { day: '2026-11-21', weekly: true, now: NOW });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.match(ok.text, /\+\$300, \+\$250 and \+\$180 at 0\.10 lot/);
    assert.doesNotMatch(ok.text, /\[/);
  }
  const few = fillFromTrades(template, trades.slice(0, 2), { day: '2026-11-21', weekly: true, now: NOW });
  assert.equal(few.ok, false);
});

test('fillsFromWin uses 0.10 lot display, never the master lot size', () => {
  const f = fillsFromWin(t({ ticket: '9', pnl: 2000, lot: 1, closed_at: '2026-11-18T10:00:00Z' }));
  assert.equal(f.X, '+$200');
  assert.equal(f.lot, '0.10');
});

test('pickBestWinsOfWeek sorts by size at 1 lot', () => {
  const best = pickBestWinsOfWeek([
    t({ ticket: 'small', pnl: 2000, closed_at: '2026-11-17T10:00:00Z' }),
    t({ ticket: 'big', pnl: 5000, closed_at: '2026-11-18T10:00:00Z' }),
  ], '2026-11-16', '2026-11-20', 3, NOW);
  assert.deepEqual(best.map((x) => x.ticket), ['big', 'small']);
});
