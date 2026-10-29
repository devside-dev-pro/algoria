// Contrôle local, pas le runtime, pas la CI. Depuis la racine du dépôt :
//   npx tsx scripts/checks/join-switch.ts
//
// L'interrupteur auto-accept depuis le bot (lib/member/joinSwitch.ts) : qui peut, quelles commandes, quelle écriture.
// Aucune base, aucun réseau : une fausse base en mémoire, fetch remplacé.
import { readFileSync } from 'node:fs';
import { canToggleJoins, joinSwitch, joinSwitchIds, joinSwitchMessage, parseJoinSwitch } from '../../lib/member/joinSwitch';

let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`ok  ${name}`); return; }
  failed++;
  console.error(`ECHEC  ${name}${detail ? ` — ${detail}` : ''}`);
}

const OWNER = 999, MARIA = 5948171473, OTHER = 1234;
process.env.OWNER_TG_IDS = String(OWNER);
delete process.env.ADMIN_TG_USERNAMES;
process.env.JOIN_SWITCH_TG_IDS = `${MARIA}`;
process.env.TELEGRAM_VIP_CHAT = '-100777';
globalThis.fetch = (async () => new Response('{"ok":true}')) as typeof fetch;

// fausse base : support_settings + telegram_joins
const settings = new Map<string, Record<string, unknown>>();
const joins = [
  { chat_id: -100111, status: 'waiting', approved_at: null, joined_at: new Date().toISOString() },
  { chat_id: -100111, status: 'waiting', approved_at: null, joined_at: new Date().toISOString() },
  { chat_id: -100777, status: 'waiting', approved_at: null, joined_at: new Date().toISOString() }, // VIP : pas compté
  { chat_id: -100111, status: 'approved', approved_at: new Date().toISOString(), joined_at: new Date().toISOString() },
];
class Q {
  f: Array<(r: Record<string, unknown>) => boolean> = []; head = false;
  constructor(public t: string) {}
  select(_c?: string, o?: { head?: boolean }) { if (o?.head) this.head = true; return this; }
  eq(c: string, v: unknown) { this.f.push((r) => r[c] === v); return this; }
  neq(c: string, v: unknown) { this.f.push((r) => r[c] !== v); return this; }
  is(c: string, v: unknown) { this.f.push((r) => (r[c] ?? null) === v); return this; }
  not(c: string, _o: string, v: unknown) { this.f.push((r) => (r[c] ?? null) !== v); return this; }
  gte() { return this; } limit() { return this; }
  upsert(p: Record<string, unknown>) { settings.set(String(p.key), p); return Promise.resolve({ error: null }); }
  then(res: (x: unknown) => unknown) {
    if (this.t === 'support_settings') return Promise.resolve({ data: [...settings.values()].filter((r) => this.f.every((fn) => fn(r))) }).then(res);
    const rows = joins.filter((r) => this.f.every((fn) => fn(r as Record<string, unknown>)));
    return Promise.resolve(this.head ? { count: rows.length } : { data: rows }).then(res);
  }
}
const db = { from: (t: string) => new Q(t) };

async function main() {
  // 1. qui
  check('JOIN_SWITCH_TG_IDS lu (ids numériques seulement)', joinSwitchIds('5948171473, @Maria_pub 12x -4 7').join() === '5948171473,7');
  check('admin : autorisé', (await canToggleJoins(OWNER)).ok && (await canToggleJoins(OWNER)).admin);
  check('Maria : autorisée, pas admin', (await canToggleJoins(MARIA)).ok && !(await canToggleJoins(MARIA)).admin);
  check('un autre compte : refusé', !(await canToggleJoins(OTHER)).ok);
  check('id invalide : refusé', !(await canToggleJoins(NaN)).ok && !(await canToggleJoins(0)).ok);
  // 2. les commandes
  check('« autoaccept » = état', parseJoinSwitch('autoaccept') === 'get' && parseJoinSwitch('/autoaccept') === 'get' && parseJoinSwitch('AutoAccept status') === 'get');
  check('« autoaccept off / pause / stop »', ['autoaccept off', '/autoaccept pause', 'auto-accept stop', '/autoaccept@algoria_bot off'].every((t) => parseJoinSwitch(t) === 'off'));
  check('« autoaccept on / resume / start »', ['autoaccept on', '/autoaccept resume', 'AUTOACCEPT START'].every((t) => parseJoinSwitch(t) === 'on'));
  check('pas une commande : dans une phrase, ou autre mot', [null, null, null].every((x, i) => parseJoinSwitch(['please autoaccept off', 'autoaccept off now', 'accept'][i]) === x));
  // 3. l'écriture (même clé et mêmes valeurs que le panneau de l'admin)
  const off = await joinSwitch(db, 'off', '@Maria_pub (bot)');
  check('off : public_autojoin = off, signé', settings.get('public_autojoin')?.value === 'off' && settings.get('public_autojoin')?.updated_by === '@Maria_pub (bot)' && !off.on);
  check('off : 2 demandes en attente comptées (le VIP et les acceptées exclus)', off.waiting === 2, String(off.waiting));
  const on = await joinSwitch(db, 'on', '@Maria_pub (bot)');
  check('on : public_autojoin = on', settings.get('public_autojoin')?.value === 'on' && on.on);
  const m = joinSwitchMessage(on);
  check('message : bouton STOP quand c’est ON', JSON.stringify(m.reply_markup).includes('joinsw:off') && JSON.stringify(m.reply_markup).includes('STOP'));
  check('message : bouton RESUME quand c’est OFF', JSON.stringify(joinSwitchMessage(off).reply_markup).includes('joinsw:on'));
  // 4. le câblage (lecture du code) : le droit n'ouvre rien d'autre
  const route = readFileSync('app/api/telegram/route.ts', 'utf8');
  const admin = readFileSync('app/api/member/admin/route.ts', 'utf8');
  check('webhook : commande et boutons passent par canToggleJoins', (route.match(/canToggleJoins\(/g) ?? []).length === 2);
  check('webhook : un compte non autorisé n’est pas arrêté (return false)', /if \(!who\.ok\) return false;/.test(route));
  check('admin web : JOIN_SWITCH_TG_IDS n’y donne aucun accès', !admin.includes('JOIN_SWITCH_TG_IDS') && !admin.includes('joinSwitch'));
  check('lib : pas de @pseudo dans l’autorisation', !/ADMIN_TG_USERNAMES|tg_username/.test(readFileSync('lib/member/joinSwitch.ts', 'utf8')));
  check('jamais de setWebhook', !/setWebhook/.test(readFileSync('lib/member/joinSwitch.ts', 'utf8')));

  console.log(failed ? `\n${failed} échec(s)` : '\ntous les contrôles passent');
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
