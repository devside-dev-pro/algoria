// Contrôle local :
//   npx tsx scripts/checks/deposit-sheet-sync.ts
import { buildDepositSheet, type SheetConnect, type SheetDeposit } from '../../lib/admin/depositSheet';
import { tabTitleForYm, isProtectedHistoricalTab, dubaiYm } from '../../lib/admin/depositSheetSync';

let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`ok  ${name}`); return; }
  failed++;
  console.error(`ECHEC  ${name}${detail ? ` — ${detail}` : ''}`);
}

check('tab nov', tabTitleForYm('2026-11') === 'Dépôts Novembre 2026');
check('tab aout', tabTitleForYm('2026-08') === 'Dépôts Août 2026');
check('protect hind', isProtectedHistoricalTab('Dépôts Octobre Hind 2026'));
check('protect mathieu oct', isProtectedHistoricalTab('Dépôts Octobre Mathieu'));
check('aout title NOT name-protected (policy via current-month-only)', !isProtectedHistoricalTab('Dépôts Août 2026'));
check('dubaiYm shape', /^\d{4}-\d{2}$/.test(dubaiYm()));

const deposits: SheetDeposit[] = [
  { id: '1', tg_id: 1, created_at: '2026-11-01T10:00:00Z', detail: { broker: 'raisefx', amount_usd: 200, deposited_at: '2026-11-01T10:00:00Z', nature: 'broker', commission_status: 'canceled' } },
];
const connects: SheetConnect[] = [{ tg_id: 1, created_at: '2026-11-01T09:00:00Z', detail: { broker: 'raisefx', login: '999' } }];
const rows = buildDepositSheet({ deposits, connects, ym: '2026-11', nameOf: () => 'X', countryOf: () => 'UK' });
check('canceled kept', rows.length === 1 && rows[0].note.startsWith('ANNULÉ'), JSON.stringify(rows));

if (failed) { console.error(`\n${failed} échec(s)`); process.exit(1); }
console.log('\ntout est ok');
