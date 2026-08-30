# E2E acceptance suite (plan T13)

Playwright specs that exercise the full local stack — API (:3000), web (:5173),
and a background audit worker — proving the golden-success criteria in a real
browser.

## Prerequisites

- Docker running and local Supabase up: `bunx supabase start`.
- Node 22 (nvm) on PATH; Chromium installed: `bunx playwright install chromium`.

## Run

```
bun run e2e        # full suite, mock engine (criteria 4 + 5)
bun run e2e:stub   # engine-swap proof: @swap specs only, AUDIT_ENGINE=stub (criterion 7)
```

`playwright.config.ts` (repo root) handles everything else: `global-setup.ts`
resets+seeds the DB and starts the worker (with the AUDIT_ENGINE under test);
the API and web dev servers are started as Playwright `webServer`s.

## Specs

- `audit-flow.spec.ts` **@swap** — upload → audit runs via the queue → four
  check cards render. Engine-agnostic (asserts pipeline, not verdicts), so it
  runs under both the mock and the all-pass stub.
- `review-flow.spec.ts` — mock-only: an uploaded invoice fails the arithmetic
  check, lands paused_review, and approving it clears the queue. The all-pass
  stub can't pause anything, so verdict assertions live here, not in the swap run.

## CI

The suite needs Docker + Supabase + three processes, so it runs as the local
pre-push / acceptance tier, not in the GitHub CI job (which keeps the unit +
integration tiers as its floor). See the plan T13 notes.
