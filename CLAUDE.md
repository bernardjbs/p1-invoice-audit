# p1-invoice-audit

The **P1 invoice/procurement-audit app** — the first portfolio build, cloned from `portfolio-starter`.
Phase A ships the full application shell (database, synthetic AU seed, invoice PDFs, Hono API,
pgmq-driven audit worker, React frontend, deploy) with the audit engine **mocked behind a single
`auditInvoice()` seam**; Phase B drops the real LangGraph.js engine into that seam. All the
conventions, toolchain, gates and queue seam below are inherited from the starter and still binding.

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

## Vendor agent skills (§28)

Three delivery mechanisms are in use; a fresh clone must restore two of them:

| Mechanism | Vendors | Tracked in | Restore after clone |
|---|---|---|---|
| `skills` CLI (project-level files) | Vercel/AI SDK (9), shadcn (`shadcn`, `migrate-radix-to-base`) | `skills-lock.json` | `bunx skills experimental_install` |
| Claude Code plugins (project-scoped) | Supabase, `postgres-best-practices`, `claude-api` | `.claude/settings.json` | re-add marketplaces (below), then they load |
| TanStack Intent (on-demand) | TanStack Router/Query | `AGENTS.md` | nothing — agent runs `bunx @tanstack/intent load` per task |

**Fresh-clone setup** (marketplaces are user-level, so they don't travel with the repo):

```
claude plugin marketplace add supabase/agent-skills
claude plugin marketplace add anthropics/skills
bunx skills experimental_install     # rebuilds .agents/skills/ (both .agents/ and .claude/skills/ are gitignored)
# Re-link the .agents/skills into .claude/skills so Claude Code's native picker sees them
# (the symlinks are gitignored + hand-made, so they do NOT travel with the clone and
#  `skills experimental_install` does NOT create them — this loop is required):
mkdir -p .claude/skills
for d in .agents/skills/*/; do n=$(basename "$d"); ln -sfn "../../.agents/skills/$n" ".claude/skills/$n"; done
git config core.hooksPath .githooks   # enable the pre-push fast-gate hook (per-clone)
# Then RESTART the session in this repo's cwd so the enabled plugins (supabase,
# postgres-best-practices, claude-api) and the re-linked skills load into the picker.
```

Anthropic marketplace is registered but only `claude-api` is enabled — the other four plugins
(document-skills, example-skills, academy-guide, discernment-nudge) are deliberately not installed.

**Docs-for-LLMs (`llms.txt`) are NOT skills** — React, Vite, Zod, Hono, Bun, LangGraph (§28 second
table) are fed to agents via the `doc-researcher` subagent, not installed here.

## Background jobs — the pgmq seam (§22)

Background work (the audit job) runs via **Supabase Queues (`pgmq`)**, NOT Trigger.dev. The engine
owns durability: `pgmq.send` → `pg_cron` reads → process (Edge Function) → `delete`/`archive`; the UI
polls a status row. **Put the queue behind one seam** so the engine can be swapped, and **spike the
`pg_cron` + `pgmq` wiring before building on it**. `pgmq` has no built-in DLQ — hand-roll via
`read_ct`. (Trigger.dev remains the client-work tool, not this portfolio's engine.)
