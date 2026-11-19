// Contrôle local, pas le runtime, pas la CI. Depuis la racine du dépôt :
//   npx tsx scripts/checks/channel-members.ts
//
// La mesure quotidienne du canal (10/11/2026) : ce qui compte comme une entrée ou un départ, et les canaux mesurés.
import { countDay, memberDelta, trackedChannels } from '../../lib/channel/members';

let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`ok  ${name}`); return; }
  failed++;
  console.error(`ECHEC  ${name}${detail ? ` — ${detail}` : ''}`);
}
check('left → member = entrée', memberDelta('left', 'member') === 1);
check('kicked → member = entrée', memberDelta('kicked', 'member') === 1);
check('member → left = départ', memberDelta('member', 'left') === -1);
check('member → kicked = départ', memberDelta('member', 'kicked') === -1);
check('administrator → left = départ', memberDelta('administrator', 'left') === -1);
check('member → administrator = rien', memberDelta('member', 'administrator') === 0);
check('left → kicked = rien', memberDelta('left', 'kicked') === 0);
check('countDay', JSON.stringify(countDay([
  { old_status: 'left', new_status: 'member' }, { old_status: 'left', new_status: 'member' },
  { old_status: 'member', new_status: 'left' }, { old_status: 'member', new_status: 'administrator' },
])) === JSON.stringify({ joins: 2, leaves: 1 }));
const ch = trackedChannels({ TELEGRAM_CHANNEL_EN: '-1001', TELEGRAM_CHANNEL_MIRROR: '-1002', TELEGRAM_CHANNEL_IT: '-1003' });
check('canaux : source, miroir UK, IT', ch.map((c) => c.label).join(',') === 'source,mirror UK,canale IT', JSON.stringify(ch));
check('canaux : pas de doublon', trackedChannels({ TELEGRAM_CHANNEL_EN: '-1001', TELEGRAM_CHANNEL_MIRROR: '-1001' }).length === 1);
check('canaux : rien de configuré → rien', trackedChannels({}).length === 0);
if (failed) { console.error(`\n${failed} échec(s)`); process.exit(1); }
console.log('\nTout est bon.');
