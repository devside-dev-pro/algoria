-- ── LES 40 QU'ON PERD CHAQUE JOUR (17/09/2026) ────────────────────────────────────────────────────────
-- Mathieu reçoit plus de 50 messages par jour sur son compte personnel. Une dizaine crée un compte sur
-- l'app : ceux-là, le système les connaît et le bot sait les relancer. Les 40 autres n'existent NULLE PART
-- — ils ont parlé à un humain, pas à un produit. Il les relançait de tête, 48 h après un message lu sans
-- réponse, et il ne suit plus la cadence. Ce ne sont pas des curieux : ce sont des gens qui ont écrit.
--
-- CE QUE CETTE TABLE N'EST PAS : un moyen d'écrire à leur place. L'envoi automatisé depuis un compte
-- personnel est interdit par Telegram et ferait courir un risque au compte @mathieu_algoria, qui EST
-- l'identité commerciale (il est écrit dans l'app, dans le bot, sur la landing, dans chaque refus).
-- Ici on ne stocke que la MÉMOIRE : qui, quand, et quand relancer. L'envoi reste manuel.
--
-- COMMENT UNE LIGNE NAÎT : Mathieu TRANSFÈRE le message de la personne au bot Algoria. Un transfert porte
-- l'identité de l'expéditeur — un geste, zéro saisie. C'est la seule capture tenable à 50 messages/jour.
create table if not exists dm_leads (
  id uuid primary key default gen_random_uuid(),
  -- null quand la vie privée du contact masque l'expéditeur d'un transfert : on garde alors le nom seul.
  -- Ça reste utile (savoir qui relancer), ça empêche juste de recouper avec un compte app.
  tg_id bigint,
  handle text,
  display_name text,
  locale text,
  -- extrait du message transféré : sans ça, « relancer Ahmed » ne dit pas de QUOI on parlait.
  first_message text,
  -- waiting = à relancer · relanced = relancé, en attente · converted = a créé son compte · dropped = abandonné
  status text not null default 'waiting',
  relance_count integer not null default 0,
  next_relance_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- la requête de l'écran RELANCES : « qui est dû, le plus ancien d'abord »
create index if not exists dm_leads_due_idx on dm_leads (status, next_relance_at);
-- retransférer la même personne ne crée pas un doublon — il en arrive plusieurs par jour, parfois deux fois
create unique index if not exists dm_leads_tg_id_key on dm_leads (tg_id) where tg_id is not null;

-- RLS activée : aucune lecture anonyme. L'app passe par la clé service (qui la contourne), donc rien
-- d'autre à déclarer — ces lignes contiennent des noms et des extraits de conversations privées.
alter table dm_leads enable row level security;
