// Contrôle local, pas le runtime, pas la CI. Depuis la racine du dépôt :
//   npx tsx scripts/checks/member-feed.ts
//
// Le flux des membres (app/api/member/feed/route.ts) : une ligne « close-only » (sans heure d'ouverture) est jugée sur
// son heure de clôture par rapport au début de la copie ; l'heure d'un trade porte sa date s'il n'est pas du jour.
// Aucune base, aucun réseau.
import { readFileSync } from 'node:fs';
import { tradeTimeLabel } from '../../lib/display/tradingDay';
import { inCopyWindow } from '../../lib/member/copyWindow';

let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`ok  ${name}`); return; }
  failed++;
  console.error(`ECHEC  ${name}${detail ? ` — ${detail}` : ''}`);
}

// la membre #2813 : copie depuis le 28/10/2026 20:03:45 UTC
const START = Date.parse('2026-10-28T20:03:45.334Z');

// 1. le filtre du début de copie
check('close-only AVANT la copie (22/10 02:12 Paris) : exclue', !inCopyWindow({ opened_at: null, closed_at: '2026-10-22T00:12:56.571Z' }, START));
check('close-only APRÈS la copie : incluse', inCopyWindow({ opened_at: null, closed_at: '2026-10-28T21:30:00Z' }, START));
check('close-only sans champ opened_at du tout : jugée sur la clôture', !inCopyWindow({ closed_at: '2026-10-22T00:12:56Z' }, START) && inCopyWindow({ closed_at: '2026-10-29T08:00:00Z' }, START));
check('ligne normale ouverte après : incluse (inchangé)', inCopyWindow({ opened_at: '2026-10-28T21:00:00Z', closed_at: '2026-10-28T21:20:00Z' }, START));
check('ligne normale ouverte avant, fermée après : exclue (inchangé, #510)', !inCopyWindow({ opened_at: '2026-10-28T18:00:01Z', closed_at: '2026-10-28T20:30:00Z' }, START));
check('ligne normale ouverte avant, fermée avant : exclue (inchangé)', !inCopyWindow({ opened_at: '2026-10-28T15:50:00Z', closed_at: '2026-10-28T16:02:44Z' }, START));
check('ouverte pile au début : incluse', inCopyWindow({ opened_at: '2026-10-28T20:03:45.334Z', closed_at: null }, START));
check('aucune date : exclue', !inCopyWindow({ opened_at: null, closed_at: null }, START));

// 2. le format de l'heure (Paris : UTC+1 l'hiver depuis le 25/10/2026, UTC+2 l'été)
const NOW = Date.parse('2026-10-28T22:38:00Z'); // la capture : 23:38 à Paris le 28/10
check('trade du jour : l’heure seule', tradeTimeLabel('2026-10-28T18:00:02Z', NOW) === '19:00', tradeTimeLabel('2026-10-28T18:00:02Z', NOW));
check('trade d’un autre jour : « 22/10 02:12 » (heure d’été, UTC+2)', tradeTimeLabel('2026-10-22T00:12:56.571Z', NOW) === '22/10 02:12', tradeTimeLabel('2026-10-22T00:12:56.571Z', NOW));
check('la veille : date affichée', tradeTimeLabel('2026-10-27T17:59:16Z', NOW) === '27/10 18:59', tradeTimeLabel('2026-10-27T17:59:16Z', NOW));
check('journée de Paris, pas UTC : 23:30 UTC le 28/10 = 29/10 00:30 Paris → date le 28 au soir', tradeTimeLabel('2026-10-28T23:30:00Z', NOW) === '29/10 00:30', tradeTimeLabel('2026-10-28T23:30:00Z', NOW));
check('minuit à Paris : « 00:05 » et pas « 24:05 »', tradeTimeLabel('2026-10-28T23:05:00Z', Date.parse('2026-10-28T23:10:00Z')) === '00:05', tradeTimeLabel('2026-10-28T23:05:00Z', Date.parse('2026-10-28T23:10:00Z')));

// 3. le câblage (lecture du code)
const route = readFileSync('app/api/member/feed/route.ts', 'utf8');
check('route : le filtre passe par inCopyWindow', /inCopyWindow\(t, copyStart\)/.test(route));
check('route : plus de passe-droit « !t.opened_at »', !/!t\.opened_at \|\|/.test(route));
check('route : admins, prospects et membres sans début de copie gardent tout l’historique', /!Number\.isFinite\(copyStart\) \|\| isAdmin\(s\.username\) \|\| !\['live', 'paused'\]\.includes\(feedStatus\) \|\| inCopyWindow/.test(route));
check('accueil : l’heure passe par tradeTimeLabel', /tradeTimeLabel\(t\.closed_at\)/.test(readFileSync('app/member/page.tsx', 'utf8')));

console.log(failed ? `\n${failed} échec(s)` : '\ntous les contrôles passent');
process.exit(failed ? 1 : 0);
