// Thin, committed Vercel function entry (plan T14). Vercel detects functions
// from the committed `api/` tree, so this file must exist in git. All real code
// — the Hono app plus every dependency (hono, postgres, @supabase, zod) — is
// bundled into the co-located, self-contained `./_handler.js` by vercel.json's
// buildCommand (source: api-src/handler.ts). Bundling avoids the monorepo trap
// where @vercel/node leaves a cross-directory `.ts` import unresolved at runtime.
//
// Named HTTP-method exports (not a default) — Vercel's Node runtime ignores a
// Response returned from a default export; named methods are the fetch-style
// signature it honours. `_handler.js` is generated at build time and gitignored.
export { GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD } from './_handler.js'
