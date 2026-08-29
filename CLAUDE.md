# portfolio-starter

The wired TypeScript foundation every TS portfolio project clones. Not an app — it is the proven
ground (conventions, toolchain, gates, queue seam) that P1 (LangGraph.js) and P2 (Mastra) are built
on top of. P3 (Laravel) does not use this starter.

## House style — read this first

@CONVENTIONS.md

`CONVENTIONS.md` is the binding TypeScript house style (ts-conventions v1.3). Follow it; where a rule
is machine-enforceable (ESLint/tsconfig), enforcement wins over discipline.

## Scripts (the four gates)

Every project exposes these four, run with Bun locally:

- `bun run lint` — ESLint + Prettier check.
- `bun run typecheck` — `tsc --noEmit`, strict.
- `bun run test` — Vitest.
- `bun run build` — web bundle + api typecheck.

Gate tiers (per `docs/development-workflow.md` in the build home): pre-push runs the fast tier
(lint + typecheck + test); CI runs the full tier on Node; post-deploy runs a smoke.

## Runtime — Bun local / Node prod (§29)

Develop, install and test with **Bun** locally. Deploy the Hono API to the **Node** runtime on Vercel
(stable/GA). Hono runs identically on both. Because dev (Bun) ≠ prod (Node), the CI integration/e2e
tier runs on **Node** to catch runtime divergence; the unit tier on Bun is fine.

## Background jobs — the pgmq seam (§22)

Background work (the audit job) runs via **Supabase Queues (`pgmq`)**, NOT Trigger.dev. The engine
owns durability: `pgmq.send` → `pg_cron` reads → process (Edge Function) → `delete`/`archive`; the UI
polls a status row. **Put the queue behind one seam** so the engine can be swapped, and **spike the
`pg_cron` + `pgmq` wiring before building on it**. `pgmq` has no built-in DLQ — hand-roll via
`read_ct`. (Trigger.dev remains the client-work tool, not this portfolio's engine.)
