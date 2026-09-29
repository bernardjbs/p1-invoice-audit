-- Invoices gain a creation timestamp.
--
-- The table had no record of WHEN a row appeared, which was fine while every
-- invoice came from the seed. It stopped being fine when visitors began
-- uploading the sample invoices: the scheduled cleanup has to distinguish a
-- sample somebody is reading right now from one abandoned hours ago, and
-- without a timestamp its only option is to delete both.
--
-- `default now()` backfills every existing row to the moment of the migration.
-- That is deliberate and harmless: the cleanup only ever matches the sample
-- prefix, and no seeded invoice carries it, so a wrong creation time on seeded
-- rows cannot cause a deletion. Nothing else reads this column.
alter table public.invoices
  add column created_at timestamptz not null default now();

-- The cleanup filters on prefix and age together.
create index invoices_created_at_idx on public.invoices (created_at);
