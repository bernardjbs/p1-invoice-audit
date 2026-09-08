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
- `review-flow.spec.ts`: an uploaded invoice lands paused_review, and approving
  it clears the queue. Not `@swap`: the all-pass stub can't pause anything, so
  verdict assertions live here, not in the swap run. It passes under the mock and
  under `langgraph` for different reasons; the mock reads an invoice with no line
  rows, the real engine reads the fixture PDF, whose printed total deliberately
  does not match subtotal + GST. **Neither cause is what the assertion depends
  on**: the uploaded invoice has no purchase order either, which pauses it on its
  own. Read `fixtures/README.md` on what these four check cards do and do not
  prove before changing anything there.

## The real engine

```
AUDIT_ENGINE=langgraph doppler run -c dev -- bun run e2e
```

The same two specs, untouched, against the LangGraph engine. It downloads the
uploaded PDF from Storage and a vision model reads it, so the verdicts come from
the fixture's own printed numbers rather than the upload form's.

## CI

Three jobs in `.github/workflows/ci.yml`:

| Job             | When                                      | Engine    |
| --------------- | ----------------------------------------- | --------- |
| `build`         | every PR, and every push to `main`        | none      |
| `e2e-mock`      | every PR, and every push to `main`        | mock      |
| `langgraph-e2e` | pushes to `main`, and `workflow_dispatch` | langgraph |

`on.push.branches` is `[main]`, so a push to any other branch triggers nothing;
work on a branch is covered once it opens a pull request.

Both e2e jobs start the real Supabase CLI stack on the runner
(`.github/scripts/start-supabase.sh`), because `global-setup.ts` resets the DB
and the seed uploads PDFs to Storage. Both are `needs: build`, so a lint or type
error fails before any container starts. The engine split is deliberate: a
non-deterministic model must never be able to redden a pull request that changed
no code.
