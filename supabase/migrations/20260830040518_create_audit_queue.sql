-- The background-audit queue (plan T7, CONVENTIONS §22). The pgmq extension is
-- enabled in the schema migration; here we create the queue so `db reset` sets
-- it up. Local dev drains it with a long-poll worker (apps/api/src/worker.ts);
-- prod drives it with a pg_cron consumer (plan T14, per docs/pgmq-spike.md).
-- pgmq.create is idempotent — safe on re-run.
select pgmq.create('audit_jobs');
