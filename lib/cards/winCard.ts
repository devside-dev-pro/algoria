// WIN CARD — le visuel « flex » façon Binance/Bybit : un gain, le P&L en énorme, le branding Algoria
// et un QR code qui ramène du monde. Généré 100% côté client (canvas), deux formats :
//   story 1080×1920 (stories Insta/TikTok) · landscape 1200×675 (posts, Telegram, X — la carte Binance).
// Deux usages : le membre partage SES gains (QR = SON lien de parrainage → il gagne 50$),
// la CM télécharge les gains du compte maître pour le canal (QR = algoria.tech).
import QRCode from 'qrcode';

export type CardFormat = 'story' | 'landscape';

export interface WinCardOpts {
  symbol: string; // 'XAUUSD' | 'BTCUSD'
  direction: string; // 'long' | 'short'
  pnl: number; // gain en $ (positif)
  closedAt?: string | null; // ISO — affiché en date lisible
  qrUrl: string; // destination du QR (lien de parrainage du membre, ou algoria.tech)
  qrLabel: string; // texte sous le QR (ex. 'algoria.tech' ou 'app.algoria.tech/r/ab12cd')
  format?: CardFormat; // défaut : story
}

/** family CSS réelle des polices next/font (noms hashés) — repli system si absent (SSR, tests). */
function fontFamily(varName: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return v ? `${v}, ${fallback}` : fallback;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // la carte se dessine même sans le logo
    img.src = src;
  });
}

interface DrawCtx {
  ctx: CanvasRenderingContext2D;
  display: string;
  mono: string;
  qrImg: HTMLImageElement | null;
  mark: HTMLImageElement | null;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const symLabelOf = (symbol: string) => (symbol === 'XAUUSD' ? 'GOLD' : symbol === 'BTCUSD' ? 'BITCOIN' : symbol);

function paintBackground(ctx: CanvasRenderingContext2D, W: number, H: number, haloAt: { x: number; y: number }, glowAt: { x: number; y: number }) {
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#10223e');
  bg.addColorStop(0.5, '#0a1322');
  bg.addColorStop(1, '#070b12');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const halo = ctx.createRadialGradient(haloAt.x, haloAt.y, 0, haloAt.x, haloAt.y, Math.max(W, H) * 0.55);
  halo.addColorStop(0, 'rgba(43,227,245,.14)');
  halo.addColorStop(1, 'rgba(43,227,245,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(glowAt.x, glowAt.y, 0, glowAt.x, glowAt.y, Math.max(W, H) * 0.42);
  glow.addColorStop(0, 'rgba(34,224,166,.12)');
  glow.addColorStop(1, 'rgba(34,224,166,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
}

function paintQr(d: DrawCtx, x: number, y: number, size: number) {
  if (!d.qrImg) return;
  d.ctx.fillStyle = '#ffffff';
  d.ctx.beginPath();
  d.ctx.roundRect(x - 14, y - 14, size + 28, size + 28, 22); // partout depuis Chrome 99 / Safari 16 — nos cibles PWA
  d.ctx.fill();
  d.ctx.drawImage(d.qrImg, x, y, size, size);
}

// ===== STORY 1080×1920 — tout centré, le P&L au milieu, le QR en bas =====
function drawStory(d: DrawCtx, o: WinCardOpts): void {
  const { ctx, display, mono } = d;
  const W = 1080;
  paintBackground(ctx, W, 1920, { x: W / 2, y: 350 }, { x: W / 2, y: 980 });
  ctx.textAlign = 'center';

  if (d.mark) ctx.drawImage(d.mark, W / 2 - 160, 150, 92, 92);
  ctx.font = `800 64px ${display}`;
  const grad = ctx.createLinearGradient(W / 2 - 60, 0, W / 2 + 260, 0);
  grad.addColorStop(0, '#2be3f5');
  grad.addColorStop(1, '#2e8bf0');
  ctx.fillStyle = grad;
  ctx.fillText('ALGORIA', W / 2 + 60, 218);

  ctx.font = `500 30px ${mono}`;
  ctx.fillStyle = 'rgba(147,165,196,.9)';
  ctx.fillText('AI TRADE CLOSED · REAL ACCOUNT', W / 2, 320);

  const isLong = o.direction === 'long';
  ctx.font = `800 72px ${display}`;
  ctx.fillStyle = isLong ? '#22e0a6' : '#ff6b8a';
  ctx.fillText(`${isLong ? '▲ LONG' : '▼ SHORT'}  ${symLabelOf(o.symbol)}`, W / 2, 640);

  ctx.save();
  ctx.shadowColor = 'rgba(34,224,166,.55)';
  ctx.shadowBlur = 60;
  ctx.font = `800 230px ${display}`;
  ctx.fillStyle = '#22e0a6';
  ctx.fillText(`+$${Math.round(o.pnl)}`, W / 2, 940);
  ctx.restore();

  ctx.font = `500 34px ${mono}`;
  ctx.fillStyle = '#f5c24a';
  ctx.fillText('PROFIT BANKED AUTOMATICALLY', W / 2, 1030);

  if (o.closedAt) {
    ctx.font = `400 30px ${mono}`;
    ctx.fillStyle = 'rgba(147,165,196,.75)';
    ctx.fillText(fmtDate(o.closedAt), W / 2, 1096);
  }

  ctx.strokeStyle = 'rgba(130,152,190,.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(200, 1210);
  ctx.lineTo(W - 200, 1210);
  ctx.stroke();

  ctx.font = `700 42px ${display}`;
  ctx.fillStyle = '#e8f0ff';
  ctx.fillText('The AI trades gold & Bitcoin — live.', W / 2, 1310);
  ctx.font = `500 32px ${display}`;
  ctx.fillStyle = 'rgba(147,165,196,.9)';
  ctx.fillText('Watch it for free. Scan to get in.', W / 2, 1366);

  paintQr(d, W / 2 - 165, 1424, 330);

  ctx.font = `700 40px ${mono}`;
  ctx.fillStyle = '#2be3f5';
  ctx.fillText(o.qrLabel, W / 2, 1848);
}

// ===== LANDSCAPE 1200×675 — la carte Binance : métriques à gauche, QR en bas-gauche,
// marque en filigrane à droite, date en bas-droite. Pour les posts canal/X/Telegram. =====
function drawLandscape(d: DrawCtx, o: WinCardOpts): void {
  const { ctx, display, mono } = d;
  const W = 1200;
  const H = 675;
  paintBackground(ctx, W, H, { x: 190, y: 90 }, { x: 420, y: 400 });

  // filigrane : la marque en très grand, très discrète, sur la moitié droite (la « fusée » Binance)
  if (d.mark) {
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.drawImage(d.mark, W - 470, H / 2 - 210, 430, 430);
    ctx.restore();
  }

  ctx.textAlign = 'left';

  // marque + tagline
  if (d.mark) ctx.drawImage(d.mark, 56, 44, 58, 58);
  ctx.font = `800 44px ${display}`;
  const grad = ctx.createLinearGradient(128, 0, 400, 0);
  grad.addColorStop(0, '#2be3f5');
  grad.addColorStop(1, '#2e8bf0');
  ctx.fillStyle = grad;
  ctx.fillText('ALGORIA', 128, 90);
  ctx.font = `500 20px ${mono}`;
  ctx.fillStyle = 'rgba(147,165,196,.9)';
  ctx.fillText('AI COPY TRADING · REAL ACCOUNT', 132, 122);

  // le trade
  const isLong = o.direction === 'long';
  ctx.font = `800 46px ${display}`;
  ctx.fillStyle = isLong ? '#22e0a6' : '#ff6b8a';
  ctx.fillText(`${isLong ? '▲ LONG' : '▼ SHORT'}  ${symLabelOf(o.symbol)}`, 60, 232);

  // le P&L — le héros, aligné à gauche comme le ROI Binance
  ctx.save();
  ctx.shadowColor = 'rgba(34,224,166,.5)';
  ctx.shadowBlur = 45;
  ctx.font = `800 150px ${display}`;
  ctx.fillStyle = '#22e0a6';
  ctx.fillText(`+$${Math.round(o.pnl)}`, 54, 386);
  ctx.restore();

  ctx.font = `500 24px ${mono}`;
  ctx.fillStyle = '#f5c24a';
  ctx.fillText('PROFIT BANKED AUTOMATICALLY', 60, 434);

  // QR bas-gauche + pitch à sa droite (le bloc « code de parrainage » Binance)
  const qs = 150;
  const qy = H - qs - 56;
  paintQr(d, 60, qy, qs);
  ctx.font = `700 26px ${display}`;
  ctx.fillStyle = '#e8f0ff';
  ctx.fillText('Watch the AI trade live — free.', 250, qy + 52);
  ctx.font = `500 22px ${display}`;
  ctx.fillStyle = 'rgba(147,165,196,.9)';
  ctx.fillText('Scan to get in.', 250, qy + 88);
  ctx.font = `700 26px ${mono}`;
  ctx.fillStyle = '#2be3f5';
  ctx.fillText(o.qrLabel, 250, qy + 132);

  // date bas-droite (le « Останній день » Binance)
  if (o.closedAt) {
    ctx.textAlign = 'right';
    ctx.font = `400 20px ${mono}`;
    ctx.fillStyle = 'rgba(147,165,196,.7)';
    ctx.fillText(`Closed: ${fmtDate(o.closedAt)}`, W - 48, H - 44);
  }
}

// ===== CARTE RÉCAP (jour / semaine) — le post de fin de session : « X wins · +$Y banked » =====
export interface RecapCardOpts {
  periodLabel: string; // 'TODAY'S SESSION' | 'THIS WEEK'
  count: number; // nb de trades gagnants
  total: number; // $ encaissés sur la période
  best: number; // meilleur trade
  dateLabel: string; // '07 Jul 2026' ou '01 – 07 Jul 2026'
  qrUrl: string;
  qrLabel: string;
  format?: CardFormat;
}

function drawRecapStory(d: DrawCtx, o: RecapCardOpts): void {
  const { ctx, display, mono } = d;
  const W = 1080;
  paintBackground(ctx, W, 1920, { x: W / 2, y: 350 }, { x: W / 2, y: 980 });
  ctx.textAlign = 'center';

  if (d.mark) ctx.drawImage(d.mark, W / 2 - 160, 150, 92, 92);
  ctx.font = `800 64px ${display}`;
  const grad = ctx.createLinearGradient(W / 2 - 60, 0, W / 2 + 260, 0);
  grad.addColorStop(0, '#2be3f5');
  grad.addColorStop(1, '#2e8bf0');
  ctx.fillStyle = grad;
  ctx.fillText('ALGORIA', W / 2 + 60, 218);

  ctx.font = `500 30px ${mono}`;
  ctx.fillStyle = 'rgba(147,165,196,.9)';
  ctx.fillText(`${o.periodLabel} · REAL ACCOUNT`, W / 2, 320);

  ctx.font = `800 78px ${display}`;
  ctx.fillStyle = '#22e0a6';
  ctx.fillText(`✓ ${o.count} WINNING TRADES`, W / 2, 620);

  ctx.save();
  ctx.shadowColor = 'rgba(34,224,166,.55)';
  ctx.shadowBlur = 60;
  ctx.font = `800 210px ${display}`;
  ctx.fillStyle = '#22e0a6';
  ctx.fillText(`+$${Math.round(o.total)}`, W / 2, 920);
  ctx.restore();

  ctx.font = `500 34px ${mono}`;
  ctx.fillStyle = '#f5c24a';
  ctx.fillText('BANKED BY THE AI — AUTOMATICALLY', W / 2, 1010);

  ctx.font = `500 32px ${mono}`;
  ctx.fillStyle = 'rgba(147,165,196,.85)';
  ctx.fillText(`BEST TRADE +$${Math.round(o.best)}  ·  ${o.dateLabel}`, W / 2, 1090);

  ctx.strokeStyle = 'rgba(130,152,190,.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(200, 1210);
  ctx.lineTo(W - 200, 1210);
  ctx.stroke();

  ctx.font = `700 42px ${display}`;
  ctx.fillStyle = '#e8f0ff';
  ctx.fillText('The AI trades gold & Bitcoin — live.', W / 2, 1310);
  ctx.font = `500 32px ${display}`;
  ctx.fillStyle = 'rgba(147,165,196,.9)';
  ctx.fillText('Watch it for free. Scan to get in.', W / 2, 1366);

  paintQr(d, W / 2 - 165, 1424, 330);

  ctx.font = `700 40px ${mono}`;
  ctx.fillStyle = '#2be3f5';
  ctx.fillText(o.qrLabel, W / 2, 1848);
}

function drawRecapLandscape(d: DrawCtx, o: RecapCardOpts): void {
  const { ctx, display, mono } = d;
  const W = 1200;
  const H = 675;
  paintBackground(ctx, W, H, { x: 190, y: 90 }, { x: 420, y: 400 });

  if (d.mark) {
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.drawImage(d.mark, W - 470, H / 2 - 210, 430, 430);
    ctx.restore();
  }

  ctx.textAlign = 'left';

  if (d.mark) ctx.drawImage(d.mark, 56, 44, 58, 58);
  ctx.font = `800 44px ${display}`;
  const grad = ctx.createLinearGradient(128, 0, 400, 0);
  grad.addColorStop(0, '#2be3f5');
  grad.addColorStop(1, '#2e8bf0');
  ctx.fillStyle = grad;
  ctx.fillText('ALGORIA', 128, 90);
  ctx.font = `500 20px ${mono}`;
  ctx.fillStyle = 'rgba(147,165,196,.9)';
  ctx.fillText(`${o.periodLabel} · REAL ACCOUNT`, 132, 122);

  ctx.font = `800 46px ${display}`;
  ctx.fillStyle = '#22e0a6';
  ctx.fillText(`✓ ${o.count} WINNING TRADES`, 60, 232);

  ctx.save();
  ctx.shadowColor = 'rgba(34,224,166,.5)';
  ctx.shadowBlur = 45;
  ctx.font = `800 140px ${display}`;
  ctx.fillStyle = '#22e0a6';
  ctx.fillText(`+$${Math.round(o.total)}`, 54, 380);
  ctx.restore();

  ctx.font = `500 24px ${mono}`;
  ctx.fillStyle = '#f5c24a';
  ctx.fillText(`BANKED AUTOMATICALLY · BEST +$${Math.round(o.best)}`, 60, 430);

  const qs = 150;
  const qy = H - qs - 56;
  paintQr(d, 60, qy, qs);
  ctx.font = `700 26px ${display}`;
  ctx.fillStyle = '#e8f0ff';
  ctx.fillText('Watch the AI trade live — free.', 250, qy + 52);
  ctx.font = `500 22px ${display}`;
  ctx.fillStyle = 'rgba(147,165,196,.9)';
  ctx.fillText('Scan to get in.', 250, qy + 88);
  ctx.font = `700 26px ${mono}`;
  ctx.fillStyle = '#2be3f5';
  ctx.fillText(o.qrLabel, 250, qy + 132);

  ctx.textAlign = 'right';
  ctx.font = `400 20px ${mono}`;
  ctx.fillStyle = 'rgba(147,165,196,.7)';
  ctx.fillText(o.dateLabel, W - 48, H - 44);
}

/** Prépare canvas + polices + assets, puis délègue au dessinateur voulu. */
async function renderCard(qrUrl: string, format: CardFormat | undefined, draw: (d: DrawCtx) => void): Promise<Blob> {
  if (typeof document !== 'undefined' && 'fonts' in document) await document.fonts.ready;
  const display = fontFamily('--font-display', 'system-ui, sans-serif');
  const mono = fontFamily('--font-mono', 'ui-monospace, monospace');
  const [qrData, mark] = await Promise.all([
    QRCode.toDataURL(qrUrl, { margin: 1, width: 400, color: { dark: '#0b0e14', light: '#ffffff' } }),
    loadImage('/brand/algoria-mark.png'),
  ]);
  const qrImg = await loadImage(qrData);
  const landscape = format === 'landscape';
  const cv = document.createElement('canvas');
  cv.width = landscape ? 1200 : 1080;
  cv.height = landscape ? 675 : 1920;
  const ctx = cv.getContext('2d')!;
  draw({ ctx, display, mono, qrImg, mark });
  return new Promise<Blob>((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas export failed'))), 'image/png'));
}

/** Dessine la carte d'UN gain (format story par défaut) et retourne le PNG en Blob. */
export async function drawWinCard(o: WinCardOpts): Promise<Blob> {
  return renderCard(o.qrUrl, o.format, (d) => (o.format === 'landscape' ? drawLandscape(d, o) : drawStory(d, o)));
}

/** Dessine la carte RÉCAP (jour/semaine) et retourne le PNG en Blob. */
export async function drawRecapCard(o: RecapCardOpts): Promise<Blob> {
  return renderCard(o.qrUrl, o.format, (d) => (o.format === 'landscape' ? drawRecapLandscape(d, o) : drawRecapStory(d, o)));
}

/** Partage natif (story-ready) si dispo, sinon téléchargement direct du PNG. */
export async function shareOrDownloadCard(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file] });
      return;
    } catch {
      /* annulé → repli téléchargement */
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
