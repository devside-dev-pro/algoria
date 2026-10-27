// Contrôle local, pas le runtime, pas la CI. Depuis la racine du dépôt :
//   npx tsx scripts/checks/live-keyword.ts
//
// Le mot LIVE (inscription à la prochaine session) contre le mot WEBINAR (pack, inchangé). Aucun appel
// Anthropic, aucune base. Le garde-fou du canal est le vrai `check` de lib/channel/writer.ts.
import { readFileSync } from 'node:fs';
import { webinarPost } from '../../lib/channel/cm';
import { check as guard } from '../../lib/channel/writer';
import { WEBINAR_WORD } from '../../lib/member/supportAuto';
import {
  isChannelSource, isLiveKeyword, LIVE_DM_LINE, liveSeatReply, parseWebinarStart, seatLink, ukDay, ukHour,
} from '../../lib/member/webinar';

let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`ok  ${name}`);
    return;
  }
  failed++;
  console.error(`ECHEC  ${name}${detail ? ` — ${detail}` : ''}`);
}

const SESSION = { id: '2026-10-28', starts_at: '2026-10-28T18:00:00.000Z', zoom_url: 'https://zoom.us/j/secret' };

// ── le mot seul ──────────────────────────────────────────────────────────────
{
  for (const ok of ['LIVE', 'live', 'Live', '  LIVE  ', 'LIVE!', 'LIVE.', 'LIVE?', 'LIVE!!', 'LIVE 🙏', 'LIVE 🙌🏻', 'live!🙏', 'LIVE\n']) {
    check(`matche « ${ok.replace(/\n/g, '\\n')} »`, isLiveKeyword(ok));
  }
  for (const no of ['is it live?', 'live account', 'LIVE session', 'going live', 'webinar', 'WEBINAR', 'alive', 'liv', '', 'LIVE please', 'LIVE\nplease', 'is the webinar live']) {
    check(`ne matche pas « ${no.replace(/\n/g, '\\n')} »`, !isLiveKeyword(no));
  }
}

// ── WEBINAR inchangé ─────────────────────────────────────────────────────────
{
  const src = readFileSync(new URL('../../lib/member/supportAuto.ts', import.meta.url), 'utf8');
  check('WEBINAR_WORD inchangé', src.includes('export const WEBINAR_WORD = /\\bwebina(?:rs?|ire)\\b/i;'));
  check('WEBINAR matche webinar / webinars / webinaire', ['webinar', 'WEBINARS', 'le webinaire'].every((t) => WEBINAR_WORD.test(t)));
  check('WEBINAR ne matche pas LIVE', !WEBINAR_WORD.test('LIVE') && !WEBINAR_WORD.test('live!'));
  const wb = readFileSync(new URL('../../lib/member/webinar.ts', import.meta.url), 'utf8');
  check('repli id inconnu → prochaine session toujours là', wb.includes('if (!s || Date.parse(s.starts_at) < now - LATE_JOIN_MS) s = (await upcomingSessions(db, 1))[0];'));
  check('aucun temperature ajouté sur ce chemin', !wb.includes('temperature') && !readFileSync(new URL('../../lib/channel/cm.ts', import.meta.url), 'utf8').includes('temperature'));
}

// ── /start wb_<id>-ch ────────────────────────────────────────────────────────
{
  const plain = parseWebinarStart('/start wb_2026-10-28');
  check('wb_ simple', plain?.sessionId === '2026-10-28' && plain.via === null);
  const ch = parseWebinarStart('/start wb_2026-10-28-ch');
  check('suffixe -ch retiré', ch?.sessionId === '2026-10-28' && ch.via === 'channel');
  const upper = parseWebinarStart('/START WB_2026-10-28-CH');
  check('suffixe -CH insensible à la casse', upper?.sessionId === '2026-10-28' && upper.via === 'channel');
  const unknown = parseWebinarStart('/start wb_not-a-real-one');
  check('id inconnu parsé tel quel (le repli peut jouer)', unknown?.sessionId === 'not-a-real-one' && unknown.via === null);
  const unknownCh = parseWebinarStart('/start wb_not-a-real-one-ch');
  check('id inconnu + -ch : le suffixe ne reste pas dans l’id', unknownCh?.sessionId === 'not-a-real-one' && unknownCh.via === 'channel');
  check('trop court → null', parseWebinarStart('/start wb_ab') === null);
  check('pas un /start → null', parseWebinarStart('LIVE') === null && parseWebinarStart('/start lg_abcdefghijklmnop') === null);
  check('seatLink canal', seatLink('2026-10-28', 'channel').endsWith('?start=wb_2026-10-28-ch'));
  check('seatLink sans canal', seatLink('2026-10-28').endsWith('?start=wb_2026-10-28') && !seatLink('2026-10-28').endsWith('-ch'));
  check('source channel', isChannelSource('channel') && isChannelSource('Channel') && isChannelSource('channel:uk'));
  check('autre source', !isChannelSource('meta') && !isChannelSource('channels') && !isChannelSource(''));
}

// ── réponse Business : heure réelle, bouton START, jamais Zoom ──────────────
{
  const seat = liveSeatReply(SESSION);
  check('heure et jour via les helpers', seat.text.includes(ukDay(SESSION.starts_at)) && seat.text.includes(ukHour(SESSION.starts_at)) && seat.text.includes('UK'));
  check('bouton START vers le bot, sans -ch', seat.button.text === 'START' && seat.button.url === seatLink(SESSION.id));
  check('pas de lien Zoom dans la réponse', !/zoom\.us/i.test(seat.text) && !/zoom\.us/i.test(seat.button.url));
  check('demande d’appuyer sur START', /START/.test(seat.text) && /1 hour before/.test(seat.text));
}

// ── annonces du canal : une ligne, un bouton, garde-fous ────────────────────
{
  const cta = { tokens: {}, maxChars: 700 };
  const line = guard(LIVE_DM_LINE, cta);
  check('la ligne LIVE passe le garde-fou', line.ok === true, line.ok ? '' : line.why);
  const earned = guard(`${LIVE_DM_LINE}\n\nYou will earn $500.`, cta);
  check('promesse de gain toujours refusée', earned.ok === false);
  const loss = guard(`${LIVE_DM_LINE}\n\nWe had a loss.`, cta);
  check('mot négatif toujours refusé', loss.ok === false);
  const money = guard(`${LIVE_DM_LINE}\n\nMinimum deposit $200.`, cta);
  check('argent à mettre toujours refusé', money.ok === false);
  for (const phase of ['soon', 'tomorrow', 'today'] as const) {
    const p = webinarPost(SESSION, phase);
    const buttons = [p.btn, p.url].filter(Boolean);
    check(`${phase} contient la ligne`, p.text.includes(LIVE_DM_LINE) && p.text.split(LIVE_DM_LINE).length === 2);
    check(`${phase} un seul bouton, vers la page`, buttons.length === 2 && p.url === 'https://getalgoria.com/webinar?src=channel' && !/https?:\/\//.test(p.text));
    check(`${phase} le brief demande LIVE et un seul bouton`, /@mathieu_algoria/.test(p.goal) && /\bLIVE\b/.test(p.goal) && /one button only/i.test(p.goal));
    const g = guard(p.text, cta);
    check(`${phase} le texte de banque passe le garde-fou`, g.ok === true, g.ok ? '' : g.why);
  }
  const last = webinarPost(SESSION, 'last');
  check('dernier appel sans la ligne LIVE', !last.text.includes(LIVE_DM_LINE) && !/\bDM\b/.test(last.text));
  check('dernier appel un seul bouton, mesurable', last.btn.length > 0 && last.url === seatLink(SESSION.id, 'channel') && !/https?:\/\//.test(last.text));
  const cm = readFileSync(new URL('../../lib/channel/cm.ts', import.meta.url), 'utf8');
  check('le contexte du rédacteur mentionne le DM LIVE', cm.includes('DM @mathieu_algoria the single word LIVE'));
}

if (failed) {
  console.error(`\n${failed} contrôle(s) en échec`);
  process.exit(1);
}
console.log('\ntous les contrôles passent');
