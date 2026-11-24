import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eventsForBubbleDays, validateBubbleScripts, type BubbleScript } from './writer';

const good = (over: Partial<BubbleScript> = {}): BubbleScript => ({
  theme: 'Or et marché',
  subject: 'Demain la journée est chargée sur l\'or, j\'explique simplement quoi surveiller.',
  why: 'Demain à 17:30, heure de Dubaï, trois chiffres américains sortent en même temps.',
  duration: '30 à 60 secondes',
  hook: 'If you follow gold, tomorrow is a big day, so here is what I am watching.',
  points: [
    'At 17:30 Dubai time, the US releases inflation, GDP and durable goods all at once.',
    'Then at 23:00 Dubai, the Fed publishes its Beige Book, a picture of how the US economy is doing.',
    'Dis où tu es en ce moment, en une phrase.',
  ],
  closing: 'That is why I do not trade by hand on days like this. Any question, write to me at @mathieu_algoria.',
  ...over,
});

test('a CM bubble script keeps the channel guardrails and the fields Mathieu reads', () => {
  const ok = validateBubbleScripts({ bubbles: [good(), good(), good()] }, 3);
  assert.equal(ok.ok, true, ok.ok ? '' : ok.why);
  if (!ok.ok) return;
  assert.equal(ok.bubbles.length, 3);
  assert.match(ok.bubbles[0].closing, /@mathieu_algoria/);
  assert.equal(ok.bubbles[0].points[2], 'Dis où tu es en ce moment, en une phrase.');

  const promise = validateBubbleScripts({ bubbles: [good({ closing: 'You will earn with Algoria. @mathieu_algoria' }), good(), good()] }, 3);
  assert.equal(promise.ok, false);
  if (!promise.ok) assert.match(promise.why, /promise|gain/i);

  const negative = validateBubbleScripts({ bubbles: [good({ why: 'Je parle de la perte d\'hier, sans chiffre.' }), good(), good()] }, 3);
  assert.equal(negative.ok, false);
  if (!negative.ok) assert.match(negative.why, /negatif|negative/i);

  const money = validateBubbleScripts({ bubbles: [good({ hook: 'Just deposit and the AI does the rest.' }), good(), good()] }, 3);
  assert.equal(money.ok, false);
  if (!money.ok) assert.match(money.why, /money|deposit/i);

  const forecast = validateBubbleScripts({ bubbles: [good({ hook: 'Gold will rise after the news, so stay in.' }), good(), good()] }, 3);
  assert.equal(forecast.ok, false);
  if (!forecast.ok) assert.match(forecast.why, /forecast|prévision/i);

  const noHandle = validateBubbleScripts({ bubbles: [good({ closing: 'Any question, just write to me.' }), good(), good()] }, 3);
  assert.equal(noHandle.ok, false);

  const fewPoints = validateBubbleScripts({ bubbles: [good({ points: ['Only one sentence to say.'] }), good(), good()] }, 3);
  assert.equal(fewPoints.ok, false);

  const wrongCount = validateBubbleScripts({ bubbles: [good(), good(), good()] }, 4);
  assert.equal(wrongCount.ok, false);
});

test('calendar lines for a bubble use Dubai time and drop forecasts, lows and other countries', () => {
  const hits = eventsForBubbleDays([
    { title: 'CPI m/m', country: 'USD', impact: 'High', date: '2026-11-25T08:30:00-05:00', forecast: '0.3', previous: '0.2' },
    { title: 'Beige Book', country: 'USD', impact: 'High', date: '2026-11-25T14:00:00-05:00' },
    { title: 'Unemployment Rate', country: 'EUR', impact: 'High', date: '2026-11-25T08:30:00-05:00' },
    { title: 'Crude Oil Inventories', country: 'USD', impact: 'Low', date: '2026-11-25T10:30:00-05:00' },
    { title: 'Thanksgiving Day', country: 'USD', impact: 'Holiday', date: '2026-11-26T00:00:00-05:00' },
  ], '2026-11-25');
  assert.equal(hits[0].hhmm, '17:30');
  assert.equal(hits[0].when, 'today');
  assert.match(hits[0].plain, /inflation/i);
  assert.equal(hits[1].hhmm, '23:00');
  assert.match(hits[1].plain, /Beige Book/);
  assert.equal(hits.filter((h) => /chômage européen|Unemployment/i.test(h.plain)).length, 0);
  assert.equal(hits.some((h) => /Crude/i.test(h.plain)), false);
  assert.equal(hits.some((h) => h.when === 'tomorrow' && /Thanksgiving/i.test(h.plain)), true);
  assert.equal(JSON.stringify(hits).includes('0.3'), false);
});
