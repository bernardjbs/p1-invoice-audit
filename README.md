# Invoice Audit — an agentic procurement auditor

Upload a supplier invoice as a PDF. The system reads it, checks it against the purchase order, the
agreed rate card and the contract's own wording, and either clears it or pauses it for a human with
evidence attached.

Built as the first of three implementations of the same application on different agent engines
(LangGraph.js → Mastra → Laravel AI), so the engines can be compared honestly on identical
requirements.

**Live:** https://p1-invoice-audit.sinfat.com

<!-- deployed-engine: langgraph -->

> **What is actually deployed:** all of it. The real LangGraph engine has run on the deployed URL
> since 2026-09-23 — an uploaded invoice is read from its PDF by a vision model, checked four ways,
> cited against the contract clause it breached, paused for a human and cleared on approval. The
> post-deploy check asserts the engine **by name**, so it fails if the deployment is ever quietly
> serving the mock again. That assertion is not decoration: it was written because the first deploy
> attempt would have done exactly that, and every other probe passed.
>
> This README says which parts are live and which are local, because a portfolio that overstates
> itself is worse than one that ships less.

---

## The problem

Procurement fraud and billing errors hide in the gap between three documents: the invoice, the
purchase order, and the contract. Checking that gap by hand doesn't scale, and most of it isn't
judgement — it's arithmetic nobody has time for.

But not all of it. A contract clause saying _"no call-out fee for out-of-hours work without prior
written approval"_ cannot be checked by any sum. Someone has to read it.

That split is the architecture.

## The four checks

| Check              | Kind                | Source of truth                    |
| ------------------ | ------------------- | ---------------------------------- |
| Arithmetic         | deterministic       | the invoice's own lines and totals |
| PO match           | deterministic       | the purchase order in the database |
| Price vs contract  | deterministic       | the agreed rate card               |
| **Contract terms** | **LLM + retrieval** | **the contract's prose**           |

Three are plain functions. Only the fourth needs a model, and it gets one. Giving all four to an
agent would be costlier, flakier, and harder to defend in review.

## How the fourth check works

```
invoice fields ──► build a query from what is CHARGED
                        │
                        ▼
              pgvector similarity search, scoped to this vendor
                        │
                        ▼
              four nearest clauses ──► prompt ──► Claude ──► verdict
                        │                                      │
                        └──────── the citation ◄───────────────┘
                          resolved by INDEX against our own rows
```

**The model never writes the citation.** It picks a clause by its position in the list it was shown,
and the database supplies the reference. A model asked for a clause number will occasionally invent a
plausible one, and a fabricated citation attached to a confident verdict is indistinguishable from a
real one to whoever reads the audit.

Two independent layers enforce this: the response schema has no field for a reference at all, and an
index outside the list shown is an error rather than a fallback.

## Measuring the AI instead of trusting it

Deterministic tests can't judge a model's output — you can't assert on prose without pinning it to
one phrasing. So the extraction step is **scored**, not asserted:

```
$ doppler run -c dev -- bun evals/extraction/run.ts

scoring 22 invoices against the default model…
per-field accuracy
  field                correct/total   accuracy
  description            32/33      97.0%
  invoiceNumber          22/22     100.0%
  abn                    22/22     100.0%
  subtotalAud            22/22     100.0%
  ...
overall  99.6% over 275 field comparisons (threshold  90.0%)
PASS
```

The gate exits non-zero below the threshold, so reading quality cannot silently regress. The labels
are free because the data is synthetic: the seed writes the invoice rows, the PDFs are rendered _from_
those rows, and the answer key is derived from the rows again — the model only ever sees the rendered
page.

Haiku 4.5 scored 1.0000 on the original twenty invoices, so the cheaper model stayed. The single
imperfect field today is the description of a deliberately adversarial invoice, which the model
declines to transcribe verbatim — left as measured rather than tuned away.

## Evidence discipline

Every guard in this repo has been observed failing before it was trusted. A check that has only ever
been green is indistinguishable from a check that cannot fail.

That discipline produced one result worth stating plainly: the **prompt-injection fencing could not be
proved to matter**. Stripped out entirely, with an escalated payload that mimics the prompt's own
closing instruction, six runs across two model tiers — every one still flagged the malicious invoice.
The fencing is kept because it is free, but the containment that actually bounds the damage is
architectural: the citation comes from the database, the deterministic checks cannot be moved by any
text on an invoice, and the model reports rather than acts.

## Stack

**Runtime** Bun locally, Node on Vercel · **API** Hono · **Frontend** React 19, Vite, TanStack
Router/Query, Tailwind, shadcn · **Data** Supabase Postgres + pgvector, Supabase Storage ·
**Queue** `pgmq` + `pg_cron` (the engine owns durability, so no Redis and no worker host) ·
**Agent** LangGraph.js + Claude · **Validation** Zod at every boundary.

## Running it

Requires Docker, Bun, and **Node 22** (enforced by the pre-push hook — under Node 20 both test tiers
fail without naming the environment as the cause). Secrets come from Doppler; there is no `.env` file.

```bash
bun install
bunx supabase start
doppler run -c dev -- bun run seed                        # rows → PDFs → embeddings → answer keys

doppler run -c dev -- bun run --filter '@starter/api' dev     # API
bun run --filter '@starter/web' dev                            # frontend
doppler run -c dev -- bun run --filter '@starter/api' worker  # queue worker
```

## Gates

```bash
bun run lint          # ESLint + Prettier + a plan-citation ratchet
bun run typecheck
bun run test          # unit tier, no environment needed
bun run build

doppler run -c dev -- bun run test:integration   # needs the local database
doppler run -c dev -- bun evals/extraction/run.ts
```

Three tiers: the fast tier on every push, the full tier on CI, a smoke against the live URL after
deploy. CI runs the fast tier, the build and the mock browser suite on every push, and on `main`
adds the real-engine browser suite, the integration tier against a real database, and the paid eval
grading.

## Repository

```
apps/api          Hono API, the audit engine, the seam it lives behind
apps/web          React frontend
evals/extraction  the oracle gate that scores the model
e2e               Playwright specs, engine-agnostic by design
supabase          migrations
```

The audit engine sits behind one function. Swapping LangGraph for another engine changes that file
and nothing else — which is the point of building the same app three times.

## Status

Phase A and Phase B are both shipped and deployed. Phase B is complete: extraction with its
eval gate, the deterministic checks, the retrieval seam, the contract corpus, the RAG agent, and
injection containment are wired into one LangGraph state graph behind the seam, and that engine is
what the live URL runs.

Since then the real engine has passed the Phase A acceptance suite **unchanged** — the seam's whole
point, proved by not editing a test to make it green — and the audit has become durable: it suspends
itself when an invoice needs a person, saves its state to Postgres, and is finished later by a
different process. That last part is proved by killing the worker mid-pause and resuming from a
fresh one.

Every audit run is now traced to LangSmith with the trace linked from the invoice detail view, and an
invoice pausing for review posts a Slack notification (best-effort — a Slack outage can never fail an
audit).

The quality gate is built and green. A fixed 20-row dataset is generated from real audit runs; three
of its measures are exact comparisons against the planted answer key rather than model judgements,
and the written explanations are marked by a model against a rubric kept in the repo. The gate runs
in continuous integration in two halves — the free comparisons on every push, the paid marking on
`main` only — and it refuses to run at all if the recording it grades is older than the engine that
produced it.

The marker itself was calibrated against five summaries of known quality before any of its numbers
were trusted, and it failed two of the five: it could not distinguish a deliberately vague answer
from a good one, and it scored a correct pass explanation zero. Both are recorded in the repo along
with what changed as a result.

That gate has already paid for itself twice. On its first run it found the engine ruling on contract
breaches without having been shown the deciding clause: retrieval returned the four closest clauses
where each contract holds eight, and the clause that decided the case ranked fifth on three of five
faulty invoices. Fixed by sending the whole contract when it fits rather than by picking a larger
number, which cleared all three misses and a false breach on a clean invoice.

Then it found that the engine's summaries for clean invoices were no better than saying nothing — a
deliberately vacuous summary scored the same as the real one, because the prompt asked what
_concerned_ the model and a clean invoice concerns it not at all, so it hedged. Giving the pass case
its own instruction moved the measured score from 0.562 to 0.688 and turned the gate from failing to
passing.

The audit engine is also published over MCP, the standard protocol AI clients use to discover and
call tools. Three of them: list the invoices, read an invoice's latest audit, queue a new one. Each is
a one-line wrapper around a function the app already had, and that is the point rather than a
shortcut — if it had needed real work it would have meant the audit logic was tangled into the web
API with no clean boundary to expose. Every tool declares whether it reads or writes, and the server
speaks over standard input and output rather than over a network, so there is no URL and the only
caller is a process you launched yourself.

Continuous integration runs the gates, both browser suites, the quality gate and an integration
tier, and they pass. The integration tier is the newest and carries the two proofs
nothing else covers: that a paused audit survives its worker being killed, and that a run records a
real trace.

**The engine is live.** The deployed URL runs LangGraph, and a post-deploy check proves it by
asserting the engine by name, the clause citation, the recorded trace and the approval clearing the
invoice.

---

_Synthetic data throughout — invented vendors, invented ABNs, fabricated contracts. No real
procurement data, and none of it is anyone's production system._
