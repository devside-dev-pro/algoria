// Contrôle local, pas le runtime, pas la CI. Depuis la racine du dépôt :
//   npx tsx scripts/checks/ads-brief.ts
//
// Le Brief Designer (lib/admin/adsBrief.ts) : styles autorisés, format exact du brief, blocs automatiques, mots interdits.
import method from '../../lib/admin/adsMethod.json';
import { CTA, RISK_LINE, STYLES, bannedIn, buildBrief, styleWarning, type BriefInput } from '../../lib/admin/adsBrief';

let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`ok  ${name}`); return; }
  failed++;
  console.error(`ECHEC  ${name}${detail ? ` — ${detail}` : ''}`);
}

const base: BriefInput = { style: 'pixar3d', theme: 'The Lighthouse', hook_angle: 'relatable panic', duration_s: 30, formats: ['9:16'], voice: 'Alex', must_show: ['community', 'app', 'academy', 'AI guide'], notes: 'Lone sailor in a yellow raincoat.' };

// 1. les styles
const ids = STYLES.map((s) => s.id);
check('kinetic_text exclu', !ids.includes('kinetic_text'));
check('les « to validate » exclus', !ids.includes('meme_static') && !ids.includes('carousel'));
check('validés + aimés présents', ['pixar3d', 'documentary', 'pixel8bit', 'claymation', 'vhs80s', 'tiltshift'].every((i) => ids.includes(i)), ids.join());
check('avertissement conformité sur vhs80s seulement', !!styleWarning(STYLES.find((s) => s.id === 'vhs80s')) && !styleWarning(STYLES.find((s) => s.id === 'pixar3d')));
check('style rejeté refusé par le builder', !buildBrief({ ...base, style: 'kinetic_text' }).ok);

// 2. le format exact
const r = buildBrief(base);
check('brief valide', r.ok, r.ok ? '' : r.errors.join('; '));
if (r.ok) {
  const keys = Object.keys(method.brief_input_format);
  check('JSON = exactement les clés de brief_input_format, dans l’ordre', JSON.stringify(Object.keys(r.json)) === JSON.stringify(keys), Object.keys(r.json).join());
  check('le texte commence par ce JSON', r.text.startsWith(JSON.stringify(r.json, null, 2)));
  check('blocs auto : trame (5 temps)', ['Hook', 'Problem', 'Turn / guide', 'Value / community', 'CTA end card'].every((b) => r.text.includes(`- ${b} (`)));
  check('blocs auto : mots-clés, interdits, prompt négatif, palette', ['STYLE KEYWORDS: Pixar-style 3D animation', 'AVOID:', 'NEGATIVE PROMPT: text, letters', 'PALETTE: bg #08101f'].every((x) => r.text.includes(x)));
  check('CTA et ligne de risque toujours présents', r.text.includes(CTA) && r.text.includes(RISK_LINE) && RISK_LINE.startsWith('Education & community only.'));
  check('l’idée du thème connu est reprise', r.text.includes('lighthouse beam traces a path'));
}

// 3. les mots interdits (champs libres)
const bad = ['an algorithm for MetaTrader 5', 'copy our signals', 'earn $500 per week', '+12% a month', 'passive income', 'guaranteed results', 'open a broker account', 'act now, last chance', 'show the win card'];
for (const b of bad) check(`refusé : « ${b} »`, bannedIn(b).length > 0 && !buildBrief({ ...base, notes: b }).ok);
check('refusé aussi dans un thème libre', !buildBrief({ ...base, theme: 'The trading algorithm' }).ok);
check('texte propre accepté', bannedIn('A calm guide bot helps a lost climber reach a friendly camp.').length === 0);

// 4. les autres garde-fous
check('durée hors 20-50 s refusée', !buildBrief({ ...base, duration_s: 90 }).ok && !buildBrief({ ...base, duration_s: 10 }).ok);
check('sans format refusé', !buildBrief({ ...base, formats: [] }).ok);
check('thème vide refusé', !buildBrief({ ...base, theme: '  ' }).ok);

console.log(failed ? `\n${failed} échec(s)` : '\ntous les contrôles passent');
process.exit(failed ? 1 : 0);
