// Machine d'état de l'alerte propriétaire MetaApi. Aucun réseau, aucune base.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { goldFeedExpected } from '../../lib/market/goldHours';
import {
  ACTION_LINE,
  BROKER_TIMEOUT_STREAK,
  FEED_SILENCE_MS,
  IMPACT_LINE,
  REMINDER_GAPS_MS,
  accountHint,
  classifyBrokerError,
  connectionSignal,
  emptyOwnerAlert,
  formatDubai,
  formatOutage,
  ownerAlertsEnabled,
  parseOwnerAlert,
  reduceOwnerAlert,
  reminderGapMs,
  runOwnerAlertStep,
  serializeOwnerAlert,
  type OwnerAlertDeps,
  type OwnerAlertEffect,
  type OwnerAlertInput,
  type OwnerAlertPersisted,
  type OwnerAlertStep,
} from './ownerAlert';

const ID = 'f9c888c5-1234-5678-9abc-def012345678';
/** Jeu 26/11/2026 04:24 Dubaï = 00:24 UTC = mer 19:24 NY. Marché ouvert. */
const OPEN = Date.parse('2026-11-26T00:24:00Z');
const WEEKEND = Date.parse('2026-11-28T12:00:00Z'); // samedi
const PAUSE = Date.parse('2026-11-02T22:30:00Z'); // lun 17:30 NY, pause d'hiver
const GRACE = Date.parse('2026-11-02T23:10:00Z'); // lun 18:10 NY, grâce
const MONDAY = Date.parse('2026-11-30T15:00:00Z'); // lun 10:00 NY

const text = (e: OwnerAlertEffect): string => (e.kind === 'none' ? '' : `${e.title}\n${e.lines.join('\n')}`);

function assertSafe(blob: string): void {
  assert.equal(blob.includes(ID), false);
  assert.equal(blob.includes('1234-5678'), false);
  assert.equal(blob.includes('888c5'), false);
  assert.equal(/token|password|secret|api[_-]?key/i.test(blob), false);
}

function timeout(now: number, accountId = ID): OwnerAlertInput {
  return { type: 'broker-timeout', now, accountId };
}
function clock(now: number): OwnerAlertInput {
  return { type: 'clock', now };
}
function quote(now: number, quoteAt: number | null, silenceFloor: number, accountId = ID): OwnerAlertInput {
  return { type: 'gold-quote', now, quoteAt, silenceFloor, accountId };
}

function ack(step: OwnerAlertStep): OwnerAlertPersisted {
  assert.ok(step.acknowledged, 'envoi à confirmer');
  return step.acknowledged;
}

test('les instants de test tombent bien ouvert / fermé / pause', () => {
  assert.equal(goldFeedExpected(new Date(OPEN)), true);
  assert.equal(goldFeedExpected(new Date(WEEKEND)), false);
  assert.equal(goldFeedExpected(new Date(PAUSE)), false);
  assert.equal(goldFeedExpected(new Date(GRACE)), false);
  assert.equal(goldFeedExpected(new Date(MONDAY)), true);
  assert.equal(formatDubai(OPEN), '26/11 04:24');
});

test('interrupteur RUNNER_OWNER_ALERTS : actif par défaut, off le coupe', () => {
  const previous = process.env.RUNNER_OWNER_ALERTS;
  delete process.env.RUNNER_OWNER_ALERTS;
  try {
    assert.equal(ownerAlertsEnabled(), true);
    assert.equal(ownerAlertsEnabled(''), true);
    assert.equal(ownerAlertsEnabled('on'), true);
    assert.equal(ownerAlertsEnabled('off'), false);
    assert.equal(ownerAlertsEnabled(' OFF '), false);
    assert.equal(ownerAlertsEnabled('0'), false);
    assert.equal(ownerAlertsEnabled('false'), false);
  } finally {
    if (previous === undefined) delete process.env.RUNNER_OWNER_ALERTS;
    else process.env.RUNNER_OWNER_ALERTS = previous;
  }
});

test('identifiant tronqué, erreur broker classée, statut de connexion', () => {
  assert.equal(accountHint(ID), 'f9c8…');
  assert.equal(accountHint('abcd'), '');
  assert.equal(accountHint(''), '');
  assert.equal(classifyBrokerError('Timed out waiting for account f9c888c5 to connect to the broker'), 'timeout');
  assert.equal(classifyBrokerError('broker disconnected'), 'disconnected');
  assert.equal(classifyBrokerError('no accounts deployed'), 'other');
  assert.equal(connectionSignal('CONNECTED'), 'up');
  assert.equal(connectionSignal('DISCONNECTED_FROM_BROKER'), 'down');
  assert.equal(connectionSignal(''), 'unknown');
  assert.equal(reminderGapMs(0), REMINDER_GAPS_MS[0]);
  assert.equal(reminderGapMs(1), REMINDER_GAPS_MS[1]);
  assert.equal(reminderGapMs(2), REMINDER_GAPS_MS[2]);
  assert.equal(reminderGapMs(10), REMINDER_GAPS_MS[2]);
  assert.equal(formatOutage(36 * 60 * 60_000 + 12 * 60_000), '36 h 12 min');
  assert.equal(formatOutage(30 * 60_000), '30 min');
  assert.equal(formatOutage(2 * 60 * 60_000), '2 h');
});

test('un timeout ne suffit pas ; le deuxième ouvre une seule alerte, heure de Dubaï du premier échec', () => {
  const base = emptyOwnerAlert();
  const first = reduceOwnerAlert(base, timeout(OPEN));
  assert.equal(first.effect.kind, 'none');
  assert.equal(first.pending.streak, 1);
  assert.equal(first.pending.incident, null);
  assert.equal(base.streak, 0, 'ne mute pas l’état passé');

  const second = reduceOwnerAlert(first.pending, timeout(OPEN + 15 * 60_000));
  assert.equal(second.effect.kind, 'initial');
  assert.equal(second.pending.incident?.startedAt, OPEN);
  assert.equal(second.pending.incident?.cause, 'broker-timeout');
  assert.equal(second.pending.streak, BROKER_TIMEOUT_STREAK);
  const blob = text(second.effect);
  assertSafe(blob);
  assert.match(blob, /🚨 MetaApi en panne/);
  assert.match(blob, /2 fois de suite/);
  assert.match(blob, /26\/11 04:24 \(heure de Dubaï\)/);
  assert.match(blob, /Compte : f9c8…/);
  assert.ok(blob.includes(IMPACT_LINE));
  assert.ok(blob.includes(ACTION_LINE));
  assert.match(blob, /ne redéploie pas en boucle \(chaque essai est facturé\)/);
  assert.match(blob, /mets un stop dans MT5 sur chaque trade manuel/);
  assert.doesNotMatch(blob, /Undeploy puis Deploy/);
  assert.equal(serializeOwnerAlert(second.pending).includes('1234-5678'), false);

  const sent = ack(second);
  const third = reduceOwnerAlert(sent, timeout(OPEN + 30 * 60_000));
  assert.equal(third.effect.kind, 'none');
  assert.equal(third.pending.incident?.startedAt, OPEN);
});

test('une déconnexion ouvre tout de suite, sans attendre un deuxième signal', () => {
  const step = reduceOwnerAlert(emptyOwnerAlert(), { type: 'broker-disconnected', now: OPEN, accountId: ID });
  assert.equal(step.effect.kind, 'initial');
  assert.equal(step.pending.incident?.cause, 'broker-disconnected');
  assert.match(text(step.effect), /déconnecté du broker/);
  assertSafe(text(step.effect));
  const again = reduceOwnerAlert(ack(step), { type: 'broker-disconnected', now: OPEN + 60_000, accountId: ID });
  assert.equal(again.effect.kind, 'none');
});

test('10 min sans tick XAUUSD ouvrent l’alerte ; 9 min, un boot récent ou l’absence d’or ne l’ouvrent pas', () => {
  const stale = reduceOwnerAlert(emptyOwnerAlert(), quote(OPEN, null, OPEN - FEED_SILENCE_MS));
  assert.equal(stale.effect.kind, 'initial');
  assert.equal(stale.pending.incident?.cause, 'feed-stale');
  assert.equal(stale.pending.incident?.startedAt, OPEN - FEED_SILENCE_MS);
  assert.equal(stale.pending.incident?.brokerUp, true);
  const blob = text(stale.effect);
  assert.match(blob, /aucun tick XAUUSD depuis 10 minutes/);
  assert.ok(blob.includes(IMPACT_LINE));
  assert.ok(blob.includes(ACTION_LINE));
  assertSafe(blob);

  const almost = reduceOwnerAlert(emptyOwnerAlert(), quote(OPEN, null, OPEN - (FEED_SILENCE_MS - 1)));
  assert.equal(almost.effect.kind, 'none');
  assert.equal(almost.pending.incident, null);

  // Cotation vieille de 30 min, mais le process vient de démarrer : on compte depuis le boot.
  const booted = reduceOwnerAlert(emptyOwnerAlert(), quote(OPEN, OPEN - 30 * 60_000, OPEN - 60_000));
  assert.equal(booted.pending.incident, null);

  const noGold = reduceOwnerAlert(emptyOwnerAlert(), {
    type: 'health', now: OPEN, quoteAt: null, silenceFloor: OPEN - 30 * 60_000,
    connectionStatus: '', accountId: ID, watchGold: false,
  });
  assert.equal(noGold.pending.incident, null);
});

test('pas d’alerte le week-end, pendant la pause quotidienne, ni dans la grâce de réouverture', () => {
  for (const now of [WEEKEND, PAUSE, GRACE]) {
    const timeouts = reduceOwnerAlert(reduceOwnerAlert(emptyOwnerAlert(), timeout(now)).pending, timeout(now + 15 * 60_000));
    assert.equal(timeouts.effect.kind, 'none', `timeout ${now}`);
    assert.equal(timeouts.pending.incident, null);
    const silence = reduceOwnerAlert(emptyOwnerAlert(), quote(now, null, now - 30 * 60_000));
    assert.equal(silence.effect.kind, 'none', `silence ${now}`);
    assert.equal(silence.pending.incident, null);
    const down = reduceOwnerAlert(emptyOwnerAlert(), { type: 'broker-disconnected', now, accountId: ID });
    assert.equal(down.effect.kind, 'none', `disconnect ${now}`);
  }
});

test('rappels à 30 min, puis 1 h, puis toutes les 3 h — pas avant, et pas le week-end', () => {
  const opened = reduceOwnerAlert(
    reduceOwnerAlert(emptyOwnerAlert(), timeout(OPEN)).pending,
    timeout(OPEN + 15 * 60_000),
  );
  const sentAt = OPEN + 15 * 60_000;
  let state = ack(opened);
  assert.equal(state.incident?.lastSentAt, sentAt);

  assert.equal(reduceOwnerAlert(state, clock(sentAt + 29 * 60_000)).effect.kind, 'none');
  const r1 = reduceOwnerAlert(state, clock(sentAt + 30 * 60_000));
  assert.equal(r1.effect.kind, 'reminder');
  assert.match(text(r1.effect), /⏳ MetaApi toujours en panne — 45 min/);
  assert.match(text(r1.effect), /En panne depuis 45 min/);
  assert.doesNotMatch(text(r1.effect), /🚨 MetaApi en panne/);
  assert.ok(text(r1.effect).includes(ACTION_LINE));
  assert.doesNotMatch(text(r1.effect), /Undeploy puis Deploy/);
  assertSafe(text(r1.effect));
  state = ack(r1);
  assert.equal(state.incident?.remindersSent, 1);

  assert.equal(reduceOwnerAlert(state, clock(state.incident!.lastSentAt! + 59 * 60_000)).effect.kind, 'none');
  const r2 = reduceOwnerAlert(state, clock(state.incident!.lastSentAt! + 60 * 60_000));
  assert.equal(r2.effect.kind, 'reminder');
  state = ack(r2);
  assert.equal(state.incident?.remindersSent, 2);

  assert.equal(reduceOwnerAlert(state, clock(state.incident!.lastSentAt! + 3 * 60 * 60_000 - 60_000)).effect.kind, 'none');
  const r3 = reduceOwnerAlert(state, clock(state.incident!.lastSentAt! + 3 * 60 * 60_000));
  assert.equal(r3.effect.kind, 'reminder');
  state = ack(r3);
  assert.equal(state.incident?.remindersSent, 3);
  assert.equal(reduceOwnerAlert(state, clock(state.incident!.lastSentAt! + 3 * 60 * 60_000 - 1)).effect.kind, 'none');

  const weekend = reduceOwnerAlert(state, clock(WEEKEND));
  assert.equal(weekend.effect.kind, 'none');
  assert.equal(weekend.pending.incident?.remindersSent, 3);
  assert.equal(weekend.pending.incident?.startedAt, OPEN);

  const monday = reduceOwnerAlert(weekend.pending, clock(MONDAY));
  assert.equal(monday.effect.kind, 'reminder');
  assert.equal(monday.pending.incident?.startedAt, OPEN);
  assertSafe(text(monday.effect));
});

test('rétablissement seulement quand le broker ET les ticks sont revenus, avec la durée', () => {
  const opened = reduceOwnerAlert(
    reduceOwnerAlert(emptyOwnerAlert(), timeout(OPEN)).pending,
    timeout(OPEN + 60_000),
  );
  const down = ack(opened);
  const upOnly = reduceOwnerAlert(down, { type: 'broker-up', now: OPEN + 10 * 60_000 });
  assert.equal(upOnly.effect.kind, 'none');
  assert.equal(upOnly.pending.incident?.brokerUp, true);
  assert.equal(upOnly.pending.incident?.ticksUp, false);

  const tickOnly = reduceOwnerAlert(down, quote(OPEN + 10 * 60_000, OPEN + 10 * 60_000 - 10_000, OPEN));
  assert.equal(tickOnly.effect.kind, 'none');
  assert.equal(tickOnly.pending.incident?.ticksUp, true);
  assert.equal(tickOnly.pending.incident?.brokerUp, false);

  const back = reduceOwnerAlert(upOnly.pending, quote(OPEN + 20 * 60_000, OPEN + 20 * 60_000 - 5_000, OPEN));
  assert.equal(back.effect.kind, 'recovered');
  const blob = text(back.effect);
  assert.match(blob, /✅ MetaApi rétabli/);
  assert.match(blob, /La connexion au broker est revenue et les ticks XAUUSD ont repris/);
  assert.match(blob, /Durée totale de la panne : 20 min/);
  assert.match(blob, /26\/11 04:24, heure de Dubaï/);
  assertSafe(blob);
  assert.equal(back.acknowledged?.incident, null);

  // Une nouvelle panne après le rétablissement repart de zéro.
  const again = reduceOwnerAlert(
    reduceOwnerAlert(ack(back), timeout(OPEN + 40 * 60_000)).pending,
    timeout(OPEN + 55 * 60_000),
  );
  assert.equal(again.effect.kind, 'initial');
  assert.equal(again.pending.incident?.startedAt, OPEN + 40 * 60_000);
});

test('un tick frais sans statut CONNECTED ne suffit pas ; CONNECTED + tick rétabli ; une déconnexion gagne sur un tick en cache', () => {
  const opened = ack(reduceOwnerAlert(
    reduceOwnerAlert(emptyOwnerAlert(), timeout(OPEN)).pending,
    timeout(OPEN + 60_000),
  ));
  const healthTick = reduceOwnerAlert(opened, {
    type: 'health', now: OPEN + 5 * 60_000, quoteAt: OPEN + 5 * 60_000 - 1_000,
    silenceFloor: OPEN, connectionStatus: '', accountId: ID, watchGold: true,
  });
  assert.equal(healthTick.effect.kind, 'none');
  assert.equal(healthTick.pending.incident?.ticksUp, true);
  assert.equal(healthTick.pending.incident?.brokerUp, false);

  const healthBoth = reduceOwnerAlert(opened, {
    type: 'health', now: OPEN + 6 * 60_000, quoteAt: OPEN + 6 * 60_000 - 1_000,
    silenceFloor: OPEN, connectionStatus: 'CONNECTED', accountId: ID, watchGold: true,
  });
  assert.equal(healthBoth.effect.kind, 'recovered');

  const flap = reduceOwnerAlert(emptyOwnerAlert(), {
    type: 'health', now: OPEN, quoteAt: OPEN - 1_000, silenceFloor: OPEN - 60_000,
    connectionStatus: 'DISCONNECTED_FROM_BROKER', accountId: ID, watchGold: true,
  });
  assert.equal(flap.effect.kind, 'initial');
  assert.equal(flap.pending.incident?.cause, 'broker-disconnected');
  assert.equal(flap.pending.incident?.ticksUp, false);

  // FEED STALE : le broker n'a pas été marqué down. Le retour des ticks suffit à clore.
  const stale = ack(reduceOwnerAlert(emptyOwnerAlert(), quote(OPEN, null, OPEN - FEED_SILENCE_MS)));
  assert.equal(stale.incident?.brokerUp, true);
  const ticksBack = reduceOwnerAlert(stale, quote(OPEN + 60_000, OPEN + 59_000, OPEN));
  assert.equal(ticksBack.effect.kind, 'recovered');
});

test('deux timeouts pendant un incident flux mettent à jour la cause sans seconde alerte', () => {
  const opened = ack(reduceOwnerAlert(emptyOwnerAlert(), quote(OPEN, null, OPEN - FEED_SILENCE_MS)));
  const startedAt = opened.incident?.startedAt;
  const once = reduceOwnerAlert(opened, timeout(OPEN + 5 * 60_000));
  assert.equal(once.effect.kind, 'none');
  assert.equal(once.pending.incident?.cause, 'feed-stale');
  const twice = reduceOwnerAlert(once.pending, timeout(OPEN + 20 * 60_000));
  assert.equal(twice.effect.kind, 'none');
  assert.equal(twice.pending.incident?.cause, 'broker-timeout');
  assert.equal(twice.pending.incident?.startedAt, startedAt);
  assert.equal(twice.pending.incident?.initialSent, true);
});

test('reprise après redémarrage : une alerte déjà partie ne repart pas, le rappel oui', () => {
  const opened = reduceOwnerAlert(
    reduceOwnerAlert(emptyOwnerAlert(), timeout(OPEN)).pending,
    timeout(OPEN + 15 * 60_000),
  );
  const saved = serializeOwnerAlert(ack(opened));
  const loaded = parseOwnerAlert(saved);
  assert.equal(loaded.incident?.startedAt, OPEN);
  assert.equal(loaded.incident?.initialSent, true);
  assert.equal(loaded.incident?.cause, 'broker-timeout');

  const soon = reduceOwnerAlert(loaded, clock(OPEN + 16 * 60_000));
  assert.equal(soon.effect.kind, 'none');
  assert.equal(soon.pending.incident?.startedAt, OPEN);

  const later = reduceOwnerAlert(loaded, clock(OPEN + 15 * 60_000 + 30 * 60_000));
  assert.equal(later.effect.kind, 'reminder');
  assert.equal(later.pending.incident?.startedAt, OPEN);

  assert.equal(parseOwnerAlert('pas du json').incident, null);
  assert.equal(parseOwnerAlert(null).streak, 0);
  const round = parseOwnerAlert(serializeOwnerAlert(loaded));
  assert.deepEqual(round, loaded);
});

test('un broker revenu entre deux timeouts remet le compteur à zéro', () => {
  const one = reduceOwnerAlert(emptyOwnerAlert(), timeout(OPEN)).pending;
  const up = reduceOwnerAlert(one, { type: 'broker-up', now: OPEN + 60_000 }).pending;
  const next = reduceOwnerAlert(up, timeout(OPEN + 2 * 60_000));
  assert.equal(next.pending.streak, 1);
  assert.equal(next.pending.incident, null);
});

test('le week-end efface une série d’échecs incomplète : elle ne se recolle pas au lundi', () => {
  const one = reduceOwnerAlert(emptyOwnerAlert(), timeout(OPEN));
  assert.equal(one.pending.streak, 1);
  const sat = reduceOwnerAlert(one.pending, clock(WEEKEND));
  assert.equal(sat.pending.streak, 0);
  assert.equal(sat.pending.incident, null);
  const monday = reduceOwnerAlert(sat.pending, timeout(MONDAY));
  assert.equal(monday.pending.streak, 1);
  assert.equal(monday.pending.incident, null);
});

function memoryDeps(over: Partial<OwnerAlertDeps> = {}): { deps: OwnerAlertDeps; sends: OwnerAlertEffect[]; store: { raw: string | null | undefined } } {
  const store: { raw: string | null | undefined } = { raw: null };
  const sends: OwnerAlertEffect[] = [];
  const deps: OwnerAlertDeps = {
    active: () => true,
    load: async () => store.raw,
    save: async (v) => { store.raw = v; return true; },
    send: async (effect) => { sends.push(effect); return { dm: 1, push: 0 }; },
    ...over,
  };
  return { deps, sends, store };
}

test('échec d’envoi : pas d’exception, l’alerte initiale est redemandée, pas un rappel', async () => {
  const box = memoryDeps({ send: async (effect) => { box.sends.push(effect); return { dm: 0, push: 0 }; } });
  await runOwnerAlertStep(timeout(OPEN), box.deps);
  await runOwnerAlertStep(timeout(OPEN + 15 * 60_000), box.deps);
  assert.equal(box.sends.length, 1);
  assert.equal(box.sends[0].kind, 'initial');
  assert.equal(parseOwnerAlert(box.store.raw).incident?.initialSent, false);

  await runOwnerAlertStep(clock(OPEN + 16 * 60_000), box.deps);
  assert.equal(box.sends.length, 2);
  assert.equal(box.sends[1].kind, 'initial');
  assert.equal(parseOwnerAlert(box.store.raw).incident?.initialSent, false);

  box.deps.send = async (effect) => { box.sends.push(effect); return { dm: 1, push: 0 }; };
  await runOwnerAlertStep(clock(OPEN + 17 * 60_000), box.deps);
  assert.equal(box.sends.length, 3);
  assert.equal(parseOwnerAlert(box.store.raw).incident?.initialSent, true);
  assert.equal(parseOwnerAlert(box.store.raw).incident?.remindersSent, 0);

  await runOwnerAlertStep(clock(OPEN + 18 * 60_000), box.deps);
  assert.equal(box.sends.length, 3);
});

test('un envoi qui lance, une base illisible ou l’interrupteur coupé ne sortent pas de la fonction', async () => {
  const exploding = memoryDeps({
    send: async () => { throw new Error('telegram down'); },
  });
  await runOwnerAlertStep(timeout(OPEN), exploding.deps);
  await runOwnerAlertStep(timeout(OPEN + 60_000), exploding.deps);
  assert.equal(parseOwnerAlert(exploding.store.raw).incident?.initialSent, false);

  let loads = 0;
  let sends = 0;
  await runOwnerAlertStep(timeout(OPEN), {
    active: () => false,
    load: async () => { loads += 1; return null; },
    save: async () => true,
    send: async () => { sends += 1; return { dm: 1, push: 0 }; },
  });
  assert.equal(loads, 0);
  assert.equal(sends, 0);

  sends = 0;
  await runOwnerAlertStep(timeout(OPEN), {
    active: () => true,
    load: async () => undefined,
    save: async () => { throw new Error('no'); },
    send: async () => { sends += 1; return { dm: 1, push: 0 }; },
  });
  assert.equal(sends, 0);

  await runOwnerAlertStep(timeout(OPEN), {
    active: () => true,
    load: async () => { throw new Error('db'); },
    save: async () => true,
    send: async () => ({ dm: 1, push: 0 }),
  });
});

test('le push de secours compte comme délivré ; après rétablissement la ligne d’état est vide', async () => {
  const box = memoryDeps({ send: async (effect) => { box.sends.push(effect); return { dm: 0, push: 1 }; } });
  await runOwnerAlertStep(timeout(OPEN), box.deps);
  await runOwnerAlertStep(timeout(OPEN + 60_000), box.deps);
  assert.equal(parseOwnerAlert(box.store.raw).incident?.initialSent, true);

  await runOwnerAlertStep({ type: 'broker-up', now: OPEN + 5 * 60_000 }, box.deps);
  await runOwnerAlertStep(quote(OPEN + 6 * 60_000, OPEN + 6 * 60_000 - 1_000, OPEN), box.deps);
  assert.equal(box.sends.at(-1)?.kind, 'recovered');
  assert.equal(parseOwnerAlert(box.store.raw).incident, null);
  assert.equal(box.store.raw?.includes(ID), false);
});
