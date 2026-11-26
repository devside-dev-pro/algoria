import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { usd } from './usd';
import { check } from './writer';
import { toneIssue } from './tone';
import { GRACE_MS, renderPlan } from './cm';
import {
  AUTO_APPROVE_ENV, AUTO_APPROVE_SETTING, AUTO_GRACE_MS,
  autoApproveDue, autoApproveEnabled, canAutoApprove, guardRefusal,
  statusAfterGuardedEdit, statusAfterPhotoChange,
  type ApproveRow,
} from './autoApprove';

const EVENING = Date.parse('2026-11-26T18:05:00+01:00');
const FIRST = '2026-11-27T08:42:00+01:00';
const LATER = '2026-11-27T14:10:00+01:00';
const CLEAN = 'The AI watches gold and waits for a clean setup.\n\nYour account copies the trade at the size you chose.';
const LESSON = 'A martingale grows after a loss.\n\nAlgoria keeps the same size, win or lose.';

const draft = (o: Partial<ApproveRow> & { id: number }): ApproveRow => ({
  day: '2026-11-27', slot: 'p1', kind: 'gold', ref: 'gold', text: CLEAN,
  button_text: null, status: 'draft', scheduled_at: FIRST, report: { writer: 'ai' }, ...o,
});

type MemRow = Record<string, unknown>;

function memoryDb(posts: MemRow[], settings: MemRow[] = []) {
  const tables: Record<string, MemRow[]> = { channel_posts: posts, support_settings: settings };
  return {
    from(table: string) {
      const filters: Array<(r: MemRow) => boolean> = [];
      let patch: MemRow | null = null;
      const q = {
        select() { return q; },
        eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return q; },
        gt(c: string, v: unknown) { filters.push((r) => Date.parse(String(r[c])) > Date.parse(String(v))); return q; },
        limit() { return q; },
        update(p: MemRow) { patch = p; return q; },
        then(resolve: (v: unknown) => unknown) {
          const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
          if (patch) for (const r of rows) Object.assign(r, patch);
          return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null }).then(resolve);
        },
      };
      return q;
    },
  };
}

test('auto-approve is on unless the env or support_settings says off', () => {
  assert.equal(autoApproveEnabled(undefined, ''), true);
  assert.equal(autoApproveEnabled(null, undefined), true);
  assert.equal(autoApproveEnabled('on', ''), true);
  assert.equal(autoApproveEnabled(' ON ', ''), true);
  assert.equal(autoApproveEnabled('off', ''), false);
  assert.equal(autoApproveEnabled('OFF', 'on'), false);
  assert.equal(autoApproveEnabled('on', 'off'), false);
  assert.equal(autoApproveEnabled(undefined, 'off'), false);
  assert.equal(AUTO_APPROVE_SETTING, 'cm_auto_approve');
  assert.equal(AUTO_APPROVE_ENV, 'CHANNEL_CM_AUTO_APPROVE');
  assert.equal(AUTO_GRACE_MS, GRACE_MS);
});

test('check() refusals for a promise, a loss, a deposit, a link or a raw amount are not auto-approved', () => {
  const bad = [
    'You will earn on every trade.',
    'Yesterday was a loss and a red day.',
    'The minimum deposit is what you fund.',
    'Read more at https://example.com today.',
    'Members took $5000 on that move.',
    'Up 50% since the open.',
  ];
  for (const text of bad) {
    const c = check(text, { tokens: {}, noButton: true, allowedUsd: [], maxChars: 760 });
    assert.equal(c.ok, false, text);
    const row = draft({ id: 1, text });
    assert.ok(guardRefusal(row), text);
    assert.equal(canAutoApprove(row, EVENING), false, text);
  }
});

test('a lesson may say loss, the same sentence on a gold post may not', () => {
  const lesson = check(LESSON, { tokens: {}, allowNegative: true, noButton: true, allowedUsd: [], maxChars: 760 });
  assert.equal(lesson.ok, true, lesson.ok ? '' : lesson.why);
  assert.equal(guardRefusal(draft({ id: 1, kind: 'lesson', text: LESSON })), null);
  assert.ok(guardRefusal(draft({ id: 2, kind: 'gold', text: LESSON })));
});

test('a code-formatted result stays allowed, a hand-written dollar amount does not', () => {
  const coded = `Closed this afternoon.\n\n${usd(42)} at 0.10 lot.`;
  assert.equal(guardRefusal(draft({ id: 1, kind: 'backstage', text: coded })), null);
  assert.ok(guardRefusal(draft({ id: 2, text: 'Closed this afternoon.\n\n+$42.00 at 0.10 lot.' })));
});

test('tone still blocks a worn-out or over-bold post, including one marked ai', () => {
  const worn = 'A quick one on how the copy works.\n\nYour account stays in your name.';
  assert.ok(toneIssue(worn, { hasButton: false }));
  assert.ok(guardRefusal(draft({ id: 1, text: worn })));
  const bold = '<b>Gold</b> this afternoon.\n\nAnd <b>again</b> on the copy.';
  assert.ok(guardRefusal(draft({ id: 2, text: bold, report: { writer: 'ai' } })));
});

test('an empty trade slot is approved, a trade comment that fails the guard is not', () => {
  assert.equal(guardRefusal(draft({ id: 1, kind: 'trade', ref: null, text: null, report: {} })), null);
  assert.equal(guardRefusal(draft({ id: 2, kind: 'tp', ref: null, text: '   ', report: {} })), null);
  assert.ok(guardRefusal(draft({ id: 3, kind: 'trade', text: 'You will profit on the next one.' })));
});

test('a poll the guard refuses is not approved, a plain poll is', () => {
  const rich = draft({
    id: 1, kind: 'poll', text: 'Want to get rich?',
    report: { poll: { question: 'Want to get rich?', options: ['Yes', 'Not yet'] } },
  });
  assert.ok(guardRefusal(rich));
  const ok = draft({
    id: 2, kind: 'poll', text: 'Where are you in the setup?',
    report: { poll: { question: 'Where are you in the setup?', options: ['Just looking', 'Account connected'] } },
  });
  assert.equal(guardRefusal(ok), null);
  const lossOpt = draft({
    id: 3, kind: 'poll', text: 'What should the next video cover?',
    report: { poll: { question: 'What should the next video cover?', options: ['The app', 'My loss'] } },
  });
  assert.ok(guardRefusal(lossOpt));
});

test('Mathieu VIP templates keep their link exception and still refuse a promise', () => {
  const calm = 'This one just landed for the VIP.\n\n+$[X] at [lot] lot on gold.\n\nDetails at https://getalgoria.com/member.';
  assert.equal(guardRefusal(draft({ id: 1, kind: 'trade', text: calm, report: { vip_template: calm } })), null);
  const boast = `${calm}\n\nYou will earn from the next one too.`;
  assert.ok(guardRefusal(draft({ id: 2, kind: 'trade', text: boast, report: { vip_template: boast } })));
});

test('webinar bank text skips the tone cap and still refuses a promise', () => {
  const bank = '🎤 <b>Tonight, I’m going live.</b>\n\n45 minutes, in English.\n\n🎁 Save your seat.\n\nOr DM me <b>LIVE</b>.';
  assert.ok(toneIssue(bank, { hasButton: true }));
  const row = draft({
    id: 1, kind: 'cta', ref: 'webinar-today', text: bank, button_text: 'SAVE MY SEAT',
    report: { writer: 'bank', goal: 'announce the live' },
  });
  assert.equal(guardRefusal(row), null);
  assert.ok(guardRefusal(draft({
    id: 2, kind: 'cta', ref: 'webinar-today', text: `${bank}\n\nYou will profit by watching.`,
    report: { writer: 'bank' },
  })));
});

test('bubbles, video notes and the plan row are never auto-approved', () => {
  const bubble = draft({
    id: 1, slot: 'bubble2', kind: 'video', text: 'A day in Dubai', status: 'draft',
    report: { mode: 'prog', subject: 'A day in Dubai' },
  });
  const live = draft({
    id: 2, slot: 'bubble3', kind: 'video', status: 'info',
    report: { mode: 'live', subject: 'Setting up' },
  });
  const idea = draft({ id: 3, slot: 'video', kind: 'video', text: 'Why the lot stays put', report: {} });
  const plan = draft({ id: 4, slot: 'plan', kind: 'plan', text: null, report: { msgs: [] } });
  for (const row of [bubble, live, idea, plan]) {
    assert.ok(guardRefusal(row), `${row.kind}/${row.slot}`);
    assert.equal(canAutoApprove(row, EVENING), false);
  }
});

test('the evening cron approves the next day plan before its first slot', async () => {
  assert.ok(EVENING < Date.parse(FIRST));
  const posts: MemRow[] = [
    { ...draft({ id: 1, slot: 'p1', scheduled_at: FIRST }) },
    { ...draft({ id: 2, slot: 'p2', kind: 'lesson', text: LESSON, scheduled_at: LATER }) },
    { ...draft({ id: 3, slot: 'p3', kind: 'trade', ref: null, text: null, report: {}, scheduled_at: '2026-11-27T16:20:00+01:00' }) },
    { ...draft({ id: 4, slot: 'p4', text: 'You will earn on every trade.', scheduled_at: '2026-11-27T18:40:00+01:00' }) },
    { ...draft({ id: 5, slot: 'bubble1', kind: 'video', text: 'Dubai morning', report: { mode: 'prog' }, scheduled_at: '2026-11-27T13:00:00+04:00' }) },
    { ...draft({ id: 6, slot: 'p5', kind: 'cta', status: 'skipped', decided_by: '@mathieu', scheduled_at: LATER }) },
    { ...draft({ id: 7, slot: 'p6', kind: 'backstage', status: 'approved', decided_by: '@mathieu', decided_at: '2026-11-26T18:00:00.000Z' }) },
  ];
  const prev = process.env[AUTO_APPROVE_ENV];
  delete process.env[AUTO_APPROVE_ENV];
  try {
    const out = await autoApproveDue(memoryDb(posts), EVENING);
    assert.equal(out.enabled, true);
    assert.equal(out.approved, 3);
    assert.equal(out.held, 1);
    assert.equal(posts[0].status, 'approved');
    assert.equal(posts[0].decided_by, 'auto');
    assert.equal(posts[0].decided_at, new Date(EVENING).toISOString());
    assert.ok(Date.parse(String(posts[0].decided_at)) < Date.parse(FIRST));
    assert.equal(posts[1].status, 'approved');
    assert.equal(posts[1].decided_by, 'auto');
    assert.equal(posts[2].status, 'approved');
    assert.equal(posts[3].status, 'draft');
    assert.equal(posts[3].decided_by, undefined);
    assert.equal(posts[4].status, 'draft');
    assert.equal(posts[5].status, 'skipped');
    assert.equal(posts[5].decided_by, '@mathieu');
    assert.equal(posts[6].decided_by, '@mathieu');
    const again = await autoApproveDue(memoryDb(posts), EVENING);
    assert.equal(again.approved, 0);
    assert.equal(posts[0].decided_at, new Date(EVENING).toISOString());
  } finally {
    if (prev === undefined) delete process.env[AUTO_APPROVE_ENV];
    else process.env[AUTO_APPROVE_ENV] = prev;
  }
});

test('a draft past the grace hour is left for expiry, one still inside it is approved', async () => {
  const late = Date.parse('2026-11-27T10:00:00+01:00');
  const inside = Date.parse('2026-11-27T09:00:00+01:00');
  assert.ok(late >= Date.parse(FIRST) + GRACE_MS);
  assert.ok(inside < Date.parse(FIRST) + GRACE_MS);
  const expired = [draft({ id: 1 }) as unknown as MemRow];
  const still = [draft({ id: 2 }) as unknown as MemRow];
  const prev = process.env[AUTO_APPROVE_ENV];
  delete process.env[AUTO_APPROVE_ENV];
  try {
    assert.equal((await autoApproveDue(memoryDb(expired), late)).approved, 0);
    assert.equal(expired[0].status, 'draft');
    assert.equal((await autoApproveDue(memoryDb(still), inside)).approved, 1);
    assert.equal(still[0].status, 'approved');
    assert.equal(still[0].decided_by, 'auto');
  } finally {
    if (prev === undefined) delete process.env[AUTO_APPROVE_ENV];
    else process.env[AUTO_APPROVE_ENV] = prev;
  }
});

test('support_settings off or the env off leaves every draft untouched', async () => {
  const posts = [draft({ id: 1 }) as unknown as MemRow];
  const off = await autoApproveDue(memoryDb(posts, [{ key: AUTO_APPROVE_SETTING, value: 'off' }]), EVENING);
  assert.equal(off.enabled, false);
  assert.equal(off.approved, 0);
  assert.equal(posts[0].status, 'draft');
  const prev = process.env[AUTO_APPROVE_ENV];
  process.env[AUTO_APPROVE_ENV] = 'off';
  try {
    const envOff = await autoApproveDue(memoryDb(posts, [{ key: AUTO_APPROVE_SETTING, value: 'on' }]), EVENING);
    assert.equal(envOff.enabled, false);
    assert.equal(posts[0].status, 'draft');
  } finally {
    if (prev === undefined) delete process.env[AUTO_APPROVE_ENV];
    else process.env[AUTO_APPROVE_ENV] = prev;
  }
});

test('a skip that lands before the write is not overwritten', async () => {
  const row = draft({ id: 9 }) as unknown as MemRow;
  let updates = 0;
  const db = {
    from(table: string) {
      const filters: Array<(r: MemRow) => boolean> = [];
      let patch: MemRow | null = null;
      const q = {
        select() { return q; },
        eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return q; },
        gt(c: string, v: unknown) { filters.push((r) => Date.parse(String(r[c])) > Date.parse(String(v))); return q; },
        limit() { return q; },
        update(p: MemRow) { patch = p; updates++; row.status = 'skipped'; row.decided_by = '@mathieu'; return q; },
        then(resolve: (v: unknown) => unknown) {
          const rows = table === 'channel_posts' ? [row].filter((r) => filters.every((f) => f(r))) : [];
          if (patch) for (const r of rows) Object.assign(r, patch);
          return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null }).then(resolve);
        },
      };
      return q;
    },
  };
  const prev = process.env[AUTO_APPROVE_ENV];
  delete process.env[AUTO_APPROVE_ENV];
  try {
    const out = await autoApproveDue(db, EVENING);
    assert.equal(updates, 1);
    assert.equal(out.approved, 0);
    assert.equal(row.status, 'skipped');
    assert.equal(row.decided_by, '@mathieu');
  } finally {
    if (prev === undefined) delete process.env[AUTO_APPROVE_ENV];
    else process.env[AUTO_APPROVE_ENV] = prev;
  }
});

test('Mathieu can still remove or correct a post, and a guarded edit stays approved when auto is on', () => {
  const at = new Date(Date.now() + 3 * 60 * 60_000).toISOString();
  const day = at.slice(0, 10);
  const post = {
    id: 41, day, slot: 'p1', kind: 'gold', ref: 'gold', text: CLEAN,
    button_text: null, button_url: null, photo_url: null, scheduled_at: at,
    status: 'approved', report: { writer: 'ai' },
  };
  const auto = renderPlan(day, [post], { autoApprove: true });
  assert.match(auto.text, /Validé tout seul/);
  assert.doesNotMatch(auto.text, /sans ton clic/);
  assert.equal(auto.keyboard.some((row) => row.some((b) => b.callback_data === 'cma:' + day)), false);
  assert.equal(auto.keyboard.some((row) => row.some((b) => b.callback_data === 'cmt:41')), true);
  assert.equal(auto.keyboard.some((row) => row.some((b) => b.callback_data === 'cmn:' + day)), true);
  const held = renderPlan(day, [{ ...post, id: 42, status: 'draft', text: 'You will earn on every trade.' }], { autoApprove: true });
  assert.equal(held.keyboard.some((row) => row.some((b) => b.callback_data === 'cma:' + day)), true);
  const manual = renderPlan(day, [{ ...post, status: 'draft' }], { autoApprove: false });
  assert.match(manual.text, /sans ton clic/);
  assert.equal(statusAfterGuardedEdit(true), 'approved');
  assert.equal(statusAfterGuardedEdit(false), 'draft');
  assert.equal(statusAfterPhotoChange(true, 'approved'), 'approved');
  assert.equal(statusAfterPhotoChange(true, 'skipped'), 'skipped');
  assert.equal(statusAfterPhotoChange(false, 'skipped'), 'draft');
  assert.equal(statusAfterPhotoChange(false, 'approved'), 'draft');
});

test('the channel cron approves before publishing and never sets a webhook or a temperature', () => {
  const route = readFileSync(new URL('../../app/api/cron/channel-posts/route.ts', import.meta.url), 'utf8');
  const src = readFileSync(new URL('./autoApprove.ts', import.meta.url), 'utf8');
  assert.match(route, /autoApproveDue/);
  assert.doesNotMatch(route, /setWebhook/);
  assert.doesNotMatch(route, /temperature/);
  assert.doesNotMatch(src, /setWebhook/);
  assert.doesNotMatch(src, /temperature/);
  const cm = readFileSync(new URL('./cm.ts', import.meta.url), 'utf8');
  assert.equal((cm.match(/statusAfterGuardedEdit/g) ?? []).length >= 1, true);
  assert.doesNotMatch(cm, /setWebhook/);
});
