# pgmq + pg_cron spike — proven wiring

Verified working against a throwaway Supabase project on 2026-08-29. This is P1's recipe for the
background-audit queue (CONVENTIONS §22): the engine (Postgres) owns durability — no Redis, no worker
host. Enqueue → `pg_cron` reads → process → delete; the UI polls a status row.

## Connection (local)

Use the **Session pooler** connection string (IPv4). The **direct** host
(`db.<ref>.supabase.co`) is **IPv6-only** and does not resolve on IPv4-only networks — it fails with
`could not translate host name`. Get the pooler URI from the dashboard: **Connect → Direct/Connection
string → switch the selector to Session pooler**. Shape:

```
postgresql://postgres.<project-ref>:<db-password>@aws-<n>-<region>.pooler.supabase.com:5432/postgres
```

Keep it in `.env.local` (gitignored) as `DATABASE_URL`. Run SQL with `psql "$DATABASE_URL" -f ...`.

## The wiring (idempotent — safe to re-run)

```sql
-- 1. Extensions (queue + scheduler).
create extension if not exists pgmq;
create extension if not exists pg_cron;

-- 2. The queue.
select pgmq.create('audit_jobs');

-- 3. Where the consumer records processed jobs (the "status row" the UI would poll).
create table if not exists public.spike_results (
  id           bigint generated always as identity primary key,
  msg_id       bigint,
  message      jsonb,
  processed_at timestamptz not null default now()
);

-- 4. Consumer: every 10s, pop() one message (atomic read+delete) and record it.
--    Re-arm safely by unscheduling any prior job of the same name first.
select cron.unschedule('audit-consumer')
where exists (select 1 from cron.job where jobname = 'audit-consumer');

select cron.schedule('audit-consumer', '10 seconds', $job$
  insert into public.spike_results (msg_id, message)
  select msg_id, message from pgmq.pop('audit_jobs');
$job$);

-- 5. Enqueue a job.
select pgmq.send('audit_jobs', '{"invoice_id": 42, "check": "math"}'::jsonb);
```

## Verify (read back via SQL — not the dashboard)

```sql
select id, msg_id, message, processed_at from public.spike_results;  -- the processed row
select count(*) from pgmq.q_audit_jobs;                              -- 0 after pop
```

Observed: one `spike_results` row with the enqueued payload and a `processed_at` timestamp; queue
depth 0. Round-trip confirmed.

## Notes for P1

- **`pg_cron` sub-minute interval**: Supabase accepts `'10 seconds'` (not just cron syntax). P1's
  real cadence is a design choice; 10s is fine for a demo.
- **`pgmq.pop` = read + delete atomically**, ideal for a single-consumer happy path. For
  concurrency/retries P1 should use `pgmq.read(queue, vt, qty)` + explicit `pgmq.delete`/`archive`.
- **No built-in dead-letter queue.** Hand-roll via the `read_ct` (read count) on each message — route
  to a DLQ after N failed reads. Tracked as an Outstanding item for P1's queue-seam task.
- **Put the queue behind one seam** (§22) so the engine can be swapped without touching call sites.
- **Cleanup**: `select cron.unschedule('audit-consumer');` stops the scheduled job.
