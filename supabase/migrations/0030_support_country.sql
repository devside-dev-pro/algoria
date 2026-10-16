-- 🌍 LE PAYS DANS LE TUNNEL DU SUPPORT (16/10/2026, Mathieu : « dès le début je lui demandais d'où il venait, et selon
-- le pays je lui faisais un vocal personnalisé… et pour les statistiques »). Voir lib/member/supportAuto.ts.
-- 1. Les vocaux par pays : support_assets kind='country_voice', countries = codes ISO ('GB', 'ZA'…, 'XX' = autres pays).
alter table public.support_assets add column if not exists countries text[] not null default '{}';

-- 2. Le tableau par pays : contacts (conversations sur son compte support) → app → broker choisi → en copie.
-- Le pays d'une personne : celui qu'elle a DIT (biz_msg.detail.country, code ISO), sinon celui de sa fiche (saisi au
-- passage en copie), sinon le pays de connexion à l'app (source 'geo:xx', un proxy : VPN possible).
create or replace function public.support_country_stats(since timestamptz default '2026-09-29')
returns table (country text, contacts bigint, app bigint, broker bigint, live bigint)
language sql stable as $$
  with names(name, code) as (values
    ('uk','GB'),('united kingdom','GB'),('england','GB'),('south africa','ZA'),('new zealand','NZ'),('australia','AU'),
    ('uae','AE'),('united arab emirates','AE'),('netherlands','NL'),('germany','DE'),('italy','IT'),('malta','MT'),
    ('portugal','PT'),('belgium','BE'),('israel','IL'),('tunisia','TN'),('luxembourg','LU'),('france','FR'),
    ('usa','US'),('united states','US'),('spain','ES'),('austria','AT'),('philippines','PH'),('ireland','IE'),
    ('nigeria','NG'),('switzerland','CH'),('canada','CA'),('india','IN'),('malaysia','MY'),('kenya','KE'),
    ('ghana','GH'),('zimbabwe','ZW'),('botswana','BW'),('namibia','NA'),('poland','PL'),('sweden','SE'),
    ('denmark','DK'),('norway','NO'),('cyprus','CY'),('greece','GR'),('singapore','SG')
  ),
  contacts as (
    select tg_id,
      (array_agg(upper(detail->>'country') order by created_at desc) filter (where detail->>'country' ~ '^[A-Za-z]{2}$'))[1] as said
    from public.member_actions
    where kind = 'biz_msg' and detail->>'from' = 'client' and created_at >= since
    group by tg_id
  )
  select coalesce(c.said, n.code, case when m.source like 'geo:%' then upper(split_part(m.source, ':', 2)) end, '??') as country,
    count(*) as contacts,
    count(m.tg_id) as app,
    count(m.broker) as broker,
    count(*) filter (where m.status in ('live', 'paused')) as live
  from contacts c
  left join public.members m on m.tg_id = c.tg_id
  left join names n on n.name = lower(trim(m.country))
  group by 1
  order by 2 desc;
$$;
