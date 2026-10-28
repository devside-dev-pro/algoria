// LES MIROIRS ANGLAIS DU CANAL SOURCE (28/10/2026). Server-only (lit process.env).
//
// Jusqu'ici un seul miroir, le canal UK (TELEGRAM_CHANNEL_MIRROR, 01/08). Mathieu, le 28/10 : « j'ai mon ancien
// canal Cash-flow qui est en train de mourir, j'aimerais bien le transformer en miroir comme on a fait pour les UK
// et l'Italie ». Cashflow (~4 690 abonnés) reçoit donc EXACTEMENT ce que reçoit le miroir UK : les mêmes posts
// anglais, copiés tels quels (fan-out des posts écrits à la main, publication du CM, récap du soir, posts de l'admin).
//
// POURQUOI une variable par miroir plutôt qu'une liste « TELEGRAM_CHANNEL_MIRRORS=a,b » : chaque miroir garde un
// NOM lisible dans les rapports (« mirror Cashflow »), l'existant (TELEGRAM_CHANNEL_MIRROR) ne bouge pas, et
// ajouter un troisième miroir, c'est une ligne dans EXTRA_MIRRORS.
//
// TANT QUE LA VARIABLE N'EST PAS POSÉE, RIEN NE CHANGE : extraMirrors() rend [] et chaque appelant retombe sur le
// chemin d'avant, à l'octet près.
//
// GARDE-FOUS : un miroir supplémentaire qui pointerait sur la source, sur le canal italien ou sur le miroir UK est
// IGNORÉ (doublon de post, ou pire, la source qui se recopie elle-même).

type Env = Record<string, string | undefined>;

export type Mirror = {
  /** id numérique du canal (-100…) */
  chat: string;
  /** variable d'environnement d'où il vient */
  env: string;
  /** libellé des rapports de publication (publishToChannels, admin) */
  label: string;
  /** libellé court du rapport de /api/channel-relink */
  name: string;
};

/** Les miroirs EN en plus du miroir UK. Ajouter un miroir = ajouter une ligne ici. */
export const EXTRA_MIRRORS: ReadonlyArray<{ env: string; label: string }> = [
  { env: 'TELEGRAM_CHANNEL_MIRROR_CASHFLOW', label: 'mirror Cashflow' },
];

const v = (env: Env, k: string) => (env[k] ?? '').trim();

/** Le miroir UK historique (TELEGRAM_CHANNEL_MIRROR), ou null s'il n'est pas posé. */
export function ukMirror(env: Env = process.env): Mirror | null {
  const chat = v(env, 'TELEGRAM_CHANNEL_MIRROR');
  return chat ? { chat, env: 'TELEGRAM_CHANNEL_MIRROR', label: 'mirror UK', name: 'mirror' } : null;
}

/** Les miroirs supplémentaires posés, sans doublon ni collision avec la source, l'italien ou le miroir UK. */
export function extraMirrors(env: Env = process.env): Mirror[] {
  const taken = new Set([v(env, 'TELEGRAM_CHANNEL_EN'), v(env, 'TELEGRAM_CHANNEL_IT'), v(env, 'TELEGRAM_CHANNEL_MIRROR')].filter(Boolean));
  const out: Mirror[] = [];
  for (const m of EXTRA_MIRRORS) {
    const chat = v(env, m.env);
    if (!chat || taken.has(chat)) continue;
    taken.add(chat);
    out.push({ chat, env: m.env, label: m.label, name: m.label });
  }
  return out;
}

/** Tous les miroirs EN : le miroir UK d'abord, puis les supplémentaires. */
export function allMirrors(env: Env = process.env): Mirror[] {
  const uk = ukMirror(env);
  return [...(uk ? [uk] : []), ...extraMirrors(env)];
}
