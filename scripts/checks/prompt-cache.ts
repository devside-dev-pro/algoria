// Contrôle local, pas le runtime. Depuis la racine du dépôt :
//   npx tsx scripts/checks/prompt-cache.ts
//
// 05/11/2026, le cache du prompt du support et de l'assistant. Octobre : 22,67 $ d'écritures en cache pour 0,99 $ de
// lectures, parce que le track record (recalculé à chaque trade clôturé), le webinaire et les leçons étaient au milieu
// du prompt. Ce contrôle vérifie que le SOCLE mis en cache ne bouge pas quand ces données bougent, qu'elles arrivent
// bien au modèle (dernier bloc, hors cache), et que le texte complet vu par les garde-fous n'a rien perdu.
// Aucun appel Anthropic, aucune base.
import { MORE_FACTS_HEADER, buildAssistantSystem, buildDraftSystem, systemParam } from '../../lib/member/replyDraft';

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'ok ' : 'KO '} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
}

const NOW = Date.parse('2026-11-05T12:00:00Z');
const KNOWLEDGE = 'Algoria trade uniquement l\'or. Connaissance de test.';
const TRACK_A = 'REAL PAST RESULTS of the account Algoria trades (test A):\n- November (month to date): +1.2%';
const TRACK_B = 'REAL PAST RESULTS of the account Algoria trades (test B):\n- November (month to date): +3.4%';
const WEBINAR = 'NEXT WEBINAR (test): Thursday 6 November, 7 pm UK.';
const MEMORY_1 = '- leçon de test numéro un';
const MEMORY_2 = '- leçon de test numéro un\n- leçon de test numéro deux';

for (const policyCase of [
  { label: 'résultats ouverts (membre live)', status: 'live', historyMaintenance: false },
  { label: 'résultats retenus (prospect, historique en maintenance)', status: null, historyMaintenance: true },
]) {
  const base = { biz: true, locale: 'en', knowledge: KNOWLEDGE, webinar: WEBINAR, status: policyCase.status, now: NOW, historyMaintenance: policyCase.historyMaintenance };
  const a = buildDraftSystem({ ...base, memory: MEMORY_1, trackNow: TRACK_A });
  const b = buildDraftSystem({ ...base, memory: MEMORY_1, trackNow: TRACK_B });
  const c = buildDraftSystem({ ...base, memory: MEMORY_2, trackNow: TRACK_A });
  const L = policyCase.label;

  check(`support, ${L} : trois blocs (socle, leçons, faits qui bougent)`, a.blocks.length === 3, `${a.blocks.length} blocs`);
  check(`support, ${L} : socle et leçons en cache, le dernier bloc hors cache`, a.blocks[0].cache && a.blocks[1].cache && !a.blocks[2].cache);
  check(`support, ${L} : le socle ne change pas quand le track record change`, a.blocks[0].text === b.blocks[0].text && a.blocks[1].text === b.blocks[1].text);
  check(`support, ${L} : le socle ne change pas quand une leçon s'ajoute`, a.blocks[0].text === c.blocks[0].text);
  check(`support, ${L} : une nouvelle leçon change seulement le bloc des leçons`, a.blocks[1].text !== c.blocks[1].text && c.blocks[1].text.includes('numéro deux'));
  check(`support, ${L} : le socle garde le knowledge`, a.blocks[0].text.includes(KNOWLEDGE));
  check(`support, ${L} : ni track record, ni webinaire, ni leçon dans le socle`, !a.blocks[0].text.includes('test A') && !a.blocks[0].text.includes(WEBINAR) && !a.blocks[0].text.includes('numéro un'));
  check(`support, ${L} : le webinaire arrive au modèle, dans le dernier bloc`, a.blocks[2].text.startsWith(MORE_FACTS_HEADER) && a.blocks[2].text.includes(WEBINAR));
  check(`support, ${L} : le texte complet (vu par les garde-fous) contient tout`, a.system.includes(KNOWLEDGE) && a.system.includes(WEBINAR) && a.system.includes('numéro un'));
  if (policyCase.historyMaintenance) {
    check(`support, ${L} : les vrais chiffres ne passent pas (note de maintenance à la place)`, !a.system.includes('test A'));
  } else {
    check(`support, ${L} : le track record arrive au modèle, dans le dernier bloc`, a.blocks[2].text.includes('test A') && b.blocks[2].text.includes('test B'));
  }
}

// Le bot (pas le compte Business) : même découpage.
{
  const bot = buildDraftSystem({ biz: false, locale: 'en', knowledge: KNOWLEDGE, memory: MEMORY_1, trackNow: TRACK_A, webinar: WEBINAR, status: 'live', now: NOW, historyMaintenance: false });
  check('bot : socle sans track record ni leçon', !bot.blocks[0].text.includes('test A') && !bot.blocks[0].text.includes('numéro un'));
  check('bot : track record dans le dernier bloc, hors cache', bot.blocks[bot.blocks.length - 1].text.includes('test A') && !bot.blocks[bot.blocks.length - 1].cache);
}

// L'assistant de l'app : jamais de leçons (décision du 02/11), socle stable, chiffres après.
{
  const base = { locale: 'en', knowledge: KNOWLEDGE, webinar: WEBINAR, status: 'live', now: NOW, historyMaintenance: false };
  const a = buildAssistantSystem({ ...base, trackNow: TRACK_A });
  const b = buildAssistantSystem({ ...base, trackNow: TRACK_B });
  check('assistant : deux blocs (socle, faits qui bougent), aucune leçon', a.blocks.length === 2 && !a.system.includes('LESSONS FROM'));
  check('assistant : le socle ne change pas quand le track record change', a.blocks[0].text === b.blocks[0].text);
  check('assistant : track record et webinaire dans le dernier bloc, hors cache', a.blocks[1].text.includes('test A') && a.blocks[1].text.includes(WEBINAR) && !a.blocks[1].cache);
  check('assistant : la consigne sur l\'incident renvoie aux MORE FACTS', a.system.includes('incident context in MORE FACTS'));
}

// Le format envoyé à l'API : cache d'1 h sur les blocs stables, rien sur le dernier.
{
  const p = systemParam(buildDraftSystem({ biz: true, locale: 'en', knowledge: KNOWLEDGE, memory: MEMORY_1, trackNow: TRACK_A, webinar: WEBINAR, status: 'live', now: NOW, historyMaintenance: false }).blocks);
  check('API : cache_control 1 h sur le socle et les leçons', p[0].cache_control?.ttl === '1h' && p[1].cache_control?.ttl === '1h');
  check('API : pas de cache_control sur le dernier bloc', !('cache_control' in p[2]));
  check('API : au plus 4 points de cache (limite de l\'API)', p.filter((x) => 'cache_control' in x).length <= 4);
}

// Sans leçons ni chiffres : un seul bloc, en cache.
{
  const solo = buildDraftSystem({ biz: true, locale: 'en', knowledge: KNOWLEDGE, memory: null, trackNow: null, webinar: null, status: 'live', now: NOW, historyMaintenance: false });
  check('sans leçons ni chiffres : un seul bloc, en cache', solo.blocks.length === 1 && solo.blocks[0].cache);
}

console.log(failed ? `\n${failed} contrôle(s) en échec` : '\ntous les contrôles passent');
process.exit(failed ? 1 : 0);
