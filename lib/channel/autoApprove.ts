// VALIDATION AUTOMATIQUE DU PLAN DU JOUR (26/11/2026, Mathieu : « Oui, valide le plan tout seul tous les jours »).
//
// La cron (pg_cron channel-posts-5min → /api/cron/channel-posts) prépare le plan la veille à 18h Paris.
// Avant, chaque post restait `draft` jusqu'au clic « ✅ Tout valider ». Sans clic, il expirait.
// Maintenant, les brouillons qui passent les garde-fous passent en `approved` (decided_by = 'auto') dans le
// même passage, donc avant la première heure de publication. Un texte refusé reste brouillon : il ne part pas.
//
// Interrupteur, défaut allumé (ligne absente = on) : support_settings 'cm_auto_approve' = 'off',
// ou CHANNEL_CM_AUTO_APPROVE=off. L'un ou l'autre suffit à revenir au clic.
//
// Les bulles (slot bubble1–4, mode prog ou live, video notes) ne sont pas des posts du plan.

import { isBubbleRow } from './bubbles';
import { toneIssue } from './tone';
import { checkPoll, publicTextRefusal } from './writer';
import { vipTemplateOf } from './vipFill';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export const AUTO_APPROVE_SETTING = 'cm_auto_approve';
export const AUTO_APPROVE_ENV = 'CHANNEL_CM_AUTO_APPROVE';
/** Même délai que GRACE_MS dans cm.ts : passé ce délai, le brouillon expire au lieu d'être validé. */
export const AUTO_GRACE_MS = 60 * 60_000;

/** Les posts du plan (cm.ts s'aligne dessus). Jamais `video`, `plan`, ni une bulle. */
export const CM_POST_KINDS = ['backstage', 'gold', 'qa', 'story', 'trade', 'poll', 'lesson', 'cta', 'morning', 'howto', 'tp'];

export type ApproveRow = {
  id: number;
  day: string;
  slot: string;
  kind: string;
  ref?: string | null;
  text: string | null;
  button_text?: string | null;
  status: string;
  scheduled_at: string;
  report?: unknown;
  decided_by?: string | null;
  decided_at?: string | null;
};

const asObj = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {});

/** Défaut on. 'off' dans l'env ou dans support_settings coupe la validation automatique. */
export function autoApproveEnabled(setting: string | null | undefined, envValue?: string): boolean {
  const env = (envValue !== undefined ? envValue : (process.env[AUTO_APPROVE_ENV] ?? '')).trim().toLowerCase();
  if (env === 'off') return false;
  return String(setting ?? 'on').trim().toLowerCase() !== 'off';
}

export async function autoApproveSetting(db: Db): Promise<boolean> {
  const { data, error } = await db.from('support_settings').select('value').eq('key', AUTO_APPROVE_SETTING).limit(1);
  if (error) throw new Error(String(error.message ?? error));
  return autoApproveEnabled((data?.[0] as { value?: string } | undefined)?.value);
}

const hasButton = (row: ApproveRow) => row.kind === 'cta' || !!row.button_text;

const PLACEHOLDER = /(?:\+?\$)?\[(?:X|Y|Z|lot|N|NET)\]/gi;

/** Raison du refus, ou null si le post peut être validé tout seul.
 *  Trade / tp sans texte : le commentaire est écrit à l'heure et passe par writePost / guardTrade.
 *  Modèle VIP : mêmes interdits de fond, liens conservés (ces textes ne passent pas par check, décision déjà en place).
 *  Annonce webinaire de secours (writer bank) : le texte est celui du code, pas une sortie de modèle ; le ton
 *  (gras, emojis) ne s'y applique pas, les interdits de fond oui. */
export function guardRefusal(row: ApproveRow): string | null {
  if (isBubbleRow(row) || row.kind === 'video' || row.kind === 'plan' || row.slot === 'plan' || row.slot === 'video') {
    return 'hors du plan de posts';
  }
  if (!CM_POST_KINDS.includes(row.kind)) return 'pas un post du plan';
  const vip = vipTemplateOf(row.text, row.report);
  if ((row.kind === 'trade' || row.kind === 'tp') && !String(row.text ?? '').trim() && !vip) return null;
  if (row.kind === 'poll') {
    const rep = asObj(row.report);
    const poll = (rep.poll as { question?: string; options?: string[] } | undefined) ?? { question: row.text ?? '', options: [] as string[] };
    const r = checkPoll(poll, { hasButton: false });
    return r.ok ? null : r.why;
  }
  const source = (vip ?? String(row.text ?? '')).trim();
  if (!source) return 'pas de texte';
  const writer = String(asObj(row.report).writer ?? '');
  // Seulement le texte de secours du webinaire (planDay pose writer bank). Un texte « ai » repasse par le ton.
  const codedFallback = writer === 'bank' && String(row.ref ?? '').startsWith('webinar-');
  const screened = vip ? source.replace(PLACEHOLDER, '') : source;
  const why = publicTextRefusal(screened, {
    allowNegative: row.kind === 'lesson' || row.kind === 'howto',
    allowLinks: !!vip,
  });
  if (why) return why;
  const button = hasButton(row);
  if (!button && /👇|\b(?:tap|click|press)\s+(?:the\s+)?(?:button|below|here|link)\b|\bbutton below\b/i.test(screened)) {
    return 'there is no button under this post: never point below (no 👇, no "tap the button")';
  }
  if (vip || codedFallback) return null;
  return toneIssue(source, { hasButton: button });
}

export function canAutoApprove(row: ApproveRow, now: number): boolean {
  if (row.status !== 'draft') return false;
  if (Date.parse(row.scheduled_at) + AUTO_GRACE_MS <= now) return false;
  return guardRefusal(row) == null;
}

/** Après une réécriture qui a déjà passé writePost. Auto : le post repart à l'heure. Manuel : il redevient brouillon. */
export function statusAfterGuardedEdit(auto: boolean): 'approved' | 'draft' {
  return auto ? 'approved' : 'draft';
}

/** Changer la photo ne republie pas un post retiré. En auto, un post déjà validé le reste. */
export function statusAfterPhotoChange(auto: boolean, current: string): 'approved' | 'draft' | 'skipped' {
  if (current === 'skipped') return auto ? 'skipped' : 'draft';
  if (auto && current === 'approved') return 'approved';
  return 'draft';
}

/** Passe en approved les brouillons du plan qui passent les garde-fous et dont l'heure n'est pas dépassée de plus
 *  d'une heure. Appelé par la cron juste après la génération, donc avant la première publication du jour. */
export async function autoApproveDue(db: Db, now = Date.now()): Promise<{ approved: number; held: number; enabled: boolean }> {
  const enabled = await autoApproveSetting(db);
  if (!enabled) return { approved: 0, held: 0, enabled: false };
  const cutoff = new Date(now - AUTO_GRACE_MS).toISOString();
  const { data, error } = await db.from('channel_posts')
    .select('id,day,slot,kind,ref,text,button_text,status,scheduled_at,report')
    .eq('status', 'draft')
    .gt('scheduled_at', cutoff);
  if (error) throw new Error(String(error.message ?? error));
  const decided_at = new Date(now).toISOString();
  let approved = 0;
  let held = 0;
  for (const r of (data ?? []) as ApproveRow[]) {
    if (isBubbleRow(r) || r.kind === 'video' || r.kind === 'plan' || !CM_POST_KINDS.includes(r.kind)) continue;
    if (!canAutoApprove(r, now)) { held++; continue; }
    const { data: wrote, error: werr } = await db.from('channel_posts')
      .update({ status: 'approved', decided_by: 'auto', decided_at })
      .eq('id', r.id)
      .eq('status', 'draft')
      .select('id');
    if (werr) { console.error('[cm] auto-approve:', String(werr.message ?? werr)); held++; continue; }
    if (wrote?.length) approved++;
  }
  return { approved, held, enabled: true };
}
