// Contrôle local, pas le runtime, pas la CI. Depuis la racine du dépôt :
//   npx tsx scripts/checks/gold-hours.ts
//
// lib/market/goldHours.ts : fenêtre de fermeture de l'or (ven 17:00 → dim 18:00 NY) + marge de 20 min, heure d'été/hiver US.
import { isGoldClosed, nyClock } from '../../lib/market/goldHours';

let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`ok  ${name}`); return; }
  failed++;
  console.error(`ECHEC  ${name}${detail ? ` — ${detail}` : ''}`);
}
const at = (iso: string, expected: boolean, label: string) => check(`${label} (${iso}) → ${expected ? 'fermé' : 'ouvert'}`, isGoldClosed(new Date(iso)) === expected);

// Heure d'été NY (EDT = UTC−4) : ven 30/10/2026, dim 25/10/2026
at('2026-10-30T20:59:00Z', false, 'ven 16:59 NY (EDT)');
at('2026-10-30T21:01:00Z', true, 'ven 17:01 NY (EDT)');
at('2026-10-31T12:00:00Z', true, 'samedi');
at('2026-10-25T21:59:00Z', true, 'dim 17:59 NY (EDT)');
at('2026-10-25T22:01:00Z', true, 'dim 18:01 NY (EDT), dans la marge');
at('2026-10-25T22:19:00Z', true, 'dim 18:19 NY (EDT), dans la marge');
at('2026-10-25T22:21:00Z', false, 'dim 18:21 NY (EDT), marge passée');
check('marge 0 : dim 18:01 NY ouvert', isGoldClosed(new Date('2026-10-25T22:01:00Z'), 0) === false);

// Passage à l'heure d'hiver US le dim 01/11/2026 (02:00 EDT → 01:00 EST) : réouverture à 18:00 EST = 23:00Z
at('2026-11-01T07:41:00Z', true, 'dim 01/11 matin (jour du changement)');
at('2026-11-01T22:30:00Z', true, 'dim 01/11 17:30 NY (EST) — à l’heure EDT ce serait déjà rouvert');
at('2026-11-01T22:59:00Z', true, 'dim 01/11 17:59 NY (EST)');
at('2026-11-01T23:19:00Z', true, 'dim 01/11 18:19 NY (EST), dans la marge');
at('2026-11-01T23:21:00Z', false, 'dim 01/11 18:21 NY (EST), marge passée');
check('horloge NY 01/11 23:00Z = dim 18:00', JSON.stringify(nyClock(new Date('2026-11-01T23:00:00Z'))) === JSON.stringify({ day: 0, min: 1080 }));

// Heure d'hiver NY (EST = UTC−5) : ven 06/11/2026
at('2026-11-06T21:59:00Z', false, 'ven 16:59 NY (EST)');
at('2026-11-06T22:01:00Z', true, 'ven 17:01 NY (EST)');
// Retour à l'heure d'été US le dim 08/03/2026 : réouverture 18:00 EDT = 22:00Z
at('2026-03-08T21:59:00Z', true, 'dim 08/03 17:59 NY (EDT)');
at('2026-03-08T22:21:00Z', false, 'dim 08/03 18:21 NY (EDT), marge passée');
// Semaine
at('2026-11-04T15:00:00Z', false, 'mercredi');
at('2026-11-02T05:00:00Z', false, 'lundi 00:00 NY');

if (failed) { console.error(`\n${failed} échec(s)`); process.exit(1); }
console.log('\ntout est ok');
