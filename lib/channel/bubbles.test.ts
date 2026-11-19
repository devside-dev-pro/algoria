import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatLiveDm, formatProgDm, formatNudgeDm, inLiveWindow, inProgWindow, inNudgeWindow, inSkipWindow,
  isBubbleRow, pendingLive, pendingProg, pendingNudge, pendingSkip, isUnanswered,
  renderBubblesPlanSection, dubaiNow, pickBubbleSlots, applyTimeChoice, atCallbackData, parseAtCallback,
  occupiedScheduledAt, SLOT_PREF, SLOT_MIN, SKIP_REASON, PROG_AT, NUDGE_AT, SKIP_AT,
  type BubbleRow,
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

test('PROG window is 11:30–13:00 Dubai every day, including Saturday and Sunday', () => {
  assert.equal(PROG_AT, '11:30');
  const wed1130 = Date.parse('2026-11-18T11:30:00+04:00');
  const wed1129 = Date.parse('2026-11-18T11:29:00+04:00');
  const wed1300 = Date.parse('2026-11-18T13:00:00+04:00');
  assert.equal(inProgWindow(dubaiNow(wed1130)), true);
  assert.equal(inProgWindow(dubaiNow(wed1129)), false);
  assert.equal(inProgWindow(dubaiNow(wed1300)), false);
  // l'ancien 09:30 semaine / 10:00 week-end ne déclenche plus
  assert.equal(inProgWindow(dubaiNow(Date.parse('2026-11-18T09:30:00+04:00'))), false);
  assert.equal(inProgWindow(dubaiNow(Date.parse('2026-11-21T10:00:00+04:00'))), false);
  const sat1129 = Date.parse('2026-11-21T11:29:00+04:00');
  const sat1130 = Date.parse('2026-11-21T11:30:00+04:00');
  const sun1130 = Date.parse('2026-11-22T11:30:00+04:00');
  assert.equal(inProgWindow(dubaiNow(sat1129)), false);
  assert.equal(inProgWindow(dubaiNow(sat1130)), true);
  assert.equal(inProgWindow(dubaiNow(sun1130)), true);
});

test('nudge window is 13:30–15:00 Dubai, unique, then skip at 15:00', () => {
  assert.equal(NUDGE_AT, '13:30');
  assert.equal(SKIP_AT, '15:00');
  const nowOf = (iso: string) => dubaiNow(Date.parse(iso));
  assert.equal(inNudgeWindow(nowOf('2026-11-21T13:29:00+04:00')), false);
  assert.equal(inNudgeWindow(nowOf('2026-11-21T13:30:00+04:00')), true);
  assert.equal(inNudgeWindow(nowOf('2026-11-21T14:59:00+04:00')), true);
  assert.equal(inNudgeWindow(nowOf('2026-11-21T15:00:00+04:00')), false);
  const r = row({
    id: 1, day: '2026-11-21', scheduled_at: '2026-11-21T13:15:00+04:00',
    report: { mode: 'prog', subject: 'A Saturday in Dubai' },
  });
  assert.deepEqual(pendingNudge([r]).map((x) => x.id), [1]);
  assert.deepEqual(pendingNudge([row({ ...r, report: { ...(r.report as object), nudge_sent_at: 'x' } })]), []);
  assert.equal(inSkipWindow(nowOf('2026-11-21T14:59:00+04:00'), '2026-11-21'), false);
  assert.equal(inSkipWindow(nowOf('2026-11-21T15:00:00+04:00'), '2026-11-21'), true);
  assert.equal(inSkipWindow(nowOf('2026-11-22T11:00:00+04:00'), '2026-11-21'), true);
  const skip = pendingSkip([r], nowOf('2026-11-21T15:00:00+04:00'));
  assert.deepEqual(skip.map((x) => x.id), [1]);
  assert.equal(SKIP_REASON, 'sans réponse après la relance de 13:30');
  // un horaire déjà choisi, ou Faite, ou Pas cette fois : pas de relance ni de skip
  const chosen = row({ ...r, report: { ...(r.report as object), chosen_at: 'x', chosen_hm: '16:30' } });
  const faite = row({ ...r, report: { ...(r.report as object), faite: true } });
  const no = row({ ...r, report: { ...(r.report as object), fallback_approved: true } });
  const t = nowOf('2026-11-21T15:05:00+04:00');
  assert.equal(isUnanswered(chosen), false);
  assert.deepEqual(pendingNudge([chosen, faite, no]), []);
  assert.deepEqual(pendingSkip([chosen, faite, no], t), []);
});

test('skip does not approve or publish a replacement (status skipped, text untouched)', () => {
  const r = row({
    id: 9, day: '2026-11-23', text: 'My Monday rule', status: 'info',
    scheduled_at: '2026-11-23T16:30:00+04:00',
    report: { mode: 'prog', fallback: 'Monday rule: do the hardest thing first.', subject: 'My Monday rule' },
  });
  const due = pendingSkip([r], dubaiNow(Date.parse('2026-11-23T15:00:00+04:00')));
  assert.equal(due.length, 1);
  assert.equal(due[0].status, 'info');
  assert.equal(due[0].text, 'My Monday rule');
  assert.equal((due[0].report as { fallback?: string }).fallback, 'Monday rule: do the hardest thing first.');
});

test('LIVE window is the 10 minutes before the slot, not after', () => {
  const at = '2026-11-18T20:35:00+04:00';
  assert.equal(inLiveWindow(at, Date.parse('2026-11-18T20:25:00+04:00')), true);
  assert.equal(inLiveWindow(at, Date.parse('2026-11-18T20:24:00+04:00')), false);
  assert.equal(inLiveWindow(at, Date.parse('2026-11-18T20:35:00+04:00')), false);
});

test('pending PROG/LIVE ignore rows already sent or marked faite; LIVE only after a chosen time', () => {
  const prog = row({
    id: 1, slot: 'bubble1', scheduled_at: '2026-11-18T11:24:00+04:00',
    report: { mode: 'prog', subject: 'A live day in Dubai', duration: '30 s', points: ['A'] },
  });
  const sent = row({ id: 2, slot: 'bubble2', scheduled_at: '2026-11-18T14:22:00+04:00', report: { mode: 'prog', sent_at: 'x' } });
  const live = row({
    id: 3, slot: 'bubble3', scheduled_at: '2026-11-18T20:35:00+04:00',
    report: { mode: 'live', subject: 'Setting up the live, 2 hours before', points: ['Desk'], duration: '30 s' },
  });
  assert.deepEqual(pendingProg([prog, sent, live]).map((r) => r.id), [1, 3]);
  const now = Date.parse('2026-11-18T20:25:00+04:00');
  // sans horaire choisi, le rappel LIVE ne part pas (même pour un mode live)
  assert.deepEqual(pendingLive([prog, live], now), []);
  const chosen = row({
    ...live,
    scheduled_at: '2026-11-18T20:35:00+04:00',
    report: { ...(live.report as object), chosen_at: '2026-11-18T11:35:00.000Z', chosen_hm: '20:35' },
  });
  assert.deepEqual(pendingLive([prog, chosen], now).map((r) => r.id), [3]);
  assert.deepEqual(pendingLive([row({ ...chosen, report: { ...(chosen.report as object), faite: true } })], now), []);
  assert.deepEqual(pendingLive([row({ ...chosen, report: { ...(chosen.report as object), live_sent_at: 'x' } })], now), []);
});

test('3 slots prefer 13:00 / 15:30 / 18:00, never before 13:00, and avoid CM posts and other bubbles by 30 min', () => {
  assert.deepEqual(SLOT_PREF, ['13:00', '15:30', '18:00']);
  const day = '2026-11-21';
  assert.deepEqual(pickBubbleSlots(day, []), ['13:00', '15:30', '18:00']);
  // un post CM à 13:26 : 13:00 est à 26 min, donc écart insuffisant ; 13:30 aussi (4 min)
  const cm1326 = '2026-11-21T13:26:00+04:00';
  const slots = pickBubbleSlots(day, [cm1326]);
  assert.equal(slots.length, 3);
  assert.ok(!slots.includes('13:00') && !slots.includes('13:30'));
  assert.ok(slots.includes('15:30') && slots.includes('18:00'));
  assert.ok(slots.every((hm) => hm >= SLOT_MIN));
  const taken = [cm1326, ...slots.map((hm) => `${day}T${hm}:00+04:00`)];
  for (const hm of slots) {
    const ms = Date.parse(`${day}T${hm}:00+04:00`);
    for (const iso of [cm1326]) {
      assert.ok(Math.abs(ms - Date.parse(iso)) >= 30 * 60_000, `${hm} trop près de ${iso}`);
    }
  }
  // un horaire avant 13:00 n'est jamais proposé, même s'il est libre
  const morning = pickBubbleSlots(day, []);
  assert.ok(morning.every((hm) => hm >= '13:00'));
  assert.ok(!morning.includes('12:30') && !morning.includes('11:48'));
  // deux bulles du même DM reçoivent des créneaux distincts (le 2e évite ceux déjà réservés)
  const first = pickBubbleSlots(day, []);
  const second = pickBubbleSlots(day, first.map((hm) => `${day}T${hm}:00+04:00`));
  assert.equal(second.length, 3);
  assert.ok(second.every((hm) => !first.includes(hm)));
  // grille encore assez fournie s'il reste peu de place
  const crowded = [
    '2026-11-21T13:00:00+04:00', '2026-11-21T14:00:00+04:00', '2026-11-21T15:00:00+04:00',
    '2026-11-21T16:00:00+04:00', '2026-11-21T17:00:00+04:00', '2026-11-21T18:00:00+04:00',
  ];
  const squeezed = pickBubbleSlots(day, crowded);
  assert.equal(squeezed.length, 3);
  assert.ok(squeezed.every((hm) => hm >= '13:00'));
  for (const hm of squeezed) {
    const ms = Date.parse(`${day}T${hm}:00+04:00`);
    assert.ok(crowded.every((iso) => Math.abs(ms - Date.parse(iso)) >= 30 * 60_000), hm);
  }
  void taken;
});

test('PROG DM has 3 time buttons per bubble plus Faite / Pas cette fois ; callback_data stays under 64 bytes', () => {
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
  const dm = formatProgDm(rows, []);
  assert.equal(dm.title, '🎥 Bulles à programmer aujourd\'hui');
  // 2 rangées de créneaux + 2 rangées Faite/Pas cette fois
  assert.equal(dm.buttonRows.length, 4);
  assert.deepEqual(dm.buttonRows[0].map((b) => b.text), ['13:00', '15:30', '18:00']);
  assert.deepEqual(dm.buttonRows[0].map((b) => b.data), ['cmb:at:11:1300', 'cmb:at:11:1530', 'cmb:at:11:1800']);
  assert.deepEqual(dm.buttonRows[1].map((b) => b.data), ['cmb:ok:11', 'cmb:no:11']);
  assert.ok(dm.buttonRows[1][0].text.includes('Faite'));
  assert.ok(dm.buttonRows[1][1].text.includes('Pas cette fois'));
  // la 2e bulle n'offre pas les mêmes créneaux
  assert.ok(dm.buttonRows[2].every((b) => !['13:00', '15:30', '18:00'].includes(b.text)));
  assert.ok(dm.buttonRows.flat().every((b) => b.data.length <= 64));
  assert.match(dm.lines.join('\n'), /A live day in Dubai/);
  const nudge = formatNudgeDm(rows, []);
  assert.match(nudge.title, /Relance/);
  assert.equal(nudge.buttonRows[0].length, 3);
});

test('choosing a slot writes scheduled_at and later arms the LIVE reminder 10 min before', () => {
  const r = row({
    id: 329, day: '2026-11-21', text: 'A Saturday in Dubai', scheduled_at: '2026-11-21T13:15:00+04:00',
    report: { mode: 'prog', subject: 'A Saturday in Dubai' },
  });
  const cm = ['2026-11-21T12:37:00+04:00', '2026-11-21T14:08:00+04:00'];
  const tooEarly = applyTimeChoice(r, '12:30', cm, '@mathieu', '2026-11-21T11:35:00.000Z');
  assert.equal(tooEarly.ok, false);
  if (!tooEarly.ok) assert.match(tooEarly.reason, /13:00/);
  const clash = applyTimeChoice(r, '13:00', ['2026-11-21T13:26:00+04:00'], '@mathieu', '2026-11-21T11:35:00.000Z');
  assert.equal(clash.ok, false);
  const ok = applyTimeChoice(r, '16:30', cm, '@mathieu', '2026-11-21T11:35:00.000Z');
  assert.equal(ok.ok, true);
  if (!ok.ok) throw new Error('expected ok');
  assert.equal(ok.scheduled_at, '2026-11-21T16:30:00+04:00');
  assert.equal(ok.report.chosen_hm, '16:30');
  assert.equal(ok.report.chosen_at, '2026-11-21T11:35:00.000Z');
  assert.equal(r.text, 'A Saturday in Dubai'); // le texte de la ligne n'est pas touché
  const updated = row({ ...r, scheduled_at: ok.scheduled_at, report: ok.report });
  const lead = Date.parse('2026-11-21T16:20:00+04:00');
  assert.deepEqual(pendingLive([updated], lead).map((x) => x.id), [329]);
  assert.deepEqual(pendingLive([updated], Date.parse('2026-11-21T16:19:00+04:00')), []);
  assert.deepEqual(pendingSkip([updated], dubaiNow(Date.parse('2026-11-21T15:00:00+04:00'))), []);
  assert.equal(atCallbackData(329, '16:30'), 'cmb:at:329:1630');
  assert.deepEqual(parseAtCallback('cmb:at:329:1630'), { id: 329, hm: '16:30' });
  assert.equal(parseAtCallback('cmb:ok:329'), null);
  assert.ok(atCallbackData(329, '16:30').length <= 64);
});

test('occupiedScheduledAt keeps approved/draft/info and ignores skipped', () => {
  const posts = [
    { id: 1, status: 'approved', scheduled_at: '2026-11-21T13:26:00+04:00' },
    { id: 2, status: 'skipped', scheduled_at: '2026-11-21T12:37:00+04:00' },
    { id: 3, status: 'info', scheduled_at: '2026-11-21T15:46:00+04:00' },
    { id: 4, status: 'draft', scheduled_at: '2026-11-21T18:30:00+04:00' },
  ];
  assert.deepEqual(occupiedScheduledAt(posts, 3), [
    '2026-11-21T13:26:00+04:00',
    '2026-11-21T18:30:00+04:00',
  ]);
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
