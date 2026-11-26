import assert from 'node:assert/strict';
import { test } from 'node:test';
import { humanize } from '@/lib/member/replyDraft';
import { check } from './writer';

test('humanize(biz=true) still adds a space before ? and ! (support business unchanged)', () => {
  assert.equal(humanize('You have the app?', true), 'You have the app ?');
  assert.equal(humanize("Let's go!", true), "Let's go !");
  assert.equal(humanize('See https://t.me/algoriadeskbot?start=ch_1118_1712', true).includes('bot?start='), true);
});

test('channel check() keeps English punctuation without a space before ? and !', () => {
  const raw = 'Want the next one on your account? Free through the app.';
  const r = check(raw, { tokens: {}, noButton: true, allowedUsd: [], maxChars: 760 });
  assert.equal(r.ok, true, r.ok ? '' : r.why);
  if (r.ok) {
    assert.match(r.text, /account\?/);
    assert.doesNotMatch(r.text, /account \?/);
  }
});

test('channel check() strips a space before ? ! : ; including a French no-break space', () => {
  const raw = 'Which broker\u00A0? Ready ! Note : this ; done.';
  const r = check(raw, { tokens: {}, noButton: true, allowedUsd: [], maxChars: 760 });
  assert.equal(r.ok, true, r.ok ? '' : r.why);
  if (r.ok) {
    assert.equal(r.text, 'Which broker? Ready! Note: this; done.');
    assert.doesNotMatch(r.text, / [?!;:]/);
  }
});

test('channel check() does not insert a space before ? stuck to a closing italic tag', () => {
  const raw = '<i>Want the next one on your account?</i>';
  const r = check(raw, { tokens: {}, noButton: true, allowedUsd: [], maxChars: 760 });
  assert.equal(r.ok, true, r.ok ? '' : r.why);
  if (r.ok) {
    assert.match(r.text, /account\?<\/i>/);
    assert.doesNotMatch(r.text, /account \?/);
  }
});
