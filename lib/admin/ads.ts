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
  meta_flag: string | null; created_at: string; updated_at: string;
}
export interface AdHook {
  id: string; text: string; angle: string | null; status: HookStatus; script_id: string | null; notes: string | null; created_at: string;
}

export const SCRIPT_COLS = 'id,pole,title,hook,body,prep,needs,duration,status,source,notes,meta_flag,created_at,updated_at';
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
