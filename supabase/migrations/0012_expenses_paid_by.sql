-- COMPTA · QUI A PAYÉ (01/10/2026) — Mathieu (60 %) et Benjamin (40 %) paient chacun des dépenses, et toutes
-- les recettes (commissions broker, accès directs) arrivent sur le compte de Benjamin. Pour faire les comptes
-- (« je paie 60 % de ses dépenses, il paie 40 % des miennes »), chaque dépense doit dire qui l'a réglée.
-- Colonne additive et facultative : les dépenses déjà saisies restent valides (null = payeur à préciser).
alter table public.expenses add column if not exists paid_by text check (paid_by in ('mathieu', 'benjamin'));
