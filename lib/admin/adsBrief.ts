// ADS STUDIO · 🎬 BRIEF DESIGNER (31/10/2026). Pur code, aucun appel IA, aucune base.
//
// Mathieu : « une option script pour le designer, on sélectionne 3D Pixar, doodle, 8 bit… ce qu'on veut comme trame ».
// La méthode vient de Designer Algoria (lib/admin/adsMethod.json, copie de /workspace/algoria-ads/method/ads-method.json) :
// styles, thèmes, structure narrative, règles de marque et de conformité, positionnement, format du brief.
// Le brief = EXACTEMENT brief_input_format (le JSON que Designer attend), puis des blocs AJOUTÉS AUTOMATIQUEMENT et non
// modifiables : les temps de la trame, les mots-clés et interdits du style, le prompt négatif, la palette, le CTA et
// la ligne de risque. Les champs libres (thème libre, notes) sont refusés s'ils contiennent un mot interdit.
// La production (Grok Imagine, ElevenLabs, montage) reste chez Designer : l'app ne produit que le brief.
import method from './adsMethod.json';

export type Style = { id: string; name: string; status: string; keywords: string[]; avoid: string[] };
export const METHOD_VERSION: string = method.version;
export const ALL_STYLES = method.styles as Style[];
/** Seuls les styles validés ou aimés ; « kinetic text » (rejeté par Mathieu) et les « à valider » sont exclus. */
export const STYLES: Style[] = ALL_STYLES.filter((s) => /^(validated|liked)/i.test(s.status) && !/reject/i.test(s.status) && s.id !== 'kinetic_text');
/** Avertissement conformité à afficher (vhs80s : « compliance to check »). */
export const styleWarning = (s: Style | undefined): string | null => (s && /compliance/i.test(s.status) ? `⚠ ${s.name} : conformité à vérifier (parodie de promesse de richesse — uniquement moquée, jamais réelle).` : null);

export const THEMES = method.themes as Array<{ name: string; example: string }>;
export const HOOK_ANGLES = ['question', 'relatable panic', 'contrarian', 'reveal'] as const;
export type HookAngle = (typeof HOOK_ANGLES)[number];
export const FORMATS = ['9:16', '1:1', '4:5', '16:9'] as const;
export const VOICES = method.voices as string[];
export const MUST_SHOW = method.brief_input_format.must_show as string[];
export const DURATION_MIN = 20, DURATION_MAX = 50;
export const BEATS = method.narrative_structure.beats as Array<{ beat: string; time: string; rule: string }>;
export const CTA: string = method.positioning.cta;
export const RISK_LINE: string = method.brand_and_compliance.risk_line.replace(/\s*\(.*\)\s*$/, '');
export const RISK_PLACEMENT = 'small (~25 px), on the end card, on screen ≥ 4 s; on every carousel slide';
export const NEGATIVE: string = method.negative;
export const PALETTE = method.brand_and_compliance.palette as Record<string, string | string[]>;

// Mots interdits dans les champs libres : le positionnement (never_say) et la conformité (never), en motifs.
export const BANNED: Array<{ re: RegExp; why: string }> = [
  { re: /\balgorithm/i, why: '« algorithm » (positionnement : plus jamais « an algorithm for MetaTrader 5 »)' },
  { re: /\bmeta\s?trader|\bmt[45]\b/i, why: 'MetaTrader / MT5' },
  { re: /\bbrokers?\b/i, why: 'broker' },
  { re: /\bcfds?\b/i, why: 'CFD' },
  { re: /\bleverage/i, why: 'leverage' },
  { re: /\bsignals?\b/i, why: 'signals' },
  { re: /\bprofits?\b|\breturns?\b|\bpassive income\b/i, why: 'profits / returns / passive income' },
  { re: /\bguarantee(d|s)?\b|\beasy money\b|\bget rich\b/i, why: 'guaranteed / easy money / get rich' },
  { re: /[$€£]\s?\d|\d\s?[$€£]|\d+(\.\d+)?\s?%|\bper (day|week|month)\b/i, why: 'montant, pourcentage ou gain (aucune promesse de gain)' },
  { re: /\b(act now|hurry|last chance|limited time|only today)\b/i, why: "urgence (« act now », « last chance »…)" },
  { re: /\btestimonials?\b|\bfake client/i, why: 'témoignages / faux clients' },
  { re: /\bp&l\b|\bpnl\b|\bwin ?card\b|og\.png|wincard/i, why: 'courbes P&L, win card, og.png (visuels interdits)' },
];
export function bannedIn(text: string): string[] {
  const t = String(text ?? '');
  return BANNED.filter((b) => b.re.test(t)).map((b) => b.why);
}

export type BriefInput = {
  style: string; theme: string; hook_angle: HookAngle; duration_s: number; formats: string[]; voice: string;
  must_show: string[]; notes: string;
};
export type BriefResult = { ok: true; json: Record<string, unknown>; text: string } | { ok: false; errors: string[] };

/** Construit le brief. Refuse (ok: false) s'il manque un choix ou si un champ libre contient un mot interdit. */
export function buildBrief(i: BriefInput): BriefResult {
  const errors: string[] = [];
  const style = STYLES.find((s) => s.id === i.style);
  if (!style) errors.push(`style non autorisé : ${i.style || '(vide)'}`);
  const theme = String(i.theme ?? '').trim();
  if (!theme) errors.push('thème manquant');
  if (!HOOK_ANGLES.includes(i.hook_angle)) errors.push('angle du hook invalide');
  const dur = Math.round(Number(i.duration_s));
  if (!Number.isFinite(dur) || dur < DURATION_MIN || dur > DURATION_MAX) errors.push(`durée entre ${DURATION_MIN} et ${DURATION_MAX} s`);
  const formats = (i.formats ?? []).filter((f) => (FORMATS as readonly string[]).includes(f));
  if (!formats.length) errors.push('au moins un format');
  if (!VOICES.includes(i.voice) && !/^other\b/i.test(i.voice)) errors.push('voix invalide');
  const must = (i.must_show ?? []).filter((m) => MUST_SHOW.includes(m));
  const notes = String(i.notes ?? '').trim();
  for (const [label, v] of [['thème', theme], ['notes', notes], ['voix', i.voice]] as const) {
    const hit = bannedIn(v);
    if (hit.length) errors.push(`${label} : mot interdit — ${hit.join(', ')}`);
  }
  if (errors.length || !style) return { ok: false, errors };

  // 1) EXACTEMENT brief_input_format (mêmes clés, même ordre)
  const json = { style: style.id, theme, hook_angle: i.hook_angle, duration_s: dur, formats, voice: i.voice, must_show: must, notes };
  const knownTheme = THEMES.find((t) => t.name === theme);
  // 2) les blocs ajoutés automatiquement (non modifiables)
  const pal = Object.entries(PALETTE).map(([k, v]) => `${k} ${Array.isArray(v) ? v.join(' / ') : v}`).join(' · ');
  const text = [
    JSON.stringify(json, null, 2),
    '',
    `--- AUTO (algoria ads method ${METHOD_VERSION}, do not edit) ---`,
    `STYLE: ${style.name} [${style.status}]`,
    knownTheme ? `THEME IDEA: ${knownTheme.example}` : 'THEME IDEA: free theme (see notes)',
    '',
    `NARRATIVE (${dur} s, ${formats.join(' + ')}; ${method.narrative_structure.shot_length}):`,
    ...BEATS.map((b) => `- ${b.beat} (${b.time}): ${b.rule}`),
    `- Proof: ${method.narrative_structure.proof}`,
    '',
    `STYLE KEYWORDS: ${style.keywords.join(', ')}`,
    `AVOID: ${style.avoid.join('; ')}`,
    `NEGATIVE PROMPT: ${NEGATIVE}`,
    '',
    `PALETTE: ${pal}`,
    `FONTS: ${(method.brand_and_compliance.fonts as string[]).join(', ')} · LOGO: ${method.brand_and_compliance.logo}`,
    `LANGUAGE: ${method.brand_and_compliance.language}`,
    `POSITIONING: ${method.positioning.say}`,
    `NEVER SAY: ${(method.positioning.never_say as string[]).join('; ')}`,
    `NEVER SHOW: ${(method.brand_and_compliance.never as string[]).join('; ')}`,
    '',
    `CTA (VO lands when the logo appears): ${CTA}`,
    `RISK LINE (${RISK_PLACEMENT}): ${RISK_LINE}`,
    '',
    `PROCESS: ${method.brand_and_compliance.process}`,
  ].join('\n');
  return { ok: true, json, text };
}
