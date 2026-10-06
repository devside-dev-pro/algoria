// VISUEL « DÉPÔTS PAR PAYS » DU RITUEL DU LUNDI (06/10/2026) — pour Benjamin (associé, ads).
// Le rituel calcule les chiffres en base (Supabase), les écrit dans un JSON, puis lance :
//   node scripts/weekly/countryVisual.mjs --data <chiffres.json> --out <visuel.png>
// Rendu par Chromium (Playwright), portrait 1080×1350 en ×2 : lisible sur un téléphone, prêt pour WhatsApp.
// Polices : Space Grotesk + JetBrains Mono (Google Fonts), téléchargées au premier lancement dans un cache local
// (curl, qui passe par le proxy de l'environnement) ; sans réseau, le rendu se fait avec les polices système.
//
// Format du JSON :
// { "period": "28/09 au 04/10",
//   "kpis": { "deps": 25, "prevDeps": 17, "amount": 9371, "prevAmount": 6868, "com": 11550, "prevCom": 7500 },
//   "rows": [ { "code": "UK", "name": "Royaume-Uni", "signups": 63, "prevSignups": 78,
//               "deps": 13, "amount": 5480, "com": 5800, "prevDeps": 13, "prevAmount": 6168 } ],
//   "unknown": { "deps": 1, "amount": 200 } }
// prevSignups / prevDeps / prevAmount : facultatifs (absents = pas affichés). Les lignes sont triées ici par commission.
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const dataPath = arg('--data');
const out = arg('--out');
if (!dataPath || !out) { console.error('usage: node scripts/weekly/countryVisual.mjs --data chiffres.json --out visuel.png'); process.exit(1); }
const d = JSON.parse(readFileSync(dataPath, 'utf8'));

// Playwright : celui du projet s'il est installé, sinon l'installation globale de l'environnement cloud
async function loadPlaywright() {
  for (const spec of ['playwright', '/opt/node22/lib/node_modules/playwright/index.mjs']) {
    try { return await import(spec); } catch { /* suivant */ }
  }
  throw new Error('Playwright introuvable');
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const usd = (n) => `${Math.round(Number(n) || 0).toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ')} $`;
const FONT_DIR = process.env.WEEKLY_FONT_DIR ?? resolve(tmpdir(), 'algoria-weekly-fonts');
const FONTS = { 'SpaceGrotesk.woff2': 'Space+Grotesk:wght@500;700', 'JetBrainsMono.woff2': 'JetBrains+Mono:wght@500;700' };
function ensureFonts() {
  mkdirSync(FONT_DIR, { recursive: true });
  for (const [file, family] of Object.entries(FONTS)) {
    const dest = resolve(FONT_DIR, file);
    if (existsSync(dest)) continue;
    try {
      const css = execFileSync('curl', ['-s', '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', `https://fonts.googleapis.com/css2?family=${family}&display=swap`], { encoding: 'utf8' });
      // le bloc « latin » : c'est lui qui couvre les accents français
      const latin = css.split('/* latin */')[1] ?? css;
      const url = /url\((https:[^)]+\.(?:woff2|ttf))\)/.exec(latin)?.[1];
      if (url) execFileSync('curl', ['-s', '-o', dest, url]);
    } catch { /* hors ligne : polices système */ }
  }
}
ensureFonts();
const fontUrl = (f) => pathToFileURL(resolve(FONT_DIR, f)).href;
const logo = readFileSync(resolve(root, 'public/brand/algoria-mark.png')).toString('base64');

const rows = [...(d.rows ?? [])].sort((a, b) => (b.com ?? 0) - (a.com ?? 0) || (b.signups ?? 0) - (a.signups ?? 0));
const max = Math.max(1, ...rows.map((r) => r.com ?? 0));
const k = d.kpis ?? {};
const prev = (v, fmt = (x) => x) => (v == null ? '' : `<i>sem. préc. ${esc(fmt(v))}</i>`);

const rowHtml = rows.map((r) => {
  const zero = !r.deps;
  const ratio = r.signups ? `${Math.round((100 * (r.deps ?? 0)) / r.signups)} %` : '–';
  const w = r.com ? Math.max(0.6, (r.com / max) * 100) : 0;
  const prevBits = r.prevDeps != null ? ` <i>· sem. préc. ${r.prevDeps}${r.prevAmount != null ? ` · ${esc(usd(r.prevAmount))}` : ''}</i>` : '';
  return `<div class="row${zero ? ' zero' : ''}">
    <div class="cc">${esc(r.code)}</div>
    <div class="nm"><b>${esc(r.name)}</b><span>${r.signups ?? 0} inscrits${r.prevSignups != null ? ` <i>(${r.prevSignups})</i>` : ''} · ratio ${ratio}</span></div>
    <div class="barw">${w ? `<div class="bar" style="width:calc((100% - 150px) * ${w} / 100)"></div>` : ''}
      <div class="val">${zero ? '0 dépôt' : esc(usd(r.com))}</div>
      <div class="sub">${r.deps ?? 0} dépôt${(r.deps ?? 0) > 1 ? 's' : ''} · ${esc(usd(r.amount))}${prevBits}</div></div></div>`;
}).join('');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:'SG';font-weight:300 700;src:url('${fontUrl('SpaceGrotesk.woff2')}')}
@font-face{font-family:'JB';font-weight:300 800;src:url('${fontUrl('JetBrainsMono.woff2')}')}
*{margin:0;padding:0;box-sizing:border-box}
body{width:1080px;min-height:1350px;font-family:'SG';color:#e8f0ff;background:linear-gradient(180deg,#10223e 0%,#0a1322 45%,#070b12 100%);position:relative;padding-bottom:110px}
.glow{position:absolute;left:-200px;top:-260px;width:800px;height:800px;border-radius:50%;background:radial-gradient(circle,rgba(43,227,245,.14),transparent 70%)}
.wrap{position:relative;padding:56px 60px}
.top{display:flex;align-items:center;gap:14px}.top img{width:46px}
.brand{font-size:30px;font-weight:700;background:linear-gradient(90deg,#2be3f5,#2e8bf0);-webkit-background-clip:text;color:transparent}
.tag{margin-left:auto;font:700 15px 'JB';letter-spacing:2px;color:#f5c24a;border:1.5px solid rgba(245,194,74,.5);border-radius:999px;padding:8px 16px}
h1{font-size:50px;font-weight:700;margin-top:34px;line-height:1.05}
.period{font:500 19px 'JB';color:rgba(147,165,196,.9);margin-top:10px;letter-spacing:1px}
.kpis{display:flex;gap:16px;margin-top:30px}
.k{flex:1;border:1px solid rgba(130,152,190,.22);background:rgba(255,255,255,.03);border-radius:18px;padding:18px 20px}
.k span{font:500 13px 'JB';letter-spacing:2px;color:rgba(147,165,196,.9)}
.k b{display:block;font-size:42px;font-weight:700;margin-top:6px}
.k.gold b{color:#f5c24a}
.k i{font:500 14px 'JB';font-style:normal;color:rgba(147,165,196,.8)}
.lbl{display:flex;justify-content:space-between;font:500 13px 'JB';letter-spacing:2px;color:rgba(147,165,196,.75);margin:34px 0 10px}
.row{display:flex;align-items:center;gap:16px;padding:12px 0;border-top:1px solid rgba(130,152,190,.12)}
.cc{width:54px;height:40px;border-radius:10px;background:rgba(43,227,245,.1);border:1px solid rgba(43,227,245,.35);font:700 17px 'JB';color:#2be3f5;display:flex;align-items:center;justify-content:center}
.nm{width:300px}.nm b{display:block;font-size:22px}.nm span{font:500 14px 'JB';color:rgba(147,165,196,.85)}.nm i{font-style:normal;opacity:.7}
.barw{flex:1;position:relative;height:58px}
.bar{position:absolute;left:0;top:4px;height:24px;border-radius:0 6px 6px 0;background:linear-gradient(90deg,#c98a1c,#f5c24a)}
.val{position:absolute;right:0;top:0;font-size:24px;font-weight:700}
.sub{position:absolute;left:0;top:34px;font:500 14px 'JB';color:rgba(200,214,236,.85)}.sub i{font-style:normal;color:rgba(147,165,196,.6)}
.row.zero .cc{opacity:.45}.row.zero .nm b{color:rgba(232,240,255,.55)}.row.zero .val{color:#ff8aa3;font-size:18px;top:4px}
.note{position:absolute;left:60px;right:60px;bottom:42px;font:500 13px 'JB';color:rgba(147,165,196,.65);line-height:1.5}
</style></head><body><div class="glow"></div><div class="wrap">
<div class="top"><img src="data:image/png;base64,${logo}"><div class="brand">ALGORIA</div><div class="tag">BILAN ADS · HEBDO</div></div>
<h1>Dépôts par pays</h1><div class="period">SEMAINE DU ${esc(d.period)} · (ENTRE PARENTHÈSES : SEM. PRÉC.)</div>
<div class="kpis">
  <div class="k"><span>DÉPÔTS</span><b>${k.deps ?? 0}</b>${prev(k.prevDeps)}</div>
  <div class="k"><span>MONTANT DÉPOSÉ</span><b>${esc(usd(k.amount))}</b>${prev(k.prevAmount, usd)}</div>
  <div class="k gold"><span>COMMISSION</span><b>${esc(usd(k.com))}</b>${prev(k.prevCom, usd)}</div>
</div>
<div class="lbl"><span>PAYS · INSCRITS · RATIO DÉPÔTS/INSCRITS</span><span>COMMISSION</span></div>
${rowHtml}
</div><div class="note">Ratio = dépôts de la semaine ÷ inscrits de la semaine : ce ne sont pas exactement les mêmes personnes (une partie des dépôts vient d'inscrits plus anciens).${d.unknown?.deps ? ` ${d.unknown.deps} dépôt${d.unknown.deps > 1 ? 's' : ''} (${esc(usd(d.unknown.amount))}) au pays inconnu non affiché${d.unknown.deps > 1 ? 's' : ''}.` : ''}</div></body></html>`;

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 2 });
// fichier local (et pas setContent) : une page about:blank n'a pas le droit de charger les polices en file://
const tmp = `${out}.html`;
writeFileSync(tmp, html);
await page.goto(pathToFileURL(resolve(tmp)).href, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
unlinkSync(tmp);
console.log(out);
