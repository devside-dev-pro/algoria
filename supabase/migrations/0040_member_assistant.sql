-- 🤖 L'ASSISTANT DE L'APP (02/11/2026) — voir lib/member/assistant.ts et app/api/member/assistant/route.ts.
-- Trois tables et deux fonctions :
--   · assistant_conversations : une conversation par membre (la plus récente est reprise) ;
--   · assistant_messages : chaque question et chaque réponse, avec le modèle, les tokens (entrée, cache lu/écrit,
--     sortie), l'empreinte du prompt et du knowledge, le garde-fou qui a refusé (issue), le 2e essai, le secours ;
--   · assistant_quota : le compteur du jour (jour UTC, remise à zéro à 00:00 UTC) ;
--   · assistant_take_credit : prend un crédit de façon atomique (10/membre/jour + plafond global du jour) ;
--   · assistant_refund_credit : le rend quand le modèle échoue ou qu'un garde-fou bloque.
-- ADDITIVE SEULEMENT : rien de supprimé, rien de réécrit. RLS activée sans politique : clé de service seulement
-- (comme les autres tables membres). Le code fonctionne sans cette migration (l'assistant répond 503).
-- À APPLIQUER AVANT LA FUSION, hors live.
create table if not exists assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  tg_id bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists assistant_conversations_tg_idx on assistant_conversations (tg_id, updated_at desc);

create table if not exists assistant_messages (
  id bigserial primary key,
  conversation_id uuid not null references assistant_conversations(id),
  tg_id bigint not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  model text,
  input_tokens integer,
  cache_read_tokens integer,
  cache_write_tokens integer,
  output_tokens integer,
  prompt_hash text,
  knowledge_hash text,
  issue text,
  retried boolean,
  fallback boolean,
  created_at timestamptz not null default now()
);
create index if not exists assistant_messages_conv_idx on assistant_messages (conversation_id, created_at desc);
create index if not exists assistant_messages_day_idx on assistant_messages (created_at);

create table if not exists assistant_quota (
  tg_id bigint not null,
  day date not null,
  used integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tg_id, day)
);
create index if not exists assistant_quota_day_idx on assistant_quota (day);

alter table assistant_conversations enable row level security;
alter table assistant_messages enable row level security;
alter table assistant_quota enable row level security;

-- Prend un crédit. Verrou par jour (advisory xact lock) pour que le plafond global tienne sous la charge.
create or replace function assistant_take_credit(p_tg_id bigint, p_limit integer, p_global_cap integer)
returns table (ok boolean, used integer, reason text)
language plpgsql security definer set search_path = public as $$
declare
  d date := (now() at time zone 'utc')::date;
  mine integer;
  total integer;
begin
  perform pg_advisory_xact_lock(hashtext('assistant_quota:' || d::text));
  select coalesce(sum(q.used), 0) into total from assistant_quota q where q.day = d;
  select q.used into mine from assistant_quota q where q.tg_id = p_tg_id and q.day = d;
  mine := coalesce(mine, 0);
  if mine >= p_limit then return query select false, mine, 'limit'::text; return; end if;
  if total >= p_global_cap then return query select false, mine, 'global_cap'::text; return; end if;
  insert into assistant_quota as q (tg_id, day, used) values (p_tg_id, d, 1)
    on conflict (tg_id, day) do update set used = q.used + 1, updated_at = now()
    returning q.used into mine;
  return query select true, mine, null::text;
end $$;

create or replace function assistant_refund_credit(p_tg_id bigint)
returns void
language sql security definer set search_path = public as $$
  update assistant_quota set used = greatest(used - 1, 0), updated_at = now()
   where tg_id = p_tg_id and day = (now() at time zone 'utc')::date;
$$;

revoke all on function assistant_take_credit(bigint, integer, integer) from public, anon, authenticated;
revoke all on function assistant_refund_credit(bigint) from public, anon, authenticated;
