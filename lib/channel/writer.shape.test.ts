import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { guardTrade, tradeFallback } from './cm';
import { hookIssue, shapeFallback } from './tone';
import { CHANNEL_SHAPE_EXAMPLE, check, englishPunct } from './writer';

const shaped = { tokens: {} as Record<string, string>, noButton: true, allowedUsd: [] as number[], tone: { requireHook: true, hasButton: false } };

test('the validated 25/11 shape passes, with the emoji, the bold hook and English punctuation', () => {
  assert.equal(hookIssue(CHANNEL_SHAPE_EXAMPLE), null);
  const r = check(CHANNEL_SHAPE_EXAMPLE, { ...shaped, noButton: false, tone: { requireHook: true, hasButton: true } });
  assert.equal(r.ok, true, r.ok ? '' : r.why);
  if (!r.ok) return;
  assert.match(r.text, /^🌍 <b>Which broker\? It depends on your country<\/b>/);
  assert.match(r.text, /👌🏻/);
  assert.doesNotMatch(r.text, / [?!;:]/);
});

test('englishPunct removes the space before ? ! : ; and leaves urls and clocks alone', () => {
  assert.equal(englishPunct('Which broker ? Ready ! Note : this ; done.'), 'Which broker? Ready! Note: this; done.');
  assert.equal(englishPunct('Ready\u00A0? Go\u202F!'), 'Ready? Go!');
  assert.equal(englishPunct('https://t.me/algoriadeskbot?start=ch_1118'), 'https://t.me/algoriadeskbot?start=ch_1118');
  assert.equal(englishPunct('19:00 UK'), '19:00 UK');
});

test('check() strips French spacing inside a bold hook', () => {
  const raw = '🌍 <b>Which broker ? It depends on your country</b>\n\nSend me yours.\n\nThat is all I need 👌🏻';
  const r = check(raw, shaped);
  assert.equal(r.ok, true, r.ok ? '' : r.why);
  if (r.ok) {
    assert.match(r.text, /broker\?/);
    assert.doesNotMatch(r.text, /broker \?/);
  }
});

test('a post without the hook is rejected, then the fallback restores it without inventing a claim', () => {
  const raw = 'Which broker ? It depends on your country\n\nSend me yours and I will tell you where to create your trading account.\n\nJust write your country.';
  const rejected = check(raw, shaped);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.match(rejected.why, /^shape:/);
  const fixed = shapeFallback(englishPunct(raw), '🌍');
  assert.ok(fixed);
  assert.equal(hookIssue(fixed ?? ''), null);
  assert.match(fixed ?? '', /^🌍 <b>Which broker\? It depends on your country<\/b>/);
  assert.match(fixed ?? '', /country\. 👌🏻$/);
  assert.doesNotMatch(fixed ?? '', / [?!]/);
  const again = check(fixed ?? '', shaped);
  assert.equal(again.ok, true, again.ok ? '' : again.why);
});

test('the fallback keeps a leading emoji that is already there', () => {
  const raw = '🔒 <b>Your trading account stays in your name</b>\n\nYou create it at the broker, then you connect it to Algoria.';
  const fixed = shapeFallback(raw, '🌍');
  assert.match(fixed ?? '', /^🔒 <b>Your trading account stays in your name<\/b>/);
  assert.match(fixed ?? '', /Algoria\. 👌🏻$/);
});

test('the fallback does not delete a pile of body emojis and does not invent a body', () => {
  assert.equal(shapeFallback('🌍 <b>A short hook</b>\n\nOne 🔒 two 💬 three 📲 four 🥇', '🌍'), null);
  assert.equal(shapeFallback('🌍 <b>Only the hook</b>', '🌍'), null);
});

test('the hook shape does not relax promises, negative words or money to put in', () => {
  const promise = check('🌍 <b>You will earn every day</b>\n\nThe copy runs on your account.\n\nConnect it 👌🏻', shaped);
  assert.equal(promise.ok, false);
  if (!promise.ok) assert.match(promise.why, /promise|gain/i);

  const negative = check('🌍 <b>About yesterday</b>\n\nWe had a loss and the session is over.\n\nBack on gold 👌🏻', shaped);
  assert.equal(negative.ok, false);
  if (!negative.ok) assert.match(negative.why, /negative/i);

  const money = check('🌍 <b>How to start</b>\n\nJust deposit and connect your account.\n\nThat is it 👌🏻', shaped);
  assert.equal(money.ok, false);
  if (!money.ok) assert.match(money.why, /money|deposit/i);

  const bare = check('The app shows every trade.\n\nYou connect your trading account once.', { tokens: {}, noButton: true });
  assert.equal(bare.ok, true, bare.ok ? '' : bare.why);
});

test('the trade fallback uses the hook shape and still passes the channel guards', () => {
  const facts = { direction: 'SELL' as const, entry: '4,119.62', exit: '4,117.26', how: 'it closed in profit', closedAt: '18:53' };
  const result = '+$2.36 at 0.01 lot · +$23.60 at 0.10 lot';
  const text = guardTrade(tradeFallback(facts, () => 0), result, null);
  assert.ok(text);
  assert.match(text ?? '', /^📈 <b>.+<\/b>/);
  assert.match(text ?? '', /4,119\.62/);
  assert.match(text ?? '', /\+\$2\.36 at 0\.01 lot/);
  assert.match(text ?? '', /👌🏻/);
  assert.doesNotMatch(text ?? '', / [?!;:]/);
  assert.doesNotMatch(text ?? '', /Trading involves risk/);
  assert.doesNotMatch(text ?? '', /you will earn|deposit|\bloss\b/i);
});

test('the prompt shows the validated example, forbids a space before ? ! and does not pass temperature', () => {
  const src = readFileSync(new URL('./writer.ts', import.meta.url), 'utf8');
  const prompt = src.slice(src.indexOf('return `You write the posts'), src.indexOf('OUTPUT: only a JSON object'));
  assert.match(prompt, /CHANNEL_SHAPE_EXAMPLE/);
  assert.match(prompt, /Never a space before/);
  assert.doesNotMatch(prompt, /Put a space before/);
  assert.doesNotMatch(prompt, /zero is often best/);
  assert.match(prompt, /No promises and no projections/);
  assert.match(prompt, /Nothing negative/);
  assert.match(prompt, /never deny a past loss/);
  assert.match(src, /SHAPE_TASK/);
  for (const call of src.split('messages.create').slice(1)) {
    const args = call.slice(0, call.indexOf(');'));
    assert.doesNotMatch(args, /temperature/);
  }
});
