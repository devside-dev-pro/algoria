-- Narration Claude : nouveau niveau d'event 'ai' (le terminal ALGORIA "parle").
alter table public.events drop constraint if exists events_level_check;
alter table public.events add constraint events_level_check
  check (level in ('scan','info','signal','order','veto','ai'));
