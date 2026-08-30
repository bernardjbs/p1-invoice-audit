-- P1 invoice-audit schema (plan T2). All money is numeric(12,2), currency implicit
-- AUD; all timestamps timestamptz. No RLS/auth in v1 (locked decision) — the app
-- reaches these tables only through the Hono API using the service_role key.

-- Extensions: the background-audit queue (pgmq) and its scheduler (pg_cron).
-- The queue itself and the cron consumer are wired in T7 (see docs/pgmq-spike.md);
-- here we only enable the extensions. pgvector is deliberately NOT enabled (Phase B).
create extension if not exists pgmq;
create extension if not exists pg_cron;

-- Vendors (suppliers). ABN is a synthetic 11-char checksum-valid value (T3).
create table public.vendors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  abn         char(11),
  is_approved boolean not null default true
);

-- Contracts / MSAs held with a vendor.
create table public.contracts (
  id         uuid primary key default gen_random_uuid(),
  vendor_id  uuid not null references public.vendors (id) on delete cascade,
  title      text not null,
  msa_ref    text,
  starts_on  date,
  ends_on    date
);

-- Agreed rate card lines under a contract (the price_vs_contract source of truth).
create table public.contract_rates (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id) on delete cascade,
  item_code   text not null,
  description text,
  unit        text,
  rate_aud    numeric(12, 2) not null
);

-- Purchase orders raised against a vendor.
create table public.purchase_orders (
  id         uuid primary key default gen_random_uuid(),
  po_number  text not null unique,
  vendor_id  uuid not null references public.vendors (id) on delete cascade,
  status     text,
  total_aud  numeric(12, 2)
);

-- Line items on a purchase order.
create table public.po_lines (
  id              uuid primary key default gen_random_uuid(),
  po_id           uuid not null references public.purchase_orders (id) on delete cascade,
  item_code       text,
  qty             numeric(12, 2),
  unit_price_aud  numeric(12, 2)
);

-- Invoices — the thing being audited. status drives the review workflow.
create table public.invoices (
  id             uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  vendor_id      uuid not null references public.vendors (id) on delete cascade,
  po_id          uuid references public.purchase_orders (id) on delete set null,
  contract_id    uuid references public.contracts (id) on delete set null,
  invoice_date   date,
  due_date       date,
  subtotal_aud   numeric(12, 2),
  gst_aud        numeric(12, 2),
  total_aud      numeric(12, 2),
  status         text not null default 'received'
                 check (status in ('received', 'auditing', 'passed', 'flagged',
                                    'paused_review', 'approved', 'rejected')),
  pdf_path       text
);

-- Invoice line items.
create table public.invoice_lines (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid not null references public.invoices (id) on delete cascade,
  item_code       text,
  description     text,
  qty             numeric(12, 2),
  unit_price_aud  numeric(12, 2),
  line_total_aud  numeric(12, 2)
);

-- One audit run per (invoice, engine) execution.
create table public.audit_runs (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.invoices (id) on delete cascade,
  engine       text not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  overall      text check (overall in ('pass', 'flag', 'fail')),
  variance_pct numeric(12, 4)
);

-- The four check results of an audit run (one row per check type).
create table public.check_results (
  id            uuid primary key default gen_random_uuid(),
  audit_run_id  uuid not null references public.audit_runs (id) on delete cascade,
  check_type    text check (check_type in ('math', 'price_vs_contract', 'po_match', 'contract_terms')),
  verdict       text check (verdict in ('pass', 'flag', 'fail')),
  evidence      jsonb
);

-- Human review decision on a paused invoice (HITL, status-flag flavour).
create table public.review_decisions (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.invoices (id) on delete cascade,
  audit_run_id uuid references public.audit_runs (id) on delete set null,
  decision     text check (decision in ('approved', 'rejected')),
  note         text,
  decided_at   timestamptz not null default now()
);

-- Helpful lookup indexes on the foreign keys the API filters/join on most.
create index on public.contracts (vendor_id);
create index on public.contract_rates (contract_id);
create index on public.purchase_orders (vendor_id);
create index on public.po_lines (po_id);
create index on public.invoices (vendor_id);
create index on public.invoices (status);
create index on public.invoice_lines (invoice_id);
create index on public.audit_runs (invoice_id);
create index on public.check_results (audit_run_id);
create index on public.review_decisions (invoice_id);

-- Private storage bucket for generated invoice PDFs (T4 writes into it).
insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;
