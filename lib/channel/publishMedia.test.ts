import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withRisk, check, CM_RISK } from './writer';
import { fillFromTrades } from './vipFill';
import type { Trade } from './recap';
import {
  isBannerKind, isTradeCardEnabled, wantsBrandBanner, winCardUrl, resolvePublishPhoto,
} from './publishMedia';

const APP = 'https://getalgoria.com';

const trade = (o: Partial<Trade> & { ticket: string; closed_at: string; pnl: number }): Trade => ({
  symbol: 'XAUUSD', lot: 1, strategy: 2, direction: 'long', entry: 2600, exit: 2610, reason: 'tp',
  ...o,
});

test('banner API kinds: lesson, story and cta are allowed; trade and gold are not', () => {
  for (const kind of ['morning', 'howto', 'cta', 'qa', 'lesson', 'story']) assert.equal(isBannerKind(kind), true, kind);
  for (const kind of ['trade', 'tp', 'gold', 'poll', 'video', 'backstage']) assert.equal(isBannerKind(kind), false, kind);
});

test('wantsBrandBanner requires an explicit mark and an allowed kind', () => {
  assert.equal(wantsBrandBanner('lesson', { banner: true }), true);
  assert.equal(wantsBrandBanner('story', { visual: 'banner' }), true);
  assert.equal(wantsBrandBanner('cta', { visual: 'brand' }), true);
  assert.equal(wantsBrandBanner('cta', { banner: 'true' }), true);
  assert.equal(wantsBrandBanner('lesson', {}), false);
  assert.equal(wantsBrandBanner('lesson', { banner: false }), false);
  assert.equal(wantsBrandBanner('trade', { banner: true }), false);
  assert.equal(wantsBrandBanner('gold', { visual: 'banner' }), false);
});

test('cm_trade_card is on by default, and only an explicit off disables it', () => {
  assert.equal(isTradeCardEnabled(undefined), true);
  assert.equal(isTradeCardEnabled(null), true);
  assert.equal(isTradeCardEnabled('on'), true);
  assert.equal(isTradeCardEnabled(' ON '), true);
  assert.equal(isTradeCardEnabled('off'), false);
  assert.equal(isTradeCardEnabled('OFF'), false);
});

test('resolvePublishPhoto attaches /api/card/win on a VIP +$[X] post when a winning trade exists', () => {
  const photo = resolvePublishPhoto({
    kind: 'trade',
    report: { fill: 'auto_trade' },
    vipWin: { ticket: '8891', strategy: 2 },
    tradeCardOn: true,
    appUrl: APP,
  });
  assert.equal(photo, `${APP}/api/card/win?ticket=8891&strategy=2`);
  assert.match(photo, /\/api\/card\/win\?/);
});

test('resolvePublishPhoto skips the win card when cm_trade_card is off, and when there is no winning trade', () => {
  const off = resolvePublishPhoto({
    kind: 'trade', report: {}, vipWin: { ticket: '8891', strategy: 2 }, tradeCardOn: false, appUrl: APP,
  });
  assert.equal(off, '');
  const none = resolvePublishPhoto({
    kind: 'trade', report: {}, vipWin: null, tradeWin: null, tradeCardOn: true, appUrl: APP,
  });
  assert.equal(none, '');
});

test('fillFromTrades on a validated +$[X] calendar text fills the amount and skips if no VIP win', () => {
  const template = '🟡 <b>This one just landed for the VIP</b>\n\n+$[X] at [lot] lot on gold.\n\nWant the next ones on your own account? It\'s free.';
  const now = Date.parse('2026-11-24T14:00:00Z');
  const win = trade({ ticket: '8891', pnl: 2000, strategy: 2, closed_at: '2026-11-24T10:00:00Z' });
  const ok = fillFromTrades(template, [win], { day: '2026-11-24', now });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.ref, '8891');
    assert.equal(ok.strategy, 2);
    assert.match(ok.text, /\+\u2060\$200 at 0\.10 lot on gold/);
    assert.doesNotMatch(ok.text, /Trading involves risk/);
    const photo = resolvePublishPhoto({
      kind: 'trade', report: {}, vipWin: { ticket: ok.ref, strategy: ok.strategy }, tradeCardOn: true, appUrl: APP,
    });
    assert.equal(photo, winCardUrl(APP, '8891', 2));
  }
  const skip = fillFromTrades(template, [], { day: '2026-11-24', now });
  assert.equal(skip.ok, false);
});

test('resolvePublishPhoto recolles the brand banner on a marked lesson/story/cta, keeps a real photo, ignores unmarked posts', () => {
  const banner = `${APP}/api/card/banner?post=311&v=1`;
  assert.equal(resolvePublishPhoto({
    kind: 'lesson', report: { banner: true }, tradeCardOn: true, appUrl: APP, bannerUrl: banner,
  }), banner);
  assert.equal(resolvePublishPhoto({
    kind: 'story', report: { visual: 'banner' }, tradeCardOn: true, appUrl: APP, bannerUrl: banner,
  }), banner);
  assert.equal(resolvePublishPhoto({
    kind: 'cta', report: { banner: true }, existingPhoto: 'drive:abc', tradeCardOn: true, appUrl: APP, bannerUrl: banner,
  }), 'drive:abc');
  assert.equal(resolvePublishPhoto({
    kind: 'cta', report: {}, tradeCardOn: true, appUrl: APP, bannerUrl: banner,
  }), '');
  assert.equal(resolvePublishPhoto({
    kind: 'lesson', report: { banner: true }, tradeCardOn: true, appUrl: APP,
  }), '');
});

test('withRisk and autoRisk never add the Trading involves risk disclaimer', () => {
  assert.doesNotMatch(withRisk('Yesterday went well.\n\n+$21 at 0.10 lot', true), /Trading involves risk/);
  assert.equal(withRisk(`x\n\n<i>${CM_RISK}</i>`, true), 'x');
  const figured = check('Yesterday went well.\n\n{{YESTERDAY}}', {
    tokens: { YESTERDAY: '+$2.10 at 0.01 lot · +$21 at 0.10 lot' },
    noButton: true,
    allowedUsd: [],
    autoRisk: true,
  });
  assert.equal(figured.ok, true);
  if (figured.ok) {
    assert.doesNotMatch(figured.text, /Trading involves risk/);
    assert.match(figured.text, /Yesterday went well/);
  }
});
