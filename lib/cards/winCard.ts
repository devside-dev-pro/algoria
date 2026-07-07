// WIN CARD — le visuel « flex » façon Binance/Bybit : un gain, le P&L en énorme, le branding Algoria
// et un QR code qui ramène du monde. Généré 100% côté client (canvas), format story 1080×1920.
// Deux usages : le membre partage SES gains en story (QR = SON lien de parrainage → il gagne 50$),
// la CM télécharge les gains du compte maître pour le canal (QR = algoria.tech).
import QRCode from 'qrcode';

export interface WinCardOpts {
  symbol: string; // 'XAUUSD' | 'BTCUSD'
  direction: string; // 'long' | 'short'
  pnl: number; // gain en $ (positif)
  closedAt?: string | null; // ISO — affiché en date lisible
  qrUrl: string; // destination du QR (lien de parrainage du membre, ou algoria.tech)
  qrLabel: string; // texte sous le QR (ex. 'algoria.tech' ou 'app.algoria.tech/r/ab12cd')
}

const W = 1080;
const H = 1920;

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

/** Dessine la carte et retourne le PNG en Blob (à télécharger ou passer à navigator.share). */
export async function drawWinCard(o: WinCardOpts): Promise<Blob> {
  if (typeof document !== 'undefined' && 'fonts' in document) await document.fonts.ready;
  const display = fontFamily('--font-display', 'system-ui, sans-serif');
  const mono = fontFamily('--font-mono', 'ui-monospace, monospace');
  const [qrData, mark] = await Promise.all([
    QRCode.toDataURL(o.qrUrl, { margin: 1, width: 400, color: { dark: '#0b0e14', light: '#ffffff' } }),
    loadImage('/brand/algoria-mark.png'),
  ]);
  const qrImg = await loadImage(qrData);

  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;

  // ===== fond : nuit Algoria + halo cyan (le même ADN que l'app) =====
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#10223e');
  bg.addColorStop(0.5, '#0a1322');
  bg.addColorStop(1, '#070b12');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const halo = ctx.createRadialGradient(W / 2, 350, 0, W / 2, 350, 900);
  halo.addColorStop(0, 'rgba(43,227,245,.14)');
  halo.addColorStop(1, 'rgba(43,227,245,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 980, 0, W / 2, 980, 700);
  glow.addColorStop(0, 'rgba(34,224,166,.12)');
  glow.addColorStop(1, 'rgba(34,224,166,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';

  // ===== marque =====
  if (mark) ctx.drawImage(mark, W / 2 - 160, 150, 92, 92);
  ctx.font = `800 64px ${display}`;
  const grad = ctx.createLinearGradient(W / 2 - 60, 0, W / 2 + 260, 0);
  grad.addColorStop(0, '#2be3f5');
  grad.addColorStop(1, '#2e8bf0');
  ctx.fillStyle = grad;
  ctx.fillText('ALGORIA', W / 2 + 60, 218);

  ctx.font = `500 30px ${mono}`;
  ctx.fillStyle = 'rgba(147,165,196,.9)';
  ctx.fillText('AI TRADE CLOSED · REAL ACCOUNT', W / 2, 320);

  // ===== le trade =====
  const isLong = o.direction === 'long';
  const symLabel = o.symbol === 'XAUUSD' ? 'GOLD' : o.symbol === 'BTCUSD' ? 'BITCOIN' : o.symbol;
  ctx.font = `800 72px ${display}`;
  ctx.fillStyle = isLong ? '#22e0a6' : '#ff6b8a';
  ctx.fillText(`${isLong ? '▲ LONG' : '▼ SHORT'}  ${symLabel}`, W / 2, 640);

  // le P&L — LE héros de la carte
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
    ctx.fillText(new Date(o.closedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }), W / 2, 1096);
  }

  // séparateur
  ctx.strokeStyle = 'rgba(130,152,190,.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(200, 1210);
  ctx.lineTo(W - 200, 1210);
  ctx.stroke();

  // ===== l'invitation : QR + pitch =====
  ctx.font = `700 42px ${display}`;
  ctx.fillStyle = '#e8f0ff';
  ctx.fillText('The AI trades gold & Bitcoin — live.', W / 2, 1310);
  ctx.font = `500 32px ${display}`;
  ctx.fillStyle = 'rgba(147,165,196,.9)';
  ctx.fillText('Watch it for free. Scan to get in.', W / 2, 1366);

  if (qrImg) {
    const qs = 330;
    const qx = W / 2 - qs / 2;
    const qy = 1420;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(qx - 18, qy - 18, qs + 36, qs + 36, 28); // partout depuis Chrome 99 / Safari 16 — nos cibles PWA
    ctx.fill();
    ctx.drawImage(qrImg, qx, qy, qs, qs);
  }

  ctx.font = `700 40px ${mono}`;
  ctx.fillStyle = '#2be3f5';
  ctx.fillText(o.qrLabel, W / 2, 1848);

  return new Promise<Blob>((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas export failed'))), 'image/png'));
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
