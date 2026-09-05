-- pgvector storage for contract clauses.
-- Plan: 2026-09-04-p1-phase-b-langgraph-engine, task T2.
--
-- The three numeric checks compare figures, which SQL does. The contract-terms
-- check reads prose: the MSA says "no surcharge shall apply in respect of works
-- performed outside standard hours" and the invoice line says "weekend callout
-- loading". Same meaning, one shared word — keyword search returns nothing and
-- reads as "no relevant clause" rather than "you searched the wrong way". This
-- table stores each clause alongside its embedding so it can be found by meaning.

create extension if not exists vector;

-- One row per contract clause. `content` is the clause text the agent reads;
-- `source_ref` is what gets cited back to the user (the agent forces the citation from
-- this column, never from model output).
create table public.contract_chunks (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id) on delete cascade,
  -- Denormalised from contracts.vendor_id on purpose: every retrieval filters by
  -- vendor, and the filter is a correctness invariant (below), so it gets its own
  -- indexed column rather than a join.
  vendor_id   uuid not null references public.vendors (id),
  source_ref  text not null,
  content     text not null,
  -- 1536 = the width of text-embedding-3-small. Changing embedding model means a
  -- new migration, not a config change.
  embedding   vector(1536) not null,

  -- The seed re-runs constantly while the corpus generator is built. Without
  -- this, a second run doubles every clause, a top-4 retrieval returns four
  -- copies of ONE clause, and the agent silently misses breaches — no error, no
  -- warning. The clause loader upserts on this key. (Bernard ruling, 2026-09-05.)
  unique (contract_id, source_ref)
);

-- Vendor scoping is a CORRECTNESS invariant, not a performance filter: a clause
-- retrieved from vendor B's contract would have the agent report vendor A as
-- breaching an obligation that does not exist between us and them — plausible
-- verdict, resolvable citation, entirely false. This index serves that filter.
create index contract_chunks_vendor_id_idx on public.contract_chunks (vendor_id);

-- NO vector index (ivfflat/hnsw). The corpus is ~30 rows; vector indexes are
-- APPROXIMATE, so one would trade recall for speed on something already instant.
-- Add it when the corpus grows, with a measurement behind it.
