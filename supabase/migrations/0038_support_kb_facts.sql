-- 0038 : faits du support (audit du 28/10/2026). À APPLIQUER À LA MAIN APRÈS MERGE (via MCP), pas avant.
-- Pourquoi :
--   · le knowledge disait « l'or et les cryptos » et la mémoire « Or et crypto … on ne peut pas couper le BTC » :
--     Algoria ne trade que l'or depuis la semaine du 19/10 ; le bot a encore dit « gold and crypto » le 27/10 ;
--   · le mot de passe trader a été décrit « read-only » à un membre (21/10) : il ne l'est pas ;
--   · aucun lien Myfxbook dans le knowledge, alors que c'est le track record vérifié de la nouvelle version.
-- Sûreté : on sauvegarde d'abord le contenu actuel dans agent_doc_versions (restaurable depuis l'admin, onglet
-- Brain), puis on remplace des passages EXACTS par replace() ; si un passage a déjà été modifié à la main, il est
-- laissé tel quel et un NOTICE le signale. Aucun DROP, aucune suppression. Rejouable sans doublon de section.

begin;

insert into public.agent_doc_versions (key, content, created_at, created_by)
select key, content, now(), 'sauvegarde avant 0038'
from public.agent_docs where key in ('knowledge', 'memory');

do $do$
declare
  k text;
  m text;
begin
  select content into k from public.agent_docs where key = 'knowledge';
  select content into m from public.agent_docs where key = 'memory';

  if position($kb$Elle trade l'or et les cryptos.$kb$ in k) = 0 then raise notice '0038 : knowledge, phrase or+cryptos introuvable (laissée)'; end if;
  k := replace(k, $kb$Elle trade l'or et les cryptos.$kb$, $kb$Elle trade uniquement l'or (XAU/USD), rien d'autre (plus de crypto depuis la semaine du 19/10/2026).$kb$);

  if position($kb$- Crypto : ce n'est pas de l'intraday, une position peut rester ouverte plusieurs jours (toujours avec son stop loss). Un membre connecté un mardi ne voit pas sur son compte le profit d'un trade crypto fermé le jeudi s'il avait été ouvert avant son arrivée : il n'était pas encore copié.$kb$ || chr(10) in k) = 0 then raise notice '0038 : knowledge, puce Crypto introuvable (laissée)'; end if;
  k := replace(k, $kb$- Crypto : ce n'est pas de l'intraday, une position peut rester ouverte plusieurs jours (toujours avec son stop loss). Un membre connecté un mardi ne voit pas sur son compte le profit d'un trade crypto fermé le jeudi s'il avait été ouvert avant son arrivée : il n'était pas encore copié.$kb$ || chr(10), '');

  if position($kb$- Le mot de passe demandé (mot de passe trader) sert uniquement à brancher le compte au copieur d'Algoria. Il permet de copier les trades ; il ne donne aucun accès à l'espace client du broker, aux dépôts ni aux retraits.$kb$ in k) = 0 then raise notice '0038 : knowledge, puce mot de passe introuvable (laissée)'; end if;
  k := replace(k, $kb$- Le mot de passe demandé (mot de passe trader) sert uniquement à brancher le compte au copieur d'Algoria. Il permet de copier les trades ; il ne donne aucun accès à l'espace client du broker, aux dépôts ni aux retraits.$kb$, $kb$- Le mot de passe demandé (mot de passe trader) n'est PAS en lecture seule (c'est le mot de passe investisseur qui l'est). Formulation à donner au membre : « It lets the copier place trades on your account. It gives no access to your broker client area, deposits or withdrawals. Enter it only in the app, never send it here. » On ne demande JAMAIS un mot de passe ni un token dans le chat, et on n'en accepte jamais : s'il en envoie un, on lui dit de le saisir seulement dans l'app.$kb$);

  if position('myfxbook.com/members/AlgoriaAI' in k) = 0 then
    k := rtrim(k, chr(10)) || $kb$

## Track record vérifié (nouvelle version, depuis le 26/10/2026)
- Le track record vérifié de la nouvelle version, depuis le 26/10/2026, est sur Myfxbook : https://www.myfxbook.com/members/AlgoriaAI/algoria-ai/12279938 . Toujours suivi de « Past results don't guarantee future results. »
- Ce compte n'est pas tout l'historique : ne jamais le présenter comme l'historique complet, ne jamais citer un nombre de trades, de jours ou de gains (petit échantillon).
- On n'évoque jamais l'incident de soi-même. Question directe sur des pertes, une phrase : « Yes, the previous engine had an incident on 21–22 October. The engine has been fully rebuilt since, and here's its verified record on Myfxbook. »
- Ne jamais nier, ne jamais dire que ça ne peut pas se reproduire, ne jamais promettre le track record « plus tard ».$kb$;
  end if;

  if position($kb$- Or et crypto : l'IA trade les deux 24/7, l'or est fermé le week-end donc seulement la crypto ; on ne peut pas couper le BTC, seulement mettre toute la copie en pause (à retirer quand Algoria passera à l'or seul).$kb$ in m) = 0 then raise notice '0038 : memory, ligne Or et crypto introuvable (laissée)'; end if;
  m := replace(m, $kb$- Or et crypto : l'IA trade les deux 24/7, l'or est fermé le week-end donc seulement la crypto ; on ne peut pas couper le BTC, seulement mettre toute la copie en pause (à retirer quand Algoria passera à l'or seul).$kb$, $kb$- Or seul : l'IA ne trade que l'or (XAU/USD) depuis la semaine du 19/10/2026, plus de crypto ni de BTC. Le week-end, l'or est fermé : pas de trade.$kb$);

  update public.agent_docs set content = k, updated_at = now(), updated_by = 'migration 0038' where key = 'knowledge' and content is distinct from k;
  update public.agent_docs set content = m, updated_at = now(), updated_by = 'migration 0038' where key = 'memory' and content is distinct from m;
end
$do$;

insert into public.agent_doc_versions (key, content, created_at, created_by)
select key, content, now(), 'migration 0038'
from public.agent_docs where key in ('knowledge', 'memory') and updated_by = 'migration 0038' and updated_at = now();

commit;
