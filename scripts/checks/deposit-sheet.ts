// Contrôle local, pas le runtime, pas la CI. Depuis la racine du dépôt :
//   npx tsx scripts/checks/deposit-sheet.ts
//
// lib/admin/depositSheet.ts : une ligne par compte broker, ressaisies fusionnées, reports, format du Sheet compta.
import { buildDepositSheet, sheetCsv, sheetTsv, SHEET_HEADER, type SheetConnect, type SheetDeposit } from '../../lib/admin/depositSheet';

let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`ok  ${name}`); return; }
  failed++;
  console.error(`ECHEC  ${name}${detail ? ` — ${detail}` : ''}`);
}
let n = 0;
const dep = (tg: number, at: string, broker: string, amount: number, extra: Record<string, unknown> = {}): SheetDeposit => ({ id: String(++n), tg_id: tg, created_at: at, detail: { broker, amount_usd: amount, deposited_at: at, nature: 'broker', ...extra } });
const con = (tg: number, at: string, broker: string, login: string): SheetConnect => ({ tg_id: tg, created_at: at, detail: { broker, login } });

const deposits = [
  dep(1, '2026-10-13T14:20:00Z', 'raisefx', 500),
  dep(1, '2026-10-16T20:29:00Z', 'raisefx', 500, { redeposit: true, commission_usd: 0 }), // ressaisie, même compte
  dep(2, '2026-10-01T17:19:00Z', 'raisefx', 300),
  dep(2, '2026-10-12T22:28:00Z', 'raisefx', 300, { redeposit: true }), // nouveau compte
  dep(3, '2026-09-29T12:35:00Z', 'raisefx', 250),
  dep(3, '2026-10-14T15:38:00Z', 'raisefx', 250, { redeposit: true }), // ressaisie d'un compte de septembre
  dep(4, '2026-08-17T10:13:00Z', 'raisefx', 203, { booked_ym: '2026-10' }), // reporté
  dep(4, '2026-08-22T11:52:00Z', 'puprime', 200, { booked_ym: '2026-10' }), // autre broker
  dep(5, '2026-10-17T22:16:00Z', 'vtmarkets', 200), // 02:16 le 18 à Dubaï
  { id: 'x', tg_id: 6, created_at: '2026-10-05T10:00:00Z', detail: { nature: 'direct', commission_usd: 200, deposited_at: '2026-10-05T10:00:00Z' } },
  dep(7, '2026-10-20T10:00:00Z', 'xlence', 200),
  dep(7, '2026-10-21T10:00:00Z', 'xlence', 400), // pas de compte connu + montant différent → 2 lignes
  dep(8, '2026-11-02T10:00:00Z', 'raisefx', 999), // novembre
];
const connects = [
  con(1, '2026-10-13T13:13:00Z', 'raisefx', '1254752'), con(1, '2026-10-16T19:13:00Z', 'raisefx', '1254752'),
  con(2, '2026-10-01T17:11:00Z', 'raisefx', '1253410'), con(2, '2026-10-12T22:28:00Z', 'raisefx', '1254730'),
  con(3, '2026-09-29T12:11:00Z', 'raisefx', '1251475'), con(3, '2026-10-14T14:41:00Z', 'raisefx', '1251475'),
  con(4, '2026-08-17T10:00:00Z', 'raisefx', '1246974'), con(4, '2026-08-22T11:00:00Z', 'puprime', '34712433'),
  con(5, '2026-10-17T22:00:00Z', 'vtmarkets', '36000001'),
];
const rows = buildDepositSheet({ deposits, connects, ym: '2026-10', nameOf: (t) => `Membre ${t}`, countryOf: () => 'UK' });
const by = (tg: number) => rows.filter((r) => r.name === `Membre ${tg}`);

check('ressaisie même compte → 1 ligne', by(1).length === 1, JSON.stringify(by(1)));
check('ressaisie notée', by(1)[0]?.note === 'Ressaisi le 17/10 (même compte, fusionné)', by(1)[0]?.note);
check('montant = 1er dépôt (pas additionné)', by(1)[0]?.deposit === '500$');
check('nouveau compte même broker → 2 lignes', by(2).length === 2 && by(2)[1].account === '1254730' && by(2)[1].note.startsWith('Nouveau compte'), JSON.stringify(by(2)));
check('ressaisie d\'un compte de septembre → absente d\'octobre', by(3).length === 0);
check('reporté d\'août → présent, noté', by(4).length === 2 && by(4).every((r) => r.note === 'Reporté de août'), JSON.stringify(by(4)));
check('date en heure de Dubaï', by(5)[0]?.date === '18/10/2026', by(5)[0]?.date);
check('accès direct exclu', by(6).length === 0);
check('sans compte, montants différents → 2 lignes', by(7).length === 2 && by(7).every((r) => r.account === ''));
check('autre mois exclu', by(8).length === 0);
check('trié par date', rows.every((r, i) => i === 0 || rows[i - 1].sortKey <= r.sortKey));
check('commission et CPA vides', rows.every((r) => r.commission === '' && r.cpa === false));
check('broker lisible', by(4).some((r) => r.broker === 'PU Prime') && by(1)[0]?.broker === 'RaiseFX');
check('en-tête du Sheet compta', JSON.stringify(SHEET_HEADER) === JSON.stringify(['Name', 'ID Account', 'Broker', 'Date', 'Dépôt', 'Pays', 'Commission', 'Note', 'CPA']));
check('CSV : BOM + en-tête', sheetCsv(rows).startsWith('\ufeff"Name","ID Account"'));
check('TSV : 9 colonnes par ligne', sheetTsv(rows).split('\n').every((l) => l.split('\t').length === 9));
check('nombre total de lignes', rows.length === 8, String(rows.length));

if (failed) { console.error(`\n${failed} échec(s)`); process.exit(1); }
console.log('\ntout est ok');
