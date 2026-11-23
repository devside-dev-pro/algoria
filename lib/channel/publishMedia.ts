// CHOIX DE L'IMAGE AU MOMENT DE PUBLIER UN POST DU CANAL (23/11/2026).
// La bannière de marque (/api/card/banner) et la carte de gain (/api/card/win) avaient cessé d'être recollées :
// depuis le 10/11, une image ne partait que s'il s'agissait d'une vraie photo, l'API bannière refusait les kinds
// lesson/story, et la carte de gain ne revenait que si support_settings cm_trade_card = on (absent → off).
// Décision Mathieu du 23/11 : recoller la bannière sur les posts marqués report.banner / report.visual, recoller
// la carte de gain sur les posts VIP (y compris le texte validé en +$[X]), et activer cm_trade_card par défaut.
export const BANNER_KINDS = ['morning', 'howto', 'cta', 'qa', 'lesson', 'story'] as const;

export function isBannerKind(kind: string): boolean {
  return (BANNER_KINDS as readonly string[]).includes(kind);
}

/** Interrupteur cm_trade_card : absent ou autre chose que off → la carte de gain est allumée (23/11/2026). */
export function isTradeCardEnabled(value: string | null | undefined): boolean {
  return String(value ?? 'on').trim().toLowerCase() !== 'off';
}

/** Un post porte la bannière de marque seulement s'il est tagué et que son kind est accepté par l'API. */
export function wantsBrandBanner(kind: string, report: unknown): boolean {
  if (!isBannerKind(kind)) return false;
  const rep = report && typeof report === 'object' && !Array.isArray(report) ? report as Record<string, unknown> : {};
  return rep.banner === true || rep.banner === 'true' || rep.visual === 'banner' || rep.visual === 'brand';
}

export function winCardUrl(appUrl: string, ticket: string, strategy?: number | null): string {
  return `${appUrl}/api/card/win?ticket=${encodeURIComponent(String(ticket))}&strategy=${Number(strategy ?? 2)}`;
}

export type PublishWin = { ticket: string; strategy?: number | null };

export function resolvePublishPhoto(i: {
  kind: string;
  existingPhoto?: string | null;
  report: unknown;
  vipWin?: PublishWin | null;
  tradeWin?: PublishWin | null;
  tradeCardOn: boolean;
  appUrl: string;
  bannerUrl?: string;
}): string {
  const card = (w: PublishWin) => (i.tradeCardOn ? winCardUrl(i.appUrl, w.ticket, w.strategy) : '');
  if (i.vipWin) return card(i.vipWin);
  if (i.kind === 'tp' || i.kind === 'trade') return i.tradeWin ? card(i.tradeWin) : '';
  const existing = (i.existingPhoto ?? '').trim();
  if (existing) return existing;
  if (i.bannerUrl && wantsBrandBanner(i.kind, i.report)) return i.bannerUrl;
  return '';
}
