// ADS STUDIO · conformité post-génération (09/11/2026) — pur code, aucun appel IA.
// Filtre bannedIn (Brief Designer) + présence de la risk line du SYSTEM. Le CTA fixe est
// normalisé à part. Ne touche pas aux HARD RULES du prompt SYSTEM.
import { ANGLES, POLES, type Pole } from './ads';
import { bannedIn } from './adsBrief';
import type { AdHook, AdScript } from './ads';

/** CTA figé des scripts générés : canal Telegram public & gratuit (écosystème). */
export const AD_SCRIPT_CTA = 'Click the link 🙏🏼';

/** Risk line exigée dans le body (identique au SYSTEM HARD RULES — ne pas diverger). */
export const SCRIPT_RISK_LINE = "Trading involves risk. Past results don't guarantee future results.";

export type AngleSlot = { angle: string; pole: Pole };

const ANGLE_NOTE_RE = /^Angle:\s*(\S+)/im;

/** Angles déjà vus dans la bibliothèque (hooks + notes de scripts). */
export function recentAngles(scripts: AdScript[], hooks: AdHook[], n = 40): string[] {
  const fromHooks = hooks
    .filter((h) => h.angle)
    .slice(-n)
    .map((h) => String(h.angle).toLowerCase());
  const fromNotes = scripts
    .map((s) => (s.notes ?? '').match(ANGLE_NOTE_RE)?.[1]?.toLowerCase())
    .filter((a): a is string => !!a)
    .slice(-n);
  return [...fromHooks, ...fromNotes];
}

/**
 * Planifie `count` couples (angle × pôle) uniques autant que possible.
 * Préfère les paires absentes des angles récents ; recycle si count > |angles|×|pôles|.
 */
export function planAngleSlots(count: number, preferredPoles: Pole[], scripts: AdScript[], hooks: AdHook[]): AngleSlot[] {
  const poles = (preferredPoles.length ? preferredPoles : [...POLES]) as Pole[];
  const angles = [...ANGLES] as string[];
  const recent = new Set(recentAngles(scripts, hooks));
  // Round-robin angle × pôle pour diversifier le lot (pas tout le même pôle d'affilée).
  const pairs: AngleSlot[] = [];
  const max = Math.max(angles.length, poles.length);
  for (let i = 0; i < angles.length * poles.length; i++) {
    const angle = angles[i % angles.length];
    const pole = poles[Math.floor(i / angles.length) % poles.length];
    // Décalage pour mieux mélanger les pôles :
    const pole2 = poles[(i + Math.floor(i / max)) % poles.length];
    pairs.push({ angle, pole: pole2 });
  }
  // Déduplique en gardant l'ordre.
  const seen = new Set<string>();
  const unique: AngleSlot[] = [];
  for (const p of pairs) {
    const k = `${p.angle}|${p.pole}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(p);
  }
  // Complète toute combinaison manquante.
  for (const pole of poles) for (const angle of angles) {
    const k = `${angle}|${pole}`;
    if (!seen.has(k)) { seen.add(k); unique.push({ angle, pole }); }
  }
  const fresh = unique.filter((p) => !recent.has(p.angle));
  const stale = unique.filter((p) => recent.has(p.angle));
  const ordered = [...fresh, ...stale];
  const out: AngleSlot[] = [];
  const usedKey = new Set<string>();
  let i = 0;
  while (out.length < count && i < ordered.length * 4) {
    const slot = ordered[i % ordered.length];
    i++;
    const key = `${slot.angle}|${slot.pole}`;
    if (usedKey.has(key) && usedKey.size < ordered.length) continue;
    if (out.length && out[out.length - 1].angle === slot.angle && angles.length > 1) continue;
    usedKey.add(key);
    out.push(slot);
  }
  while (out.length < count) {
    out.push(ordered[out.length % ordered.length] ?? { angle: angles[out.length % angles.length], pole: poles[out.length % poles.length] });
  }
  return out.slice(0, count);
}

export function angleNote(angle: string): string {
  return `Angle: ${angle}`;
}

export function parseAngleNote(notes: string | null | undefined): string | null {
  return (notes ?? '').match(ANGLE_NOTE_RE)?.[1] ?? null;
}

/** Normalise la ligne Fin / CTA sans toucher au reste du script. */
export function ensureFixedCta(body: string): string {
  const cta = AD_SCRIPT_CTA;
  if (/["']Click the link\s*🙏🏼["']/i.test(body) || /Click the link\s*🙏🏼/i.test(body)) {
    // Remplace toute variante de CTA « Click the link » par la forme canonique entre guillemets après Fin.
    return body.replace(/(Fin\s*\n)[^\n]*/i, `$1"${cta}"`);
  }
  const trimmed = body.trimEnd();
  if (/^Fin\b/im.test(trimmed)) {
    return trimmed.replace(/(Fin\s*\n)[^\n]*/i, `$1"${cta}"`);
  }
  return `${trimmed}\n\nFin\n"${cta}"`;
}

export type ComplianceFail = { ok: false; reasons: string[] };
export type ComplianceOk = { ok: true };
export type ComplianceResult = ComplianceOk | ComplianceFail;

/** Vérifie bannedIn + risk line sur une ad générée (après CTA normalisé). */
export function checkScriptCompliance(parts: { title: string; hook: string; body: string; alt_hooks: string[]; prep?: string }): ComplianceResult {
  const reasons: string[] = [];
  const body = parts.body ?? '';
  // Accepte apostrophe droite ou typographique, et légère variation de ponctuation.
  const riskOk =
    /Trading involves risk\.\s*Past results don['’]t guarantee future results\.?/i.test(body) ||
    body.includes(SCRIPT_RISK_LINE);
  if (!riskOk) reasons.push('missing risk line');
  // La risk line contient « guarantee » : on la retire avant bannedIn pour éviter un faux positif.
  const bodySansRisk = body
    .replace(/Trading involves risk\.\s*Past results don['’]t guarantee future results\.?/gi, ' ')
    .replace(SCRIPT_RISK_LINE, ' ');
  const blob = [parts.title, parts.hook, bodySansRisk, parts.prep ?? '', ...(parts.alt_hooks ?? [])].join('\n');
  const banned = bannedIn(blob);
  if (banned.length) reasons.push(...banned.map((w) => `banned: ${w}`));
  return reasons.length ? { ok: false, reasons } : { ok: true };
}
