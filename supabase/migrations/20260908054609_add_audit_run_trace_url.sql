-- The LangSmith trace for an audit run, so the detail view can link to what the
-- engine actually did. Nullable and additive on purpose: every run persisted
-- before this, every mock-engine run, and every run made with tracing off has
-- no trace, and none of them should be rewritten to pretend otherwise.
alter table public.audit_runs add column trace_url text;
