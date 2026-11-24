import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  briefingDue, formatBriefingMessages, inProgWindow,
  isBubbleRow, renderBubblesPlanSection, dubaiNow, pickBubbleSlots, applyTimeChoice, atCallbackData, parseAtCallback,
  occupiedScheduledAt, bubbleRowsFromScripts, SLOT_PREF, SLOT_MIN, PROG_AT, TELEGRAM_TEXT_MAX,
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
  assert.ok(WEEK_BUBBLES.every((b) => b.mode === 'prog'), 'plus de bulle live à planifier');
  assert.ok(rows.every((r) => r.report.mode === 'prog'));
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

test('11:30 sends every bubble of the day once; 13:30 and 15:00 schedule nothing, and an old live row is not a separate send', () => {
  const at = (iso: string) => dubaiNow(Date.parse(iso));
  const live = row({
    id: 3, day: '2026-11-21', slot: 'bubble3', scheduled_at: '2026-11-21T20:35:00+04:00',
    report: { mode: 'live', subject: 'Setting up the live, 2 hours before', points: ['Show the desk.'], duration: '30 s' },
  });
  const prog = row({
    id: 1, day: '2026-11-21', slot: 'bubble1', scheduled_at: '2026-11-21T13:15:00+04:00',
    report: { mode: 'prog', subject: 'A Saturday in Dubai' },
  });
  assert.deepEqual(briefingDue(at('2026-11-21T11:29:00+04:00'), [prog, live]).map((x) => x.id), []);
  assert.deepEqual(briefingDue(at('2026-11-21T11:30:00+04:00'), [prog, live]).map((x) => x.id), [1, 3]);
  assert.deepEqual(briefingDue(at('2026-11-21T13:30:00+04:00'), [prog, live]), []);
  assert.deepEqual(briefingDue(at('2026-11-21T15:00:00+04:00'), [prog, live]), []);
  const sent = row({ ...prog, report: { ...(prog.report as object), prog_sent_at: 'x' } });
  const faite = row({ ...live, report: { ...(live.report as object), faite: true } });
  const replaced = row({ ...prog, id: 4, report: { ...(prog.report as object), fallback_approved: true } });
  assert.deepEqual(briefingDue(at('2026-11-21T11:35:00+04:00'), [sent, faite, replaced]), []);
  // un horaire déjà choisi ne retire pas la bulle du message de 11:30 : Mathieu les enregistre toutes d'un coup
  const chosen = row({ ...prog, report: { ...(prog.report as object), chosen_at: 'x', chosen_hm: '16:30' } });
  assert.deepEqual(briefingDue(at('2026-11-21T11:30:00+04:00'), [chosen]).map((x) => x.id), [1]);
  // 15:00 ne change pas la ligne : pas d'abandon, le texte de remplacement reste en place
  assert.equal(prog.status, 'info');
  assert.equal(prog.text, 'A live day in Dubai');
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

test('11:30 briefing is one French-labelled script per bubble, with the lines to say in quotes', () => {
  const rows = [
    row({
      id: 11, slot: 'bubble1', scheduled_at: '2026-11-18T13:00:00+04:00',
      report: {
        mode: 'prog', theme: 'Vie à Dubaï', duration: '30 à 45 secondes',
        subject: 'Je montre à quoi ressemble un matin ici, en une phrase.',
        why: 'Le canal n\'a pas eu de coulisses depuis deux jours.',
        hook: 'Morning in Dubai, and this is what the day looks like before I open the app.',
        points: ['I walk the marina, then I read the messages from overnight.', 'Dis où tu es en ce moment, en une phrase.'],
        closing: 'Any question, write to me at @mathieu_algoria.',
      },
    }),
    row({
      id: 12, slot: 'bubble2', scheduled_at: '2026-11-18T21:50:00+04:00',
      report: {
        mode: 'prog', duration: '30 à 60 secondes',
        subject: 'Demain la journée est chargée sur l\'or, j\'explique simplement quoi surveiller.',
        why: 'Demain à 17:30, heure de Dubaï, trois chiffres américains sortent ensemble.',
        hook: 'If you follow gold, tomorrow is a big day, so here is what I am watching.',
        points: ['At 17:30 Dubai time, inflation, GDP and durable goods come out together.'],
        closing: 'That is why I do not trade by hand on days like this. Any question, write to me at @mathieu_algoria.',
      },
    }),
  ];
  const msgs = formatBriefingMessages(rows);
  assert.equal(msgs.length, 1);
  const text = msgs[0];
  assert.match(text, /Bulles à enregistrer aujourd'hui/);
  assert.match(text, /Bulle 1 — 13:00 Dubaï — 30 à 45 secondes/);
  assert.match(text, /Bulle 2 — 21:50 Dubaï — 30 à 60 secondes/);
  assert.match(text, /Sujet :/);
  assert.match(text, /Pourquoi aujourd'hui :/);
  assert.match(text, /Accroche à dire telle quelle :/);
  assert.match(text, /"Morning in Dubai, and this is what the day looks like before I open the app\."/);
  assert.match(text, /1\. "I walk the marina, then I read the messages from overnight\."/);
  assert.match(text, /2\. Dis où tu es en ce moment, en une phrase\./);
  assert.match(text, /Fin :/);
  assert.match(text, /@mathieu_algoria/);
  assert.doesNotMatch(text, /Relance|C'est le moment|cmb:/);
  assert.ok(text.length <= TELEGRAM_TEXT_MAX);
});

test('a long briefing splits on bubble boundaries and stays under the Telegram limit', () => {
  const long = 'Phrase à dire telle quelle, assez longue pour remplir le bloc. '.repeat(4);
  const rows = [1, 2, 3, 4].map((n) => row({
    id: n, slot: `bubble${n}`, scheduled_at: `2026-11-18T${12 + n}:00:00+04:00`,
    report: {
      mode: 'prog', duration: '30 à 45 secondes', subject: `Sujet ${n} en une phrase claire.`,
      why: long, hook: `Hook number ${n} for the camera.`,
      points: [`Point ${n} is a full sentence to say out loud.`],
      closing: 'Any question, write to me at @mathieu_algoria.',
    },
  }));
  const msgs = formatBriefingMessages(rows, 1200);
  assert.ok(msgs.length >= 2);
  assert.ok(msgs.every((m) => m.length <= 1200));
  assert.match(msgs[0], /Bulle 1/);
  assert.match(msgs[1], /suite/);
  const joined = msgs.join('\n');
  for (const n of [1, 2, 3, 4]) assert.match(joined, new RegExp(`Bulle ${n}`));
  // une bulle n'est pas coupée entre deux messages
  for (const m of msgs) {
    const heads = m.match(/Bulle \d/g) ?? [];
    if (heads.length === 1) assert.match(m, /@mathieu_algoria/);
  }
});

test('choosing a slot writes scheduled_at and does not schedule a live reminder or a 15:00 skip', () => {
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
  // choisir un horaire ne programme plus de rappel 10 min avant, ni d'abandon à 15:00
  assert.equal((updated.report as { chosen_hm?: string }).chosen_hm, '16:30');
  assert.equal(updated.status, 'info');
  assert.deepEqual(briefingDue(dubaiNow(Date.parse('2026-11-21T15:00:00+04:00')), [updated]), []);
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

test('plan section lists tomorrow\'s bubbles and replaces the single video idea', () => {
  const idea = { slot: 'video', kind: 'video', scheduled_at: '2026-11-18T22:30:00+04:00', text: 'How do I connect?', report: {} };
  const b1 = row({
    id: 1, slot: 'bubble1', scheduled_at: '2026-11-18T11:24:00+04:00',
    report: { mode: 'prog', theme: 'Vie à Dubaï', subject: 'A live day in Dubai' },
  });
  const sec = renderBubblesPlanSection([idea, b1]);
  assert.match(sec ?? '', /Bulles de demain/);
  assert.match(sec ?? '', /11:24 Dubaï · Vie à Dubaï — A live day in Dubai/);
  assert.doesNotMatch(sec ?? '', /LIVE/);
  assert.equal(renderBubblesPlanSection([idea]), null);
  assert.equal(isBubbleRow(idea), false);
  assert.equal(isBubbleRow(b1), true);
  const oldLive = row({
    id: 9, slot: 'bubble3', scheduled_at: '2026-11-18T20:35:00+04:00',
    report: { mode: 'live', subject: 'Setting up' },
  });
  assert.equal(isBubbleRow(oldLive), true);
});

test('new bubble rows are prog only, with the CM fields, at Dubai slots after 13:00', () => {
  const script = {
    theme: 'Or et marché',
    subject: 'Demain je dis simplement quoi surveiller.',
    why: 'Trois chiffres américains sortent demain.',
    duration: '30 à 45 secondes',
    hook: 'Here is what I am watching.',
    points: ['Inflation, GDP and durable goods come out together.', 'Dis où tu es, en une phrase.'],
    closing: 'Any question, write to me at @mathieu_algoria.',
  };
  const rows = bubbleRowsFromScripts('2026-11-25', [script, script, script, script], []);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => r.slot), ['bubble1', 'bubble2', 'bubble3', 'bubble4']);
  assert.ok(rows.every((r) => r.kind === 'video' && r.status === 'info' && r.report.mode === 'prog'));
  assert.deepEqual(rows.map((r) => r.scheduled_at.slice(11, 16)), ['13:00', '16:00', '18:30', '21:00']);
  assert.equal(rows[0].report.why, script.why);
  assert.equal(rows[0].report.hook, script.hook);
  assert.equal(rows[0].report.closing, script.closing);
  assert.equal(rows[0].text, script.hook);
  assert.deepEqual(pickBubbleSlots('2026-11-25', [], 4), ['13:00', '16:00', '18:30', '21:00']);
});
