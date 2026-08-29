# `portfolio-starter` — TypeScript House Style & Conventions

**Your Laravel-conventions equivalent for the TS stack.** Opinionated on purpose — TS is
unopinionated by design, so this file supplies the structure Laravel gives you for free. Adopt it
as your own and apply it ruthlessly; consistency beats any single "correct" choice.

**Stack:** Bun · Hono · React 19 + Vite + TanStack Router/Query + Tailwind + shadcn · Zod ·
Supabase · Trigger.dev · Vercel AI SDK / LangChain.js.

**How to use this file:** copy it into each project as `CONVENTIONS.md`, and reference it from the
repo's `CLAUDE.md` / agent rules so your coding agents follow the same house style you do. Where a
rule is machine-enforceable, an ESLint/tsconfig note is given — prefer enforcement over discipline.

**Status:** v1.3 (2026-08-29) — **factual claims verified against vendor primary sources** (Hono, Zod,
Supabase, Vite, TanStack, react-hook-form, shadcn, React Compiler, typescript-eslint, Biome, AI SDK,
Trigger.dev). v1.3 corrected §25: the React Compiler is NO LONGER Babel-only — native Rust paths
(Bun, Vite+oxc) now exist; Babel is the fallback. Genuinely-divided points are marked **[House choice]**. v1.1 added §14–§28 from a
completeness audit + vendor-skills sweep; v1.2 corrected the drifted facts (Supabase gen-types command
& key terminology, AI SDK `telemetry`, shadcn forms API, env-core `clientPrefix`). **Before
hand-writing guidance for a vendor, check §28 — install its official skill where one exists.**

---

## 0. Laravel → TS translation (your rules, ported)

| Your Laravel rule | TS-stack equivalent | Section |
|---|---|---|
| No business logic in controllers → services | Thin Hono handler; logic in `*.service.ts` functions | §5 |
| Form Request for validation, never inline | Zod schema + `zValidator`; schema is also the type | §6 |
| Log errors, send generic message to frontend | Central Hono `onError`; shaped/generic body; log real error server-side only | §8 |
| No custom CSS, use framework utilities | Tailwind utility-first + shadcn; no bespoke CSS | §7 |
| Be DRY / reusable | Shared package, custom hooks, utils; but don't abstract before the 2nd use | §1, §7 |
| Break into components | Logic in hooks, markup in components (container/presentational is retired) | §7 |
| Domain-first naming (`dashboard-create-new-email`) | Feature-based folders — the same instinct, formalised | §1, §4 |

---

## 1. Folder structure — feature-based colocation

**Rule: organise by feature/domain, not by type-of-file.** Your `dashboard-first` naming instinct is
exactly this principle. Layer-folders (`components/`, `services/`, `hooks/` at root holding
everything) are the minority position now, kept only for tiny apps.

**Frontend app (`apps/web/src/`):**
```
app/         # routes, providers, router wiring — the composition root
components/   # SHARED ui only (shadcn lives in components/ui)
config/       # env, global config
features/     # PRIMARY organisation — one folder per domain feature
hooks/        # SHARED hooks only
lib/          # preconfigured libraries (queryClient, supabase client, ai client)
stores/       # global client state (Zustand)
types/        # cross-feature shared types ONLY
utils/
```
**Feature folder** — only the subfolders it actually needs:
```
features/invoice-audit/
  api/         # queries/mutations + fetchers for this feature
  components/
  hooks/
  stores/
  types.ts
  utils/
```

**Two rules that stop feature-folders rotting into spaghetti (enforce with ESLint):**
- **Unidirectional imports: `shared → features → app`.** A feature imports from shared; `app`
  imports from both. Never the reverse.
- **No cross-feature imports.** Feature A never imports from feature B. If two features need the same
  thing, it moves to shared. Enforce with `import/no-restricted-paths`.

**Monorepo layout** — **[House choice]** `apps/` + `packages/` (vs a flat `client/server/shared` —
both are common; this scales better):
```
apps/
  web/         # React + Vite SPA
  api/         # Hono
packages/
  shared/      # Zod schemas + inferred types, shared by web AND api
  # optionally: db/, config/, ui/
```
- Bun workspaces (or pnpm) at the root; add Turborepo when build orchestration hurts.
- Use **TypeScript project references** across packages — Hono explicitly recommends this for RPC
  type performance.
- `packages/shared` must build/export before `web` and `api` consume it (a fresh checkout builds
  shared first — a real worktree gotcha).
- Note: with Hono RPC, the API's exported `AppType` *is* the shared API contract — you may not need a
  hand-written API-types package. Keep `shared` for **Zod schemas + domain types**.

---

## 2. Where types live — tiered colocation

**Rule: put a type as close to its use as possible; promote only when genuinely shared.**
1. **Inline** in the file when used in one file.
2. **Feature-local** `types.ts` (or `x.types.ts`) when shared within a feature.
3. **Central `src/types/`** ONLY for types genuinely used across features.

**Never** start with a monolithic global `types.ts` — it becomes the unnavigable junk drawer your
naming rule exists to prevent. Use `.ts` for exported types; reserve **`.d.ts` strictly for ambient
declarations** (env vars, global augmentation), never for normal exported types.

---

## 3. `interface` vs `type` — default to `type`  **[House choice]**

Default to **`type`**; reach for `interface` only when one object type `extends` another, or when you
deliberately want declaration merging (rare — augmenting a library).

- `type` handles unions, intersections, mapped/conditional types; errors on duplicate declaration
  instead of silently merging; more predictable.
- `interface extends` is measurably faster than repeated `&` intersections (TS caches interfaces by
  name) — so use `interface` for extendable object *hierarchies*.
- This contradicts the older TS handbook ("prefer interface") — it's a chosen, mainstream stance.
  The real win is **one default, applied consistently.** No `I`-prefix (`IUser` is dead).

---

## 4. Naming conventions

| Thing | Convention | Example |
|---|---|---|
| **Files** | kebab-case **[House choice]** | `invoice-audit.service.ts`, `use-auth.ts` |
| **React components** | PascalCase identifier (required by JSX) | `InvoiceRow` |
| **Hooks** | `useCamelCase`; file kebab | `useInvoiceAudit` / `use-invoice-audit.ts` |
| **Variables/functions** | camelCase | `computeVariance` |
| **Types/interfaces** | PascalCase, no `I`-prefix | `AuditResult` |
| **Constants (module-level)** | UPPER_SNAKE_CASE | `MAX_VARIANCE_PCT` |
| **Booleans** | predicate prefix | `isLoading`, `hasError`, `canEdit`, `shouldRetry` |
| **Tests** | `*.test.ts(x)`, **colocated** next to the unit | `variance.test.ts` |

**File casing is the one genuinely-divided point** — a large minority use PascalCase for component
files (`InvoiceRow.tsx`). kebab-case is the safer default because macOS is case-insensitive (two
files differing only in case silently collide — a real hazard). Pick one and lint it; this doc picks
kebab. **Domain-first** within a name, always (`dashboard-create-email`, not `create-email-dashboard`).

---

## 5. Backend (Hono) — thin handlers, service functions

**Rule: keep handlers inline, delegate logic to plain service functions.** This is a Hono-specific
*inversion* of the usual "thin controller → move to service" advice: Hono recommends **not** building
Rails-style controller classes, because inline handlers preserve path-param and validator type
inference. You still get your Laravel separation — the *logic* lives in services; the handler is the
thin caller.

```ts
// handler stays inline (keeps inference); logic delegated
app.post('/invoices/:id/audit', zValidator('json', AuditInput), async (c) => {
  const input = c.req.valid('json')        // typed
  const result = await auditInvoice(c.req.param('id'), input)  // service fn
  return c.json(result, 200)               // explicit status — see §9
})
```

- Business logic lives in `*.service.ts` as plain, testable functions. No framework objects in them.
- If you truly need controller-like grouping, use `factory.createHandlers()` from `hono/factory` (it
  preserves inference). Don't hand-roll controller classes.
- **Structure routes as domain sub-apps:** each domain is its own `Hono()` in its own file, mounted
  via `app.route('/invoices', invoicesApp)`. **Chain** the `.route()` calls and `export type AppType
  = typeof routes` for the RPC client (§9).

---

## 6. Validation (Zod) — your Form Request, but better

**Rule: the Zod schema is the single source of truth; the type is inferred, never hand-written.**
One definition gives you runtime validation (the API boundary) *and* the compile-time type
(frontend forms + API calls). This is your Form Request equivalent — and better, because Laravel's
Request and its type are two things; here they're one.

```ts
// packages/shared — used by BOTH api and web
export const AuditInput = z.object({
  poNumber: z.string(),
  billedTotal: z.number().positive(),
})
export type AuditInput = z.infer<typeof AuditInput>
```

**Rules:**
- Schemas for anything crossing the API boundary live in `packages/shared`; feature-only schemas
  live in the feature.
- **Validate at the edge** with `zValidator` (§5). Never validate inline in handlers or services —
  the schema is the gate, exactly like a Form Request.
- **`z.infer` === `z.output`** (the type *after* transforms/defaults); the type *before* is
  `z.input`. They diverge the moment you add `.default()` or `.transform()`. **Use `z.input<>` for
  form state / request bodies you construct, `z.infer`/`z.output` for the parsed result.** Mixing
  them is the classic Zod bug (a `.default()` field is optional on input, required on output).
- **Standardise on Zod 4** across the whole monorepo (dual versions = type mismatches). Needs
  TypeScript ≥5.5 and `strict: true`.

---

## 7. Frontend (React 19 + TanStack)

**Rule 1 — separate server state from client state.** This is the single most load-bearing React
data rule.
- **TanStack Query owns *server* state** (data you borrowed from the API, not data you own).
- **Zustand owns genuine *client*/UI state.** Never mirror server data into Zustand.
- Prefer local `useState`/`useReducer` first; lift to Zustand only when cross-tree sharing demands
  it. Most apps no longer need Redux.

**Rule 2 — logic in hooks, markup in components.** Put `useQuery`/`useMutation` in feature custom
hooks (`useInvoices`) so fetching stays out of the UI but colocated with its query keys and types.
Container/presentational as a *mandated* pattern is retired — this is its modern replacement without
the ceremony.

**Rule 3 — no bespoke CSS.** Tailwind utility-first + shadcn components, exactly like your Quasar
rule. Bespoke CSS only for something utilities genuinely can't express.

**Rule 4 — break into components** when a component does two jobs or a chunk repeats. But don't
abstract before the second real use (premature DRY is its own smell).

React 19 additions (Actions, `use`, `useActionState`, `ref` as prop) reduce form-submit boilerplate —
reach for them when they simplify. **The React Compiler is now stable (v1.0) — enable it and stop
hand-writing `useMemo`/`useCallback`; see §25.**

---

## 8. Error handling — log internally, generic message out

Your Laravel rule, ported to both layers.

**Hono API:**
- **One central handler: `app.onError`.** Map errors → responses and log in one place.
- **Throw `HTTPException`** (`hono/http-exception`) for known errors with a status; `onError` catches
  the rest and returns a **generic 500 without leaking internals**. Log the real error server-side
  only — never send a stack trace to the client.
- **Typed error responses:** Hono RPC infers response types *by status code*, so set explicit
  statuses (`c.json(body, 400)`) — then the client's inferred type union includes the error shape.
  Put a shared Zod error schema in `packages/shared` so client and server agree on the error body:
  `{ error: { message, code } }`.

**React:**
- **Two tiers:** expected/local errors → render from `useQuery`'s `error`/`isError` inline;
  unexpected errors → let them hit an **Error Boundary**.
- **`throwOnError`** (v5; was `useErrorBoundary`) controls which. Set it **globally on the
  `QueryClient`** as a function `(error, query) => boolean` — send 5xx to the boundary, keep 404 as
  local state.
- Wrap boundaries with **`QueryErrorResetBoundary`** so "retry" clears the query error.
- Type the error (React Query's `error` is `Error` by default in v5); narrow at the boundary.

---

## 9. Hono RPC & the typed client

- **`hc<AppType>(baseUrl)`** gives a typed client: inputs inferred from validators, outputs from
  `c.json(..., status)`. Two rules or the types go wrong:
  - **Set explicit status codes** on every response (§8) — the response union is keyed by status.
  - **Use async/await in handlers, not promise chains** — chains break response inference.
- **Performance for a large API** (all real, all verified): precompile types with `tsc`; keep the
  **exact same Hono version** across `web` and `api`; use **TS project references**; split into
  **domain sub-apps** so you never instantiate one giant type (which slows the IDE to a crawl).

---

## 10. Agents layer (Vercel AI SDK / LangChain.js)

Conventions to keep the agentic code as disciplined as the rest (house choices — the ecosystem has
no settled standard yet):
- **One folder per agent concern:** `agents/`, `tools/`, `prompts/`. A tool is a typed unit —
  **Zod input/output schema + an `execute` fn** — colocated with its schema.
- **Prompts are data, not code strings scattered in logic** — keep them in `prompts/` (or a typed
  template module) so they're reviewable and versionable (this is the "skills as versioned artefacts"
  idea from your research, applied locally).
- **The agent runs off the HTTP path** — dispatch via the queue (portfolio: `pgmq`, §22); the handler
  just enqueues and returns. HITL "wait" lives in the *engine* (LangGraph `interrupt` / Mastra suspend),
  persisted to Postgres — never in the job queue. Pick one owner for a given pause.
- **Never trust model output at a boundary** — parse it with Zod before it touches the DB or a
  vendor call (this is your safety-gate discipline; it's also just §11's "parse, don't cast").

---

## 11. TypeScript discipline (tsconfig + language)

**tsconfig baseline** (Total TypeScript cheat sheet — verified):

Base (every project):
```jsonc
{
  "esModuleInterop": true, "skipLibCheck": true, "target": "es2022",
  "resolveJsonModule": true, "moduleDetection": "force",
  "isolatedModules": true, "verbatimModuleSyntax": true,
  "strict": true, "noUncheckedIndexedAccess": true, "noImplicitOverride": true
}
```
Bundler app (Vite): add `"module": "preserve"`, `"moduleResolution": "bundler"`, `"noEmit": true`,
`"lib": ["es2022","dom","dom.iterable"]`.
Library (`packages/shared`): add `"module": "NodeNext"`, `"outDir": "dist"`, `"declaration": true`,
`"declarationMap": true`, `"composite": true`.

- **`strict: true` is non-negotiable** (becoming default in TS 6.0). Not a house choice — law.
- **`noUncheckedIndexedAccess`** is the highest-value flag beyond `strict`: adds `undefined` to
  `arr[i]`/`obj[key]`, catching a large class of runtime bugs. Expect friction (you must narrow
  before use) — worth it. **[House choice: on]**
- **`verbatimModuleSyntax`** forces correct `import type` vs `import`. On.
- **`exactOptionalPropertyTypes`** — stricter, noisier. **[House choice: off by default]**; enable
  per-project if you want maximum rigour.

**Language discipline:**
- **No `any` — use `unknown` + narrowing** at every untrusted boundary (API responses, `JSON.parse`,
  `catch (e)`). **Parse external data with Zod**, don't cast.
- **`as const`** for literal tuples/objects and to derive unions from values:
  `const roles = ['admin','user'] as const; type Role = typeof roles[number]`.
- **Discriminated unions** for state — replaces boolean soup:
  `type State = { status:'loading' } | { status:'error'; error:Error } | { status:'success'; data:T }`.
  Pairs with `z.discriminatedUnion`.
- **Avoid `as` assertions** — treat `as` like a raw SQL cast: occasionally necessary, usually a
  smell. Prefer validation/narrowing.
- **Prefer `as const` union objects over `enum`.** No `I`-prefix on interfaces.

---

## 12. Barrel files (`index.ts` re-exports) — avoid in app code

**Rule: no barrel files in app/feature code. Import directly.** **[House choice — but the current
lean is clearly this way.]**

- Barrels weaken tree-shaking unless every module is side-effect-clean; tree-shaking **never runs in
  dev**, so you pay the full import graph in dev-server + `tsc` time and memory; they cause circular-
  dependency bugs (`Cannot access 'X' before initialization`) and slow IDE autocomplete.
- The one defensible use: a **shared package's public entry** (`packages/shared/index.ts`) where the
  barrel *is* the intended API boundary — keep it strictly side-effect-free.

---

## 13. Testing & quality (pointer — expand per project)

- **Vitest**, tests **colocated** as `*.test.ts(x)` next to the unit (not a mirror `__tests__` tree).
- Test names describe behaviour, not implementation.
- Baseline gates: ESLint (flat config) with `import/no-restricted-paths` (§1) + the type-import
  rules, Prettier, `tsc --noEmit` in CI. Prefer a gate over a guideline.
- (Your existing evidence-first discipline — mutation-proving, red-then-green, the RAGAS eval gate —
  layers on top of this.)

---

## 14. Environment & config (`@t3-oss/env` + Zod)

**Rule: one typed, validated `env` object per boundary; never touch raw `process.env` /
`import.meta.env`.**
- Vite inlines every `VITE_`-prefixed var into the **client bundle** — a mis-prefixed Supabase
  service-role key ships to the browser. Split hard: a `server` block (secrets, never `VITE_`) and a
  `client` block (only `VITE_` public values).
- `createEnv` (t3-oss) with `runtimeEnv` wired explicitly; **validate at process start** so misconfig
  fails fast, not at first use. With `@t3-oss/env-core` you supply `clientPrefix: "VITE_"` yourself
  (it's enforced at type- and runtime-level); only the Next.js wrapper hardcodes `NEXT_PUBLIC_`.
- Ban raw env access via lint (`no-restricted-syntax`); import the typed `env` everywhere.

## 15. Supabase — install the official skill, then house rules  → §28

**Rule: install the official Supabase Agent Skill; don't hand-roll Supabase guidance** (it's
first-party and self-updating — covers RLS, auth, migrations, `@supabase/ssr`, `SECURITY DEFINER`,
debugging + a Postgres-best-practices skill).
- House rules on top: **commit generated types** (`supabase gen types --lang typescript` →
  `database.types.ts` — note: `--lang typescript`, the old `gen types typescript` positional is gone),
  regenerate + drift-check in CI. **Two clients:** a browser client with the **publishable** key
  (RLS-enforced, safe as a `VITE_` public value) and a server-only client with the **secret** key
  (from the §14 *server* block ONLY — it BYPASSES RLS, never browser-reachable). *(Key terminology
  updated 2026: `publishable`/`secret` (`sb_publishable_…`/`sb_secret_…`) are current; the old
  `anon`/`service_role` names are legacy, deprecation targeted end of 2026.)* **RLS is one layer** —
  still authorise in Hono services. Use **`@supabase/ssr`** for server/browser client separation.
  Migrations: `<timestamp>_verb_subject.sql` (14-digit UTC `YYYYMMDDHHmmss` prefix, CLI-generated),
  append-only, reviewed.

## 16. TanStack Query patterns

**Rule: query keys come from per-feature factories, never inline arrays.**
- `invoiceKeys = { all:['invoices'] as const, list:(f)=>[...], detail:(id)=>[...] }`. Co-locate
  `queryOptions()` (v5) so keys + fetchers can't drift.
- **Invalidate by hierarchical key prefix** in mutation `onSettled`.
- One optimistic-update pattern: cancel → snapshot → `setQueryData` → rollback in `onError`. Query
  errors → boundary (§8); mutations handle their errors inline.

## 17. Forms (react-hook-form + Zod + shadcn)

**Rule: `useForm({ resolver: zodResolver(schema) })`; the form schema is the same Zod schema the API
validates.**
- Derive form types via `z.infer`; share the request schema client↔server, splitting with
  `.pick`/`.extend` when shapes diverge.
- **Use shadcn's form primitives** rather than hand-rolling label/error/aria. *Note (verified 2026):
  shadcn's forms docs moved from the classic `Form`/`FormField` compound API to a newer **`Field`-based**
  approach (`Field`/`FieldLabel`/`FieldError` + `<Controller>`, aria wired more manually). The classic
  `Form*` components may still ship for existing installs. Use whichever your installed version
  documents — check before relying on either.* Submit through a Query mutation (§16).

## 18. Client state (Zustand)

**Rule: selector subscriptions only** — `useStore(s => s.x)`, never the whole store (re-render storms).
- Decision rule: **server data → Query · ephemeral/local UI → `useState` · cross-tree client state →
  Zustand · static DI → Context.** Never mirror server data into Zustand. Slice pattern for big stores.

## 19. Security

**Rule: model output and user input are untrusted — sanitise and contain.**
- **Ban `dangerouslySetInnerHTML`** except through one DOMPurify wrapper (lint-enforce).
- No secrets in client code (falls out of §14). **Never log request bodies, tokens or PII** — redact
  before logging (§20). Baseline **CSP** on the Vercel deploy. Parse untrusted data with Zod, never
  cast (§11).

## 20. Logging & observability

**Rule: structured logs, one convention across API + jobs + agents; no `console.log` in prod (lint).**
- `pino` (or the platform logger) with structured fields + a **per-request correlation ID** threaded
  through services. Explicit levels. Redact PII/secrets at the logger.
- **Agents:** enable AI SDK `telemetry` (the `experimental_` prefix was dropped — it was
  `experimental_telemetry` in v3–v5; verify against your pinned SDK version) → Langfuse / OTel;
  span-name per agent/tool. Token cost + latency + tool-call traces are what you actually debug in
  production AI.

## 21. Async discipline

**Rule: no floating promises** — enable `@typescript-eslint/no-floating-promises` +
`no-misused-promises` (needs type-aware ESLint).
- Silent swallowed rejections in handlers / Trigger tasks / tool-calls are the hardest bugs to trace.
- Parallelise independent awaits with `Promise.all`; sequential only for a real data dependency.

## 22. Background jobs

**PORTFOLIO (decided 2026-08-29): use Supabase Queues (`pgmq`), NOT Trigger.dev.** The agent engine
(LangGraph/Mastra) owns durable/checkpointed/HITL execution, so the job tool only gets work off the HTTP
request — `pgmq` does that with zero extra infra (no Redis, no worker host, included in Supabase). Enqueue
`pgmq.send` → `pg_cron` reads → process (Edge Function) → `delete`/`archive`; UI polls a status row.
**Put the queue behind a seam** and **spike the pg_cron+pgmq wiring first**. `pgmq` has no built-in DLQ —
hand-roll via `read_ct`. (See portfolio `discussions.md` §8. Trigger.dev remains the client-work tool, not
the portfolio's.)

**General rule (any queue): make every side-effecting task idempotent.**
- **Idempotency key on enqueue** for anything with side effects — a paid model call double-charges on
  retry otherwise. Explicit `retry` per task (don't trust defaults blindly). One task per file,
  colocated with its feature. Wrap external calls so failures are typed, not floating (§21).

## 23. UI components (shadcn — install the official skill/MCP) + accessibility  → §28

**Rule: install the shadcn skill + registry MCP; `cn()` for all conditional classes; CVA for variants.**
- `components/ui/*` are **your source** — edited deliberately and rarely (regeneration is manual);
  feature components live with their feature (§1).
- **a11y:** `eslint-plugin-jsx-a11y`; a label on every input (shadcn `Form` handles it, §17); keep
  Radix's focus management; meet contrast on the Tailwind palette.

## 24. Date / time

**Rule: store & transport UTC (ISO-8601); convert only at display edges with an explicit IANA zone**
(`Australia/Perth`).
- Library: **date-fns (+ date-fns-tz) or Luxon** today; **Temporal** (via `temporal-polyfill`) is Stage
  4 and the clear future — reassess dropping the polyfill once Safari/JSC ships. Never rely on the
  host's local zone implicitly.

## 25. Performance & the React Compiler

**Rule: enable the React Compiler (stable v1.0, Oct 2025) and STOP hand-writing
`useMemo`/`useCallback`/`memo` by default.**
- **Enable it NATIVELY — Babel is no longer required** (the compiler was ported to Rust). On **Bun**:
  `bun build --react-compiler` / `Bun.build({ reactCompiler: true })` (fully native, zero Babel). On
  **Vite**: `@vitejs/plugin-react@6.1+` with `react({ compiler: true })` + `oxc-transform-react`
  (native oxc pass; flagged `@experimental` as of Aug 2026). Use `@vitejs/plugin-react` (oxc-based),
  NOT `@vitejs/plugin-react-swc` (no documented compiler support).
- The old `babel-plugin-react-compiler` (now wired via `@rolldown/plugin-babel`) is the **conservative
  stable fallback** only — not the default. *(Verified 2026-08-29; supersedes react.dev's Oct-2025
  "Babel-only" release table.)*
- Keep manual memoisation only for: referential-identity deps of external libs (charts/canvas; older
  TanStack Table needs `"use no memo"`), `try/catch` bodies the compiler skips, or a proven hotspot —
  each with a one-line *why* comment.
- **Code-split at TanStack Router route boundaries** (lazy routes + Suspense).

## 26. Error modelling — expected vs exceptional  **[House choice]**

**Rule: throw for exceptional/unexpected** (caught by Hono `onError`, §8); **model expected domain
outcomes as discriminated-union return types** from services (§11).
- Don't mandate `neverthrow` — adopt only if you want enforced exhaustiveness and accept the
  ergonomic cost. Document the *boundary*, not the library. (Genuinely divided — hence a house choice.)

## 27. Tooling & enforcement

- **Lint/format:** ESLint flat config + typescript-eslint (type-aware) + `eslint-plugin-react-hooks`
  (incl. the Compiler rule) + `@tanstack/eslint-plugin-query` + `jsx-a11y`; **Biome or Prettier for
  formatting.** (Biome v2 now does type-aware linting, but lacks the stack-specific plugins — so
  ESLint stays primary. **[House choice]**)
- **Boundaries:** encode §1's unidirectional-import + no-cross-feature + no-barrel rules in
  `dependency-cruiser` (or `eslint-plugin-boundaries`), run in CI — turns prose into an enforced gate.
- **Monorepo:** Bun `workspace:*` deps; shared packages export TS source where possible (no build
  step) or `tsup` when needed; a shared `tsconfig` base extended per app; Turborepo when build times
  bite. (Fresh checkout builds `shared` first — the unbuilt-`dist` worktree trap.)

## 28. Official vendor tooling — install the skills, feed the rest as `llms.txt`

Your stack is well-covered by first-party AI tooling. Wire these into each project's agent setup so
your coding agents follow vendor-current best practice (verified 2026-08-28).

**Official Agent Skills / MCP — install these:**
| Vendor | Install |
|---|---|
| Supabase | `claude plugin marketplace add supabase/agent-skills` (skill + Postgres best-practices) |
| Vercel / AI SDK | `npx skills add vercel-labs/agent-skills` · plugin `vercel@claude-plugins-official` · MCP `mcp.vercel.com` |
| shadcn/ui | `pnpm dlx skills add shadcn/ui` · MCP `pnpm dlx shadcn@latest mcp init --client claude` |
| TanStack | `npx @tanstack/intent@latest install` (Skills via Intent) |
| Anthropic | `/plugin marketplace add anthropics/skills` |

**Docs-for-LLMs only (`llms.txt` — feed to agents / doc-researcher, no skill):** React
(`react.dev/llms.txt`), Vite (`vite.dev/llms.txt`), Zod (`zod.dev/llms.txt`), Hono
(`hono.dev/llms-full.txt`), Bun (`bun.com/llms.txt`), LangGraph
(`langchain-ai.github.io/langgraphjs/llms.txt`) + `mcpdoc`.

**No verified first-party tooling (use docs / community, verify before trusting):** Tailwind,
react-hook-form, Zustand.

## 29. Runtime & deploy (Bun local / Node prod)  — verified 2026-08-29

**Rule: develop, install and test with Bun locally; deploy the Hono API to the Node runtime on Vercel
(stable default). Hono runs identically on both.**
- Bun as package manager / build tool on Vercel is **stable/GA** (auto-detected from `bun.lock`). The
  Vite/React frontend is a static build — no runtime question.
- Vercel *does* now offer a **Bun function runtime** (`"bunVersion"` in `vercel.json`) — but it's
  **Public Beta** (since Oct 2025). Keep production on **Node** (GA); the Bun runtime is not where a
  portfolio's prod tier belongs yet. (Want Bun in prod properly → self-host a container, e.g. Fly.io/
  Railway/`oven/bun` image — off Vercel's function model.)
- **Because dev (Bun) ≠ prod (Node), run the CI integration/e2e tier on Node** to catch runtime
  divergence. Unit tier on Bun is fine. Sharp edges: `node:http`/`node:https` internals, `node:crypto`
  (missing key types/ciphers), `node:async_hooks`/`AsyncLocalStorage` (partial — matters for Hono
  request-context middleware).

## LOW-priority (pointers, deliberately not full sections)
- **Comments:** "why, not what"; TSDoc only on exported *package* APIs.
- **Dependencies:** pin; Renovate; prefer existing/stdlib over new deps.
- **Git/commit conventions:** live in `CONTRIBUTING.md`, not here — cross-reference.

---

## Divided points (so you know what's law vs stance)

Genuinely a matter of taste — the doc picks one, you may differ: `type` vs `interface` default (§3);
file casing (§4); monorepo `apps+packages` vs flat (§1); `exactOptionalPropertyTypes` (§11); barrels
at a *library* entry (§12); `neverthrow` vs discriminated-union returns (§26); Biome vs ESLint-primary
(§27).

**Clear consensus (not taste):** feature-based structure, no cross-feature imports, `strict` mode,
Zod-first inference, server/client state separation, `unknown` over `any`, discriminated unions,
Hono inline-handlers + RPC, no bespoke CSS.
