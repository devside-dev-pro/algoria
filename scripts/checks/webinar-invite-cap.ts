// Contrôle local, pas le runtime, pas la CI. Depuis la racine du dépôt :
//   npx tsx scripts/checks/webinar-invite-cap.ts
//
// Le plafond des invitations au webinar (28/10/2026) : il compte les invitations reçues (sans erreur), il se règle
// par 'webinar_invite_cap', et 'webinar_invite_not_before' retient la vague jusqu'à son heure. Aucune base, aucun
// appel Telegram : une fausse base en mémoire, et fetch remplacé (rien ne sort de la machine).
import { readFileSync } from 'node:fs';
import { parseInviteCap, parseNotBefore, runWebinarInvites } from '../../lib/member/webinar';

let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`ok  ${name}`); return; }
  failed++;
  console.error(`ECHEC  ${name}${detail ? ` — ${detail}` : ''}`);
}

// ── la lecture des réglages ──────────────────────────────────────────────────
{
  check('cap absent → 500', parseInviteCap(undefined) === 500 && parseInviteCap('') === 500 && parseInviteCap(null) === 500);
  check('cap 1402', parseInviteCap('1402') === 1402 && parseInviteCap(' 1402 ') === 1402);
  check('cap illisible → 500', ['abc', '-5', '12.5', '1e3', '0', '1 000', '500abc'].every((v) => parseInviteCap(v) === 500));
  check('cap trop grand → 3000', parseInviteCap('99999') === 3000 && parseInviteCap('999999999999') === 500);
  const nb = Date.UTC(2026, 9, 28, 13, 0, 0);
  check('not_before ISO Z', parseNotBefore('2026-10-28T13:00:00Z') === nb);
  check('not_before en minuscules (setting() met tout en minuscules)', parseNotBefore('2026-10-28t13:00:00z') === nb);
  check('not_before avec décalage', parseNotBefore('2026-10-28T17:00:00+04:00') === nb && parseNotBefore('2026-10-28T13:00:00.000Z') === nb);
  check('not_before illisible ou sans fuseau → null', ['', 'off', 'tomorrow', '2026-10-28', '2026-10-28T13:00:00', '2026-13-45T99:00:00Z'].every((v) => parseNotBefore(v) === null));
}

// ── une fausse base ──────────────────────────────────────────────────────────
type Row = { session_id: string; tg_id: number; error: string | null; blocked_at: string | null };
const SID = '2026-10-28';
const START = new Date(Date.now() + 5 * 3_600_000).toISOString(); // dans la fenêtre (25 h → 2 h avant)

function fakeDb(o: { settings: Record<string, string>; invites: Row[]; pool: number; failEvery?: number }) {
  const log = { rpcLimits: [] as number[], closes: [] as string[], sessionQueried: false };
  let nextId = 1_000_000;
  const pool = Array.from({ length: o.pool }, () => ({ tg_id: nextId++, tg_name: 'Test' }));
  const take = (limit: number) => pool.filter((p) => !o.invites.some((i) => i.tg_id === p.tg_id)).slice(0, limit);
  class Q {
    f: Array<[string, string, unknown]> = []; op = 'select'; payload: unknown = null; head = false;
    constructor(public t: string) {}
    select(_c?: string, opt?: { head?: boolean }) { if (opt?.head) this.head = true; return this; }
    eq(c: string, v: unknown) { this.f.push(['eq', c, v]); return this; }
    is(c: string, v: unknown) { this.f.push(['is', c, v]); return this; }
    not(c: string, _op: string, v: unknown) { this.f.push(['not', c, v]); return this; }
    in(c: string, v: unknown) { this.f.push(['in', c, v]); return this; }
    gt() { return this; } lte() { return this; } order() { return this; } limit() { return this; }
    update(p: unknown) { this.op = 'update'; this.payload = p; return this; }
    upsert(p: unknown) { this.op = 'upsert'; this.payload = p; return this; }
    delete() { this.op = 'delete'; return this; }
    run(): unknown {
      const v = (c: string) => this.f.find((x) => x[1] === c)?.[2];
      if (this.t === 'support_settings') { const k = String(v('key')); return { data: k in o.settings ? [{ value: o.settings[k] }] : [] }; }
      if (this.t === 'webinar_sessions') {
        if (this.op === 'update') { log.closes.push(String((this.payload as { invite_note: string }).invite_note)); return { data: [] }; } // [] : pas de bilan envoyé
        log.sessionQueried = true; return { data: [{ id: SID, starts_at: START, zoom_url: null }] };
      }
      if (this.t === 'webinar_registrations') return { count: 0 };
      // webinar_invites
      if (this.op === 'upsert') {
        const rows = this.payload as Array<{ session_id: string; tg_id: number }>;
        for (const r of rows) o.invites.push({ ...r, error: null, blocked_at: null });
        return { data: rows.map((r) => ({ tg_id: r.tg_id })) };
      }
      if (this.op === 'update') { const r = o.invites.find((i) => i.tg_id === v('tg_id')); if (r) r.error = (this.payload as { error: string }).error; return {}; }
      if (this.op === 'delete') { const ids = v('in') as number[]; o.invites = o.invites.filter((i) => !ids.includes(i.tg_id)); return {}; }
      let rows = o.invites.filter((i) => i.session_id === SID);
      if (this.f.some((x) => x[0] === 'is' && x[1] === 'error')) rows = rows.filter((i) => i.error === null);
      if (this.f.some((x) => x[0] === 'not' && x[1] === 'blocked_at')) rows = rows.filter((i) => i.blocked_at !== null);
      return { count: rows.length };
    }
    then(res: (x: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(this.run()).then(res, rej); }
  }
  const db = {
    from: (t: string) => new Q(t),
    rpc: async (_n: string, a: { p_limit: number }) => { log.rpcLimits.push(a.p_limit); return { data: take(a.p_limit), error: null }; },
  };
  return { db, log, state: o };
}

let sends = 0;
let failEvery = 0;
globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
  sends++;
  const body = JSON.parse(String(init?.body ?? '{}')) as { chat_id?: number };
  if (failEvery && Number(body.chat_id) % failEvery === 0) return new Response(JSON.stringify({ description: 'Forbidden: bot was blocked by the user' }), { status: 403 });
  return new Response('{"ok":true}', { status: 200 });
}) as typeof fetch;
process.env.TELEGRAM_BOT_TOKEN = 'test-token-not-real';
for (const k of ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_KEY']) delete process.env[k];

const past = (n: number, err: number): Row[] => Array.from({ length: n }, (_, i) => ({ session_id: SID, tg_id: i + 1, error: i < err ? 'Forbidden: bot was blocked by the user' : null, blocked_at: null }));

async function main() {
  // 1. la session du 28/10 : 500 essais, 402 reçues ; plafond 1402 → 1000 de plus, échecs non comptés
  {
    sends = 0; failEvery = 5; // 1 sur 5 injoignable
    const f = fakeDb({ settings: { webinar_invites: 'on', webinar_invite_cap: '1402' }, invites: past(500, 98), pool: 5000 });
    const r = await runWebinarInvites(f.db, Date.now() + 600_000);
    const sent = f.state.invites.filter((i) => i.error === null).length;
    check('2e vague : 1 402 invitations reçues au total', sent === 1402, `reçues ${sent}`);
    check('2e vague : 1 000 envoyées avec succès ce passage', r.invited === 1000, JSON.stringify(r));
    check('2e vague : les échecs ne mangent pas le plafond', r.failed > 0 && f.state.invites.length === 1402 + 98 + r.failed);
    check('2e vague : lots de 100 au plus', f.log.rpcLimits.every((l) => l > 0 && l <= 100));
    check('2e vague : fermée sur « plafond »', f.log.closes.join() === 'plafond', f.log.closes.join());
  }
  // 2. sans réglage : 500 reçues par défaut (comportement d'avant pour une session neuve sans échec)
  {
    sends = 0; failEvery = 0;
    const f = fakeDb({ settings: { webinar_invites: 'on' }, invites: [], pool: 5000 });
    const r = await runWebinarInvites(f.db, Date.now() + 600_000);
    check('défaut : 500 reçues', r.invited === 500 && f.log.closes.join() === 'plafond', JSON.stringify(r));
  }
  // 3. tout le monde a échoué : pas de boucle, fermeture « tout le monde » quand le lot revient vide
  {
    sends = 0; failEvery = 1;
    const f = fakeDb({ settings: { webinar_invites: 'on', webinar_invite_cap: '1402' }, invites: [], pool: 250 });
    const r = await runWebinarInvites(f.db, Date.now() + 600_000);
    check('que des échecs : s’arrête quand plus personne', r.invited === 0 && r.failed === 250 && f.log.closes.join() === 'tout le monde', JSON.stringify(r) + f.log.closes.join());
  }
  // 4. la retenue : avant 13h, rien n'est lu, envoyé ni fermé
  {
    sends = 0; failEvery = 0;
    const later = new Date(Date.now() + 3_600_000).toISOString();
    const f = fakeDb({ settings: { webinar_invites: 'on', webinar_invite_cap: '1402', webinar_invite_not_before: later.toLowerCase() }, invites: past(500, 98), pool: 5000 });
    const r = await runWebinarInvites(f.db, Date.now() + 600_000);
    check('retenue : 0 envoi, rien de fermé, session pas lue', r.invited === 0 && r.failed === 0 && sends === 0 && !f.log.closes.length && !f.log.sessionQueried);
  }
  // 5. la retenue passée : ça part
  {
    sends = 0; failEvery = 0;
    const f = fakeDb({ settings: { webinar_invites: 'on', webinar_invite_cap: '600', webinar_invite_not_before: '2020-01-01t00:00:00z' }, invites: past(500, 98), pool: 5000 });
    const r = await runWebinarInvites(f.db, Date.now() + 600_000);
    check('retenue passée : 600 − 402 = 198 envoyées', r.invited === 198, JSON.stringify(r));
  }
  // 6. retenue illisible : ignorée
  {
    sends = 0; failEvery = 0;
    const f = fakeDb({ settings: { webinar_invites: 'on', webinar_invite_not_before: 'demain' }, invites: [], pool: 50 });
    const r = await runWebinarInvites(f.db, Date.now() + 600_000);
    check('retenue illisible : ignorée', r.invited === 50 && f.log.closes.join() === 'tout le monde', JSON.stringify(r));
  }
  // 7. interrupteur coupé : rien
  {
    sends = 0;
    const f = fakeDb({ settings: { webinar_invites: 'off', webinar_invite_cap: '1402' }, invites: [], pool: 50 });
    const r = await runWebinarInvites(f.db, Date.now() + 600_000);
    check('interrupteur off : rien', r.invited === 0 && sends === 0);
  }
  // 8. le reste est inchangé
  {
    const wb = readFileSync(new URL('../../lib/member/webinar.ts', import.meta.url), 'utf8');
    check('coupe-circuit inchangé', wb.includes('const BREAKER = { minSent: 80, rate: 0.04 };') && wb.includes('if (st.sent >= BREAKER.minSent && st.blocked / st.sent > BREAKER.rate) {'));
    check('lots, cadence, fenêtre inchangés', wb.includes('const INVITE_BATCH = 100;') && wb.includes('await sleep(45);') && wb.includes('const INVITE_FROM = 25 * HOUR;') && wb.includes('const INVITE_UNTIL = 2 * HOUR;'));
    check('le plafond ne compte plus st.total', wb.includes('const room = cap - st.sent;') && !wb.includes('INVITE_CAP - st.total'));
  }
  if (failed) { console.error(`\n${failed} contrôle(s) en échec`); process.exit(1); }
  console.log('\ntous les contrôles passent');
}
main().catch((e) => { console.error(e); process.exit(1); });
