// Contrôle local, pas le runtime, pas la CI. Depuis la racine du dépôt :
//   npx tsx scripts/checks/webinar-reminders.ts
//
// Les rappels du webinar gardent le résultat de chaque envoi (28/10/2026 : 181/193 reçus, 12 échecs muets). Aucune
// base, aucun appel Telegram : une fausse base en mémoire, et fetch remplacé (rien ne sort de la machine).
import { readFileSync } from 'node:fs';
import { classifyTelegramError, registerForWebinar, REMINDER_MAX_RETRIES, runWebinarReminders } from '../../lib/member/webinar';

let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`ok  ${name}`); return; }
  failed++;
  console.error(`ECHEC  ${name}${detail ? ` — ${detail}` : ''}`);
}

const SID = '2026-11-01';
const TRACK_COLS = ['last_reminder_error', 'last_reminder_error_at', 'unreachable_at', 'reminder_retries'];
type Reg = { id: number; session_id: string; tg_id: number; reminded_24h_at: string | null; reminded_1h_at: string | null; reminded_live_at: string | null;
  last_reminder_error?: string | null; last_reminder_error_at?: string | null; unreachable_at?: string | null; reminder_retries?: number | null };

function fakeDb(o: { regs: Reg[]; startsInMs: number; tracking: boolean }) {
  const log = { blockedNoted: [] as number[], badColumnWrites: 0 };
  const session = { id: SID, starts_at: new Date(Date.now() + o.startsInMs).toISOString(), zoom_url: 'https://us05web.zoom.us/j/12345678901?pwd=test', alert_zoom_at: null, alert_count_at: 'x' };
  class Q {
    f: Array<[string, string, unknown]> = []; op = 'select'; payload: Record<string, unknown> | null = null; head = false; cols = '';
    constructor(public t: string) {}
    select(c?: string, opt?: { head?: boolean }) { if (opt?.head) this.head = true; if (this.op === 'select') this.cols = c ?? ''; return this; }
    eq(c: string, v: unknown) { this.f.push(['eq', c, v]); return this; }
    is(c: string, v: unknown) { this.f.push(['is', c, v]); return this; }
    not(c: string, _op: string, v: unknown) { this.f.push(['not', c, v]); return this; }
    in(c: string, v: unknown) { this.f.push(['in', c, v]); return this; }
    like(c: string, v: string) { this.f.push(['like', c, v]); return this; }
    gt() { return this; } lt() { return this; } lte() { return this; } order() { return this; } limit(n: number) { this.f.push(['limit', '', n]); return this; }
    update(p: Record<string, unknown>) { this.op = 'update'; this.payload = p; return this; }
    upsert(p: Record<string, unknown>) { this.op = 'upsert'; this.payload = p; return this; }
    match(r: Reg): boolean {
      const g = r as unknown as Record<string, unknown>;
      return this.f.every(([k, c, v]) => {
        if (k === 'eq') return g[c] === v;
        if (k === 'is') return (g[c] ?? null) === v;
        if (k === 'not') return (g[c] ?? null) !== v;
        if (k === 'in') return (v as unknown[]).includes(g[c]);
        if (k === 'like') return String(g[c] ?? '').startsWith(String(v).replace(/%$/, ''));
        return true;
      });
    }
    run(): unknown {
      if (this.t === 'webinar_sessions') return this.op === 'select' ? { data: [session] } : { data: [] };
      if (this.t === 'webinar_invites') { if (this.op === 'update') log.blockedNoted.push(Number(this.f.find((x) => x[1] === 'tg_id')?.[2])); return {}; }
      if (this.t === 'support_settings') return { data: [] };
      // webinar_registrations
      const missing = !o.tracking && (TRACK_COLS.some((c) => this.cols.includes(c)) || this.f.some(([, c]) => TRACK_COLS.includes(c)) || Object.keys(this.payload ?? {}).some((c) => TRACK_COLS.includes(c)));
      if (missing) { if (this.op === 'update') log.badColumnWrites++; return { data: null, error: { message: 'column does not exist' } }; }
      const rows = o.regs.filter((r) => this.match(r));
      if (this.op === 'upsert') return {};
      if (this.op === 'update') { for (const r of rows) Object.assign(r, this.payload); return { data: rows.map((r) => ({ ...r })) }; }
      if (this.head) return { count: rows.length };
      const lim = this.f.find((x) => x[0] === 'limit')?.[2] as number | undefined;
      return { data: rows.slice(0, lim ?? rows.length), error: null };
    }
    then(res: (x: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(this.run()).then(res, rej); }
  }
  return { db: { from: (t: string) => new Q(t) }, log, session, regs: o.regs };
}

// fetch remplacé : le comportement de chaque destinataire, par tg_id
const OWNER = 999;
const behaviour = new Map<number, string>();
const sent: Array<{ chat: number; text: string }> = [];
const owner: string[] = [];
globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
  const body = JSON.parse(String(init?.body ?? '{}')) as { chat_id?: number; text?: string };
  const chat = Number(body.chat_id);
  if (chat === OWNER) { owner.push(String(body.text)); return new Response('{"ok":true}', { status: 200 }); }
  const b = behaviour.get(chat) ?? 'ok';
  if (b === 'timeout') { const e = new Error('timed out'); e.name = 'TimeoutError'; throw e; }
  sent.push({ chat, text: String(body.text) });
  const res = (status: number, description: string, extra: object = {}) => new Response(JSON.stringify({ ok: false, description, ...extra }), { status });
  if (b === 'blocked') return res(403, 'Forbidden: bot was blocked by the user');
  if (b === 'deactivated') return res(403, 'Forbidden: user is deactivated');
  if (b === 'notfound') return res(400, 'Bad Request: chat not found');
  if (b === 'bad') return res(400, 'Bad Request: BUTTON_URL_INVALID');
  if (b === '500') return res(502, 'Bad Gateway');
  if (b === '429') return res(429, 'Too Many Requests: retry after 7', { parameters: { retry_after: 7 } });
  if (b === 'flaky') { behaviour.set(chat, 'ok'); return res(500, 'Internal Server Error'); }
  return new Response('{"ok":true}', { status: 200 });
}) as typeof fetch;
process.env.TELEGRAM_BOT_TOKEN = 'test-token-not-real';
process.env.OWNER_TG_IDS = String(OWNER);
delete process.env.ADMIN_TG_USERNAMES;
for (const k of ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_KEY']) delete process.env[k];

const regs = (spec: string[]): Reg[] => spec.map((b, i) => {
  const tg = 1000 + i;
  behaviour.set(tg, b);
  return { id: i + 1, session_id: SID, tg_id: tg, reminded_24h_at: null, reminded_1h_at: null, reminded_live_at: null };
});
const reset = () => { sent.length = 0; owner.length = 0; behaviour.clear(); };
const IN_50_MIN = 50 * 60_000, IN_30_S = 30_000;

async function main() {
  // 0. le classement des refus de Telegram
  {
    check('429 et 5xx : reprise', classifyTelegramError(429, 'Too Many Requests') === 'retry' && classifyTelegramError(502, 'Bad Gateway') === 'retry');
    check('403 : injoignable', classifyTelegramError(403, 'Forbidden: bot was blocked by the user') === 'unreachable' && classifyTelegramError(403, 'Forbidden: user is deactivated') === 'unreachable');
    check('chat not found : injoignable', classifyTelegramError(400, 'Bad Request: chat not found') === 'unreachable');
    check('autre 400 : refus simple', classifyTelegramError(400, 'Bad Request: BUTTON_URL_INVALID') === 'failed');
    check('2 reprises au plus', REMINDER_MAX_RETRIES === 2);
  }
  // 1. rappel d'1 h, avec suivi : chaque résultat est gardé, les erreurs passagères sont reprises au passage suivant
  {
    reset();
    const f = fakeDb({ regs: regs(['ok', 'ok', 'ok', 'ok', 'ok', 'blocked', 'deactivated', 'flaky', 'timeout', 'bad']), startsInMs: IN_50_MIN, tracking: true });
    const r1 = await runWebinarReminders(f.db);
    check('passage 1 : compteurs', r1.sent === 5 && r1.unreachable === 2 && r1.retry === 2 && r1.failed === 1 && r1.tracking, JSON.stringify(r1));
    const by = (tg: number) => regsOf(f, tg);
    check('passage 1 : reprises rendues (colonne à null, 1 reprise, erreur gardée)', [1007, 1008].every((tg) => by(tg).reminded_1h_at === null && by(tg).reminder_retries === 1 && /^1h: /.test(String(by(tg).last_reminder_error))), JSON.stringify([by(1007), by(1008)]));
    check('passage 1 : erreur réseau notée « timeout »', by(1008).last_reminder_error === '1h: timeout');
    check('passage 1 : injoignables marqués, rappel gardé', [1005, 1006].every((tg) => by(tg).reminded_1h_at !== null && by(tg).unreachable_at));
    check('passage 1 : bot bloqué reporté sur les invitations (noteBotBlocked)', f.log.blockedNoted.join() === '1005', f.log.blockedNoted.join());
    check('passage 1 : refus simple gardé, pas repris', by(1009).reminded_1h_at !== null && !by(1009).unreachable_at && /BUTTON_URL_INVALID/.test(String(by(1009).last_reminder_error)));
    check('passage 1 : pas de bilan tant que des reprises attendent', owner.filter((t) => t.includes('Rappel')).length === 0, owner.join(' | '));
    behaviour.set(1008, 'ok');
    sent.length = 0;
    const r2 = await runWebinarReminders(f.db);
    check('passage 2 : seuls les 2 rendus repartent', r2.sent === 2 && sent.length === 2 && sent.every((s) => [1007, 1008].includes(s.chat)), JSON.stringify(r2) + JSON.stringify(sent.map((s) => s.chat)));
    check('passage 2 : reçus après reprise → erreur effacée', [1007, 1008].every((tg) => by(tg).reminded_1h_at !== null && by(tg).reminder_retries === null && by(tg).last_reminder_error === null));
    const bilan = owner.find((t) => t.includes('Rappel d’1 h')) ?? '';
    check('passage 2 : bilan envoyé à Mathieu (7/10 reçus, 2 injoignables, 1 échec)', /7\/10 inscrits/.test(bilan) && /2 injoignables/.test(bilan) && /1 en échec/.test(bilan), bilan);
    sent.length = 0; owner.length = 0;
    const r3 = await runWebinarReminders(f.db);
    check('passage 3 : plus rien à envoyer, pas de 2e bilan', r3.sent + r3.failed + r3.retry + r3.unreachable === 0 && sent.length === 0 && !owner.some((t) => t.includes('Rappel')));

    // 2. le rappel du début : les injoignables ne sont plus sollicités, le 1h n'est jamais renvoyé après l'heure
    f.session.starts_at = new Date(Date.now() + IN_30_S).toISOString();
    sent.length = 0;
    const r4 = await runWebinarReminders(f.db);
    check('début : 8 essais (pas les 2 injoignables), le refus simple échoue encore', r4.sent === 7 && r4.failed === 1 && sent.length === 8 && !sent.some((s) => [1005, 1006].includes(s.chat)), JSON.stringify(r4));
    check('début : seulement le texte du début', sent.every((s) => s.text.startsWith('🔴 The live is starting now!')));
  }
  // 3. plafond des reprises : 3 essais au plus, puis abandon noté (et le rappel reste marqué)
  {
    reset();
    const f = fakeDb({ regs: regs(['500']), startsInMs: IN_50_MIN, tracking: true });
    const outs = [];
    for (let i = 0; i < 5; i++) outs.push(await runWebinarReminders(f.db));
    const r = regsOf(f, 1000);
    check('500 en boucle : 3 essais, puis plus rien', sent.length === 3 && outs.map((o) => `${o.retry}${o.failed}`).join() === '10,10,01,00,00', outs.map((o) => `${o.retry}${o.failed}`).join());
    check('abandon noté, rappel marqué', r.reminded_1h_at !== null && /abandon après 3 essais/.test(String(r.last_reminder_error)) && r.reminder_retries === null, JSON.stringify(r));
  }
  // 4. une reprise en attente ne part JAMAIS en rappel d'1 h après le début
  {
    reset();
    const f = fakeDb({ regs: regs(['flaky']), startsInMs: IN_50_MIN, tracking: true });
    await runWebinarReminders(f.db);
    f.session.starts_at = new Date(Date.now() + IN_30_S).toISOString(); // le passage suivant tombe à l'heure du début
    sent.length = 0;
    await runWebinarReminders(f.db);
    check('reprise à l’heure du début : texte du début, pas « In 1 hour »', sent.length === 1 && sent[0].text.startsWith('🔴') && !sent.some((s) => s.text.startsWith('⏰')), JSON.stringify(sent));
    f.session.starts_at = new Date(Date.now() - 31 * 60_000).toISOString(); // fenêtre du début dépassée
    sent.length = 0;
    regsOf(f, 1000).reminded_live_at = null;
    await runWebinarReminders(f.db);
    check('plus de 30 min après le début : rien', sent.length === 0);
  }
  // 5. 429 : le passage s'arrête après le paquet, le reste attend le passage suivant (rien de perdu)
  {
    reset();
    const spec = Array.from({ length: 45 }, (_, i) => (i === 3 ? '429' : 'ok'));
    const f = fakeDb({ regs: regs(spec), startsInMs: IN_50_MIN, tracking: true });
    const r = await runWebinarReminders(f.db);
    const pending = regsAll(f).filter((x) => x.reminded_1h_at === null).length;
    check('429 : un seul paquet de 20 ce passage', sent.length === 20 && r.sent === 19 && r.retry === 1, JSON.stringify(r));
    check('429 : 26 en attente (25 jamais réservés + 1 rendu)', pending === 26, String(pending));
    check('429 : retry_after gardé dans l’erreur', /retry_after 7s/.test(String(regsOf(f, 1003).last_reminder_error)));
    behaviour.set(1003, 'ok');
    sent.length = 0;
    await runWebinarReminders(f.db);
    check('429 : le passage suivant finit le travail', sent.length === 26 && regsAll(f).every((x) => x.reminded_1h_at !== null));
  }
  // 6. SANS la migration 0039 : l'ancien comportement (marqué, pas de reprise), aucune écriture sur une colonne absente
  {
    reset();
    const f = fakeDb({ regs: regs(['ok', 'ok', 'blocked', '500', 'timeout']), startsInMs: IN_50_MIN, tracking: false });
    const r = await runWebinarReminders(f.db);
    check('sans migration : compteurs', !r.tracking && r.sent === 2 && r.unreachable === 1 && r.failed === 2 && r.retry === 0, JSON.stringify(r));
    check('sans migration : tous marqués (comme avant), aucune écriture de colonne absente', regsAll(f).every((x) => x.reminded_1h_at !== null) && f.log.badColumnWrites === 0, String(f.log.badColumnWrites));
    const bilan = owner.find((t) => t.includes('Rappel')) ?? '';
    check('sans migration : bilan du passage + mention de la migration', /2 envoyés/.test(bilan) && /migration 0039/.test(bilan), bilan);
    sent.length = 0;
    await runWebinarReminders(f.db);
    check('sans migration : rien n’est renvoyé', sent.length === 0);
  }
  // 7. sans jeton Telegram : personne n'est marqué
  {
    reset();
    const tok = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    const f = fakeDb({ regs: regs(['ok', 'ok']), startsInMs: IN_50_MIN, tracking: true });
    await runWebinarReminders(f.db);
    check('sans jeton : rien de réservé', regsAll(f).every((x) => x.reminded_1h_at === null));
    process.env.TELEGRAM_BOT_TOKEN = tok;
  }
  // 8. inscription à moins d'1 h : marqué seulement si le lien est parti
  {
    reset();
    const f = fakeDb({ regs: regs(['500', 'ok']), startsInMs: IN_50_MIN, tracking: true });
    await registerForWebinar(f.db as never, { id: 1000 }, SID);
    await registerForWebinar(f.db as never, { id: 1001 }, SID);
    check('inscription tardive, envoi raté : pas marqué (la cron reprendra)', regsOf(f, 1000).reminded_1h_at === null);
    check('inscription tardive, envoi réussi : marqué', regsOf(f, 1001).reminded_1h_at !== null);
    regsOf(f, 1000).unreachable_at = 'x';
    await registerForWebinar(f.db as never, { id: 1000 }, SID);
    check('réinscription : de nouveau joignable', (regsOf(f, 1000).unreachable_at ?? null) === null);
  }
  // 9. rien d'autre n'a bougé
  {
    const wb = readFileSync(new URL('../../lib/member/webinar.ts', import.meta.url), 'utf8');
    check('aucun paramètre temperature', !/temperature/i.test(wb));
    check('fenêtres des rappels inchangées', wb.includes('left <= HOUR && left > 60_000') && wb.includes('left <= 60_000 && left > -30 * 60_000'));
    check('marquage avant envoi conservé', wb.includes(".update({ [st.col]: iso(now) }).in('id', ids.slice(k, k + 20)).is(st.col, null)"));
    check('coupe-circuit des invitations inchangé', wb.includes('const BREAKER = { minSent: 80, rate: 0.04 };'));
  }
  if (failed) { console.error(`\n${failed} contrôle(s) en échec`); process.exit(1); }
  console.log('\ntous les contrôles passent');
}

// les lignes de la fausse base
type Fake = { regs: Reg[] };
const regsAll = (f: Fake): Reg[] => f.regs;
function regsOf(f: Fake, tg: number): Reg { const r = f.regs.find((x) => x.tg_id === tg); if (!r) throw new Error(`tg ${tg} absent`); return r; }

main().catch((e) => { console.error(e); process.exit(1); });
