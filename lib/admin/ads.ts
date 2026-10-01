// ADS STUDIO (01/10/2026) — types et libellés partagés par l'onglet ADS STUDIO et son API.
// Une « fiche » = une ad : pôle, hook, déroulé, besoins, statut. La banque de hooks vit à côté (ad_hooks).

export const POLES = ['street', 'scene', 'acting', 'ugly', 'broll', 'other'] as const;
export type Pole = (typeof POLES)[number];
export const POLE_LABEL: Record<Pole, string> = {
  street: '🎙 Street interviews',
  scene: '🎭 Acted scenes',
  acting: '🤝 Scenes with Mathieu',
  ugly: '📱 Ugly ads',
  broll: '🎞 B-roll + voice-over',
  other: '🧪 Other ideas',
};

export const STATUSES = ['idea', 'to_shoot', 'shot', 'edited', 'live'] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, { label: string; col: string }> = {
  idea: { label: 'IDEA', col: 'var(--muted)' },
  to_shoot: { label: 'TO SHOOT', col: 'var(--gold)' },
  shot: { label: 'SHOT', col: 'var(--cyan)' },
  edited: { label: 'EDITED', col: '#a78bfa' },
  live: { label: 'LIVE', col: 'var(--up)' },
};

export const NEEDS = ['solo', 'actors', 'videographer', 'street', 'event', 'creators'] as const;
export type Need = (typeof NEEDS)[number];
export const NEED_LABEL: Record<Need, string> = {
  solo: '📱 Mathieu alone',
  actors: '🎭 2 actors',
  videographer: '🎥 videographer',
  street: '🚶 street',
  event: '🎤 event',
  creators: '🌍 UGC creators',
};

export const HOOK_STATUSES = ['untested', 'testing', 'winner', 'loser'] as const;
export type HookStatus = (typeof HOOK_STATUSES)[number];
export const HOOK_STATUS_LABEL: Record<HookStatus, { label: string; col: string }> = {
  untested: { label: 'UNTESTED', col: 'var(--muted)' },
  testing: { label: 'TESTING', col: 'var(--gold)' },
  winner: { label: 'WINNER', col: 'var(--up)' },
  loser: { label: 'LOSER', col: 'var(--down)' },
};
export const ANGLES = ['proof', 'time', 'beginner', 'skeptic', 'money', 'curiosity', 'pov', 'question'] as const;

export interface AdScript {
  id: string; pole: Pole; title: string; hook: string | null; body: string | null; prep: string | null;
  needs: Need[]; duration: string | null; status: Status; source: string | null; notes: string | null;
  meta_flag: string | null; shot_at: string | null; created_at: string; updated_at: string;
}
export interface AdHook {
  id: string; text: string; angle: string | null; status: HookStatus; script_id: string | null; notes: string | null; created_at: string;
}

export const SCRIPT_COLS = 'id,pole,title,hook,body,prep,needs,duration,status,source,notes,meta_flag,shot_at,created_at,updated_at';
export const HOOK_COLS = 'id,text,angle,status,script_id,notes,created_at';

/** Le texte d'une fiche, prêt à coller (WhatsApp à Benjamin, notes du tournage…). */
export function scriptText(s: Pick<AdScript, 'pole' | 'title' | 'hook' | 'body' | 'prep' | 'duration' | 'notes'>, altHooks: string[] = []): string {
  const parts = [`${POLE_LABEL[s.pole]} · ${s.title}${s.duration ? ` (${s.duration})` : ''}`];
  if (s.prep) parts.push(`TO PREPARE\n${s.prep}`);
  if (s.hook) parts.push(`HOOK\n${s.hook}`);
  if (s.body) parts.push(s.body);
  if (altHooks.length) parts.push(`ALTERNATIVE HOOKS\n${altHooks.map((h) => `- ${h}`).join('\n')}`);
  if (s.notes) parts.push(`NOTES\n${s.notes}`);
  return parts.join('\n\n');
}

// ===== PRÊTE À TOURNER ? (01/10/2026) =====
// « Savoir quelles ads tourner, lesquelles ont des prérequis, lesquelles peuvent être tournées de suite » (Mathieu).
// Une ad est rangée selon son besoin le plus lourd : seul avec le téléphone = tout de suite ; sinon il faut
// réunir quelqu'un (vidéaste, acteurs, passants, un événement).
export const READINESS = [
  { key: 'now', label: '🟢 READY NOW · just you and your phone', col: 'var(--up)' },
  { key: 'videographer', label: '🎥 WITH THE VIDEOGRAPHER', col: 'var(--cyan)' },
  { key: 'actors', label: '🎭 WITH THE 2 ACTORS', col: '#a78bfa' },
  { key: 'street', label: '🚶 STREET · English-speaking passers-by', col: 'var(--gold)' },
  { key: 'event', label: '🎤 EVENT OR UGC CREATORS', col: '#ff8a5c' },
] as const;
export type Readiness = (typeof READINESS)[number]['key'];
export function readinessOf(needs: Need[]): Readiness {
  if (needs.includes('actors')) return 'actors';
  if (needs.includes('street')) return 'street';
  if (needs.includes('event') || needs.includes('creators')) return 'event';
  if (needs.includes('videographer')) return 'videographer';
  return 'now';
}

// ===== LE BRIEF POUR LE STUDIO (01/10/2026) =====
// Mathieu coche des ads et envoie le tout au studio (souvent par mail). Le studio (Pau) lit le français ;
// les répliques restent en anglais, telles qu'elles seront dites.
const POLE_FR: Record<Pole, string> = {
  street: 'Micro-trottoir', scene: 'Scène jouée', acting: 'Scène avec Mathieu', ugly: 'Ugly ad (Mathieu au téléphone)',
  broll: 'B-roll + voix off', other: 'Autre format',
};
const NEED_FR: Record<Need, string> = {
  solo: 'Mathieu seul', actors: '2 acteurs anglophones', videographer: 'vidéaste', street: 'passants anglophones (rue)',
  event: 'événement', creators: 'créateurs UGC',
};
export function studioBrief(ads: AdScript[], altsOf: (id: string) => string[]): { subject: string; text: string } {
  const n = ads.length;
  const needs = [...new Set(ads.flatMap((a) => a.needs))].map((x) => NEED_FR[x]);
  const preps = [...new Set(ads.flatMap((a) => (a.prep ?? '').split('\n').map((l) => l.trim()).filter(Boolean)))];
  const out: string[] = [
    'Bonjour,',
    '',
    `Voici le brief pour le prochain tournage Algoria : ${n} ad${n > 1 ? 's' : ''}.`,
    '',
    'CE QU\'IL FAUT PRÉVOIR',
    `- Équipe : ${needs.length ? needs.join(', ') : 'Mathieu seul'}`,
  ];
  if (preps.length) out.push('- Préparation et matériel :', ...preps.map((p) => `  · ${p}`));
  out.push(
    '',
    'LES RÈGLES (pour toutes les ads)',
    '- Les ads sont en anglais. Les répliques entre guillemets se disent telles quelles.',
    '- Uniquement de vrais trades, de vraies notifications et de vrais écrans de l\'app. Rien de truqué.',
    '- Jamais de taille de compte à l\'écran : toujours « 0.01 lot ».',
    '- Aucun identifiant ni mot de passe visible à l\'écran.',
    '- Texte de fin à l\'écran : Trading involves risk. Past results don\'t guarantee future results.',
  );
  ads.forEach((a, i) => {
    out.push('', '────────────────────', `AD ${i + 1}/${n} · ${a.title}`,
      `${POLE_FR[a.pole]}${a.duration ? ` · ${a.duration}` : ''}${a.needs.length ? ` · ${a.needs.map((x) => NEED_FR[x]).join(', ')}` : ''}`);
    if (a.prep) out.push('', 'À PRÉPARER', a.prep);
    if (a.hook) out.push('', 'HOOK (les 3 premières secondes)', a.hook);
    if (a.body) out.push('', 'SCRIPT', a.body);
    const alts = altsOf(a.id);
    if (alts.length) out.push('', 'HOOKS DE RECHANGE (à tourner à la suite, même tenue)', ...alts.map((h) => `- ${h}`));
    if (a.meta_flag) out.push('', `⚠ À ÉVITER : ${a.meta_flag}`);
    if (a.notes) out.push('', `NOTES : ${a.notes}`);
  });
  out.push('', '────────────────────', '', 'Merci !', 'Mathieu');
  return { subject: `Algoria · brief tournage · ${n} ad${n > 1 ? 's' : ''}`, text: out.join('\n') };
}
