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

- `bun run lint` — ESLint + `prettier --check` + the plan-citation ratchet. (Prettier was wired in
  2026-09-06; before that this line claimed a check that nothing ran, and 49 files had drifted.
  `.prettierignore` keeps it off generated trees.)
- `bun run typecheck` — `tsc --noEmit`, strict.
- `bun run test` — Vitest.
- `bun run build` — web bundle + api typecheck.

Gate tiers (per `docs/development-workflow.md` in the build home): pre-push runs the fast tier
(lint + typecheck + test); CI runs the full tier on Node; post-deploy runs a smoke.

`bun run lint` also runs `scripts/check-plan-citations.sh` — see "Citing a plan from code" in
`CONVENTIONS.md`. It is a ratchet: new bare `Tn` references fail, the grandfathered ones are
baselined, and the allowance can only shrink. The script prints the current count; do not trust a
number written in prose here or anywhere else.

**Adding any file under `apps/api/src/audit/` forces an eval-dataset rebuild.** The freshness gate
watches that folder and cannot tell a presentation helper from a prompt change, so it refuses the
build until the dataset is rebuilt and re-graded — deliberately blunt, because a gate clever enough
to judge which files matter is a gate that will eventually judge wrong. The rebuild is cheap
(content-addressed cache; 18 of 19 judge calls hit on 2026-09-23), but it is not free and it is not
optional.

**⚠️ Node 22 is required for ANY gate, test tier, push or build.**

The repo now declares it (`.nvmrc` = `22`, `engines.node` = `>=22`) and the **pre-push hook enforces
it**: on an older node it exits 1 naming the version and the cause, instead of letting the tiers fail
misleadingly. Proved both ways 2026-09-06 — node 20 → exit 1, node 22 → exit 0.

- **In an interactive shell:** `nvm use` (reads `.nvmrc`). Bernard's nvm default is already 22, so
  usually nothing to do — check with `node -v` before assuming you need anything.
- **In a non-interactive shell** (an agent's `Bash` calls, CI steps, anything that does not source
  your shell profile): nvm is not loaded, so `node` resolves to 20. Export it explicitly:

  ```
  export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
  ```

Why this earns the space — under node 20 both test tiers fail and **neither failure names the
environment as the cause**:

- **Unit tier:** `apps/web/.../check-results.test.tsx` fails to _start_ (`ERR_REQUIRE_ESM` in the
  jsdom chain) and the run reports "3 files passed / 1 error" — reads as almost-green.
- **Integration tier:** three specs fail because `@supabase/supabase-js` needs Node 22's native
  WebSocket; it surfaces as **HTTP 500 from the API**, which reads as broken application code.

Verified 2026-09-05 by stashing the session's changes and reproducing identically, so it is
environmental and pre-existing, not a regression.

## Runtime — Bun local / Node prod (§29)

Develop, install and test with **Bun** locally. Deploy the Hono API to the **Node** runtime on Vercel
(stable/GA). Hono runs identically on both.

Dev (Bun) ≠ prod (Node), so something must exercise Node before users do — and here that is the
**post-deploy smoke**, not a test tier (ruled 2026-09-23). Prod does not run this TypeScript: `bun
build` squashes the API into one ESM file that Vercel executes on Node, so the smoke against the live
URL is the only check that touches the artefact that ships. Running the e2e suite under Node would
exercise source-on-Node, which exists nowhere — and cannot work as written anyway, since 155
extensionless relative imports need a bundler-style resolver Node does not have.

Every CI tier therefore runs on **Bun**, deliberately; the two e2e jobs carry no `setup-node` and a
comment saying why. The `build` job keeps Node 22 because the jsdom unit tier genuinely needs it (see
the Node 22 warning above).

## Secrets — Doppler (no `.env.local`)

Secrets live in **Doppler**, not on disk. Project `p1-invoice-audit`, configs **`dev`** (local
Supabase values) and **`prd`** (deploy creds: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`).
`.env.local` is **deleted** — do not recreate it.

- **Run everything through Doppler:** `doppler run -- <cmd>` (dev servers, `bun run seed`, `worker`,
  `test:integration`, `e2e`). It injects secrets as env vars; children inherit them.
- The dir is already bound (`doppler setup`, stored in global `~/.doppler` — nothing in the repo).
  Fresh clone / new machine: `doppler login` then `doppler setup -p p1-invoice-audit -c dev`.
- Code still best-effort-loads `.env.local` if present (harmless fallback), but Doppler is the source.
- Why: keeps secrets out of the agent's context/transcript, and sidesteps `.env`-file `$`-expansion
  bugs (Doppler injects directly). Prod → Vercel env via the Doppler↔Vercel dashboard integration.

## Vendor agent skills (§28)

Three delivery mechanisms are in use; a fresh clone must restore two of them:

| Mechanism                            | Vendors                                                       | Tracked in              | Restore after clone                                        |
| ------------------------------------ | ------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------- |
| `skills` CLI (project-level files)   | Vercel/AI SDK (9), shadcn (`shadcn`, `migrate-radix-to-base`) | `skills-lock.json`      | `bunx skills experimental_install`                         |
| Claude Code plugins (project-scoped) | Supabase, `postgres-best-practices`, `claude-api`             | `.claude/settings.json` | re-add marketplaces (below), then they load                |
| TanStack Intent (on-demand)          | TanStack Router/Query                                         | `AGENTS.md`             | nothing — agent runs `bunx @tanstack/intent load` per task |

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
