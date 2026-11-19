// AUTO-APPROBATION DES DEMANDES D'ADHÉSION (31/07 — Mathieu les acceptait par lots de 10-20 à la main).
// Le webhook Vercel ne peut pas « attendre 3 minutes » (fonction serverless) : c'est le runner, allumé en
// permanence, qui balaie la file. Le délai laisse au DM d'onboarding le temps d'être lu.
// ALGORIA_AUTOJOIN_MIN = délai en minutes (défaut 3) · 0 ou négatif = fonction DÉSACTIVÉE.
//
// 19/11/2026 : cette boucle vivait dans main() APRÈS `await connectMaster()`. MetaApi n'a pas joint le
// broker (« Timed out waiting for account … to connect », toutes les 15 min) et connectMaster ne rend
// la main qu'une fois le flux prix là — aucune demande publique n'a donc été approuvée. La boucle est
// armée AVANT cet await. Elle ne déploie rien, ne passe aucun ordre, ne lit pas le prix.
//
// ⚠️ LE CANAL VIP (24/08, puis 01/09, puis 22/10). D'abord exclu : un lien transféré faisait entrer
// n'importe qui. Puis de nouveau automatique, MAIS seulement si le lot d'activation est validé
// (listRipeVipRequests) ET si support_settings 'vip_autojoin' = 'on'. 'off' → les demandes VIP restent
// en file. Le public a son propre interrupteur : 'public_autojoin' = 'off' → rien n'est approuvé
// (échanges de pubs, 26/10). Ligne absente ou lecture nulle → le public continue ('!== off'), le VIP non
// ('=== on'). Les deux files restent séparées : le VIP, filtré, ne doit jamais remplir la limite de 25
// et affamer le public (voir listRipeJoinRequests).
//
// Un seul runner (le primaire, stratégie 2) balaie. startJoinApproval est idempotent : le rappeler
// après la connexion MetaApi n'ouvre pas une deuxième boucle.

export const JOIN_BATCH = 25;

export type JoinRow = { id: number; chat_id: number; user_id: number; username: string | null };

export type JoinApprovalDeps = {
  /** Runner secondaire (stratégie ≠ 2) : ne balaie pas, sinon triple approbation. */
  secondary?: boolean;
  /** Délai minimum en minutes. <= 0 → boucle éteinte. */
  minAgeMin?: number;
  intervalMs?: number;
  /** Id du canal VIP (TELEGRAM_VIP_CHAT). Vide → on ne sait pas l'exclure. */
  vipChatId?: string;
  runnerSwitch?: (key: 'vip_autojoin' | 'public_autojoin') => Promise<'on' | 'off' | null>;
  listPublic?: (minAgeMin: number, limit: number, excludeChatIds: number[]) => Promise<JoinRow[]>;
  listVip?: (minAgeMin: number, vipChatId: number, limit: number) => Promise<JoinRow[]>;
  approve?: (chatId: number, userId: number) => Promise<{ ok: boolean; error: string | null }>;
  mark?: (id: number, error: string | null) => Promise<void>;
  logNote?: (msg: string) => Promise<void>;
};

type Resolved = {
  minAgeMin: number;
  intervalMs: number;
  vipChatId: string;
  runnerSwitch: NonNullable<JoinApprovalDeps['runnerSwitch']>;
  listPublic: NonNullable<JoinApprovalDeps['listPublic']>;
  listVip: NonNullable<JoinApprovalDeps['listVip']>;
  approve: NonNullable<JoinApprovalDeps['approve']>;
  mark: NonNullable<JoinApprovalDeps['mark']>;
  logNote: NonNullable<JoinApprovalDeps['logNote']>;
};

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let inflight: Promise<void> | null = null;
let active: Resolved | null = null;

function defaultSecondary(): boolean {
  // Même règle que SECONDARY dans lib/supabase/sync.ts (stratégie 2 = runner primaire).
  const id = Number(process.env.ALGORIA_STRATEGY ?? '2') || 2;
  return id !== 2;
}

function resolve(overrides: JoinApprovalDeps | undefined): Resolved {
  return {
    minAgeMin: overrides?.minAgeMin ?? Number(process.env.ALGORIA_AUTOJOIN_MIN ?? 3),
    intervalMs: overrides?.intervalMs ?? 60_000,
    vipChatId: overrides?.vipChatId ?? '',
    runnerSwitch: overrides?.runnerSwitch ?? (async (key) => {
      const { runnerSwitch } = await import('../lib/supabase/sync');
      return runnerSwitch(key);
    }),
    listPublic: overrides?.listPublic ?? (async (min, limit, exclude) => {
      const { listRipeJoinRequests } = await import('../lib/supabase/sync');
      return listRipeJoinRequests(min, limit, exclude);
    }),
    listVip: overrides?.listVip ?? (async (min, vip, limit) => {
      const { listRipeVipRequests } = await import('../lib/supabase/sync');
      return listRipeVipRequests(min, vip, limit);
    }),
    approve: overrides?.approve ?? (async (chat, user) => {
      const { approveJoinRequest } = await import('./telegram');
      return approveJoinRequest(chat, user);
    }),
    mark: overrides?.mark ?? (async (id, error) => {
      const { markJoinApproved } = await import('../lib/supabase/sync');
      await markJoinApproved(id, error);
    }),
    logNote: overrides?.logNote ?? (async (msg) => {
      const { logNote } = await import('../lib/supabase/sync');
      await logNote(msg, 'info');
    }),
  };
}

/** Arme la boucle. false = déjà armée, runner secondaire, ou délai désactivé. true = c'est ce processus qui balaie. */
export function startJoinApproval(overrides?: JoinApprovalDeps): boolean {
  const secondary = overrides?.secondary ?? defaultSecondary();
  const minAgeMin = overrides?.minAgeMin ?? Number(process.env.ALGORIA_AUTOJOIN_MIN ?? 3);
  if (secondary || !(minAgeMin > 0)) return false;
  if (started) return false;
  const deps = resolve({ ...overrides, minAgeMin });
  started = true;
  active = deps;
  console.log(`[algoria] auto-approbation des demandes d'adhésion : ON (délai ${deps.minAgeMin} min)`);
  console.log('[algoria] auto-approbation : armée avant la connexion MetaApi');
  const tick = () => { void runJoinApprovalPass(); };
  tick();
  timer = setInterval(tick, deps.intervalMs);
  return true;
}

/**
 * Un passage. Si un passage est déjà en cours (intervalle + rappel après la connexion MetaApi),
 * on attend CELUI-LÀ au lieu d'en ouvrir un second : une demande n'est présentée qu'une fois à Telegram.
 */
export function runJoinApprovalPass(): Promise<void> {
  if (!started) return inflight ?? Promise.resolve();
  if (inflight) return inflight;
  let resolveDone!: () => void;
  const job = new Promise<void>((resolve) => { resolveDone = resolve; });
  inflight = job;
  void pass().finally(() => {
    if (inflight === job) inflight = null;
    resolveDone();
  });
  return job;
}

/** Arrête la boucle et attend le passage en cours. Les tests s'en servent ; le runner, lui, la laisse tourner. */
export async function stopJoinApproval(): Promise<void> {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
  const pending = inflight;
  if (pending) await pending;
  active = null;
}

async function vipChatIdOf(deps: Resolved): Promise<string> {
  if (deps.vipChatId) return deps.vipChatId;
  const { VIP_CHAT } = await import('./telegram');
  return VIP_CHAT;
}

async function pass(): Promise<void> {
  const deps = active;
  if (!deps) return;
  try {
    const vipChat = await vipChatIdOf(deps);
    // VIP_CHAT vide ou non numérique = on ne sait pas identifier le canal VIP, donc rien à exclure.
    const vipId = Number(vipChat);
    const vipKnown = Number.isFinite(vipId) && vipId !== 0;
    const vipOpen = Number.isFinite(vipId) && (await deps.runnerSwitch('vip_autojoin')) === 'on';
    // 'off' seul coupe le public. null (lecture ratée) ou ligne absente → on continue, comme avant.
    const publicOpen = (await deps.runnerSwitch('public_autojoin')) !== 'off';
    const exclude = Number.isFinite(vipId) ? [vipId] : [];
    const [publiques, vip] = await Promise.all([
      publicOpen ? deps.listPublic(deps.minAgeMin, JOIN_BATCH, exclude) : Promise.resolve([] as JoinRow[]),
      vipOpen ? deps.listVip(deps.minAgeMin, vipId, JOIN_BATCH) : Promise.resolve([] as JoinRow[]),
    ]);
    // Filet : même si la liste publique contient le VIP (exclude SQL raté), on ne l'approuve pas par ce chemin.
    // Le VIP n'entre que par listRipeVipRequests, et seulement interrupteur ouvert.
    const seen = new Set<number>();
    const ripe: JoinRow[] = [];
    for (const r of publiques) {
      if (vipKnown && Number(r.chat_id) === vipId) continue;
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      ripe.push(r);
    }
    if (vipOpen) {
      for (const r of vip) {
        if (vipKnown && Number(r.chat_id) !== vipId) continue;
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        ripe.push(r);
      }
    }
    if (!ripe.length) return;
    let ok = 0;
    for (const r of ripe) {
      const res = await deps.approve(Number(r.chat_id), Number(r.user_id));
      if (res.ok) { ok++; await deps.mark(r.id, null); }
      else if (res.error) await deps.mark(r.id, res.error.slice(0, 200));
      // res.error null = pépin réseau → on laisse la ligne en file pour le prochain passage
    }
    if (ok) {
      await deps.logNote(`🚪 ${ok} join request(s) auto-approved after ${deps.minAgeMin} min${vip.length ? ` · dont ${vip.length} VIP (lots validés)` : ''}`);
    }
  } catch (e) {
    console.error('[algoria] auto-approbation des adhésions échouée:', e);
  }
}
