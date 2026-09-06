import { createClient } from '@supabase/supabase-js'

/**
 * Server-only Supabase Storage access for the private `invoices` bucket. Uses
 * the SERVICE_ROLE key (bypasses RLS — never browser-reachable, CONVENTIONS
 * §15); env is loaded by config/load-env.ts / the vitest integration config,
 * with the well-known local defaults as fallback.
 */
export const BUCKET = 'invoices'

// Lazily created on first use so importing this module (e.g. mounting the app
// in a no-DB unit test) never needs the service-role key — createClient throws
// on an empty key, and the key is only present once env is loaded.
let cached: ReturnType<ReturnType<typeof createClient>['storage']['from']> | null = null
function storageClient(): NonNullable<typeof cached> {
  if (cached) return cached
  const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for storage access')
  cached = createClient(url, key, { auth: { persistSession: false } }).storage.from(BUCKET)
  return cached
}

/** Upload a PDF (upsert) and return its object path. */
export async function uploadInvoicePdf(path: string, bytes: Uint8Array): Promise<void> {
  const { error } = await storageClient().upload(path, bytes, {
    contentType: 'application/pdf',
    upsert: true,
  })
  if (error) throw new Error(`storage upload ${path} failed: ${error.message}`)
}

/**
 * Download a stored PDF's bytes. The audit engine reads the invoice the same way
 * a person would — from the document itself — so extraction needs the bytes, not
 * a URL: a signed URL would make the model fetch over the network from a host it
 * cannot reach, and would expire.
 */
export async function downloadInvoicePdf(path: string): Promise<Buffer> {
  const { data, error } = await storageClient().download(path)
  if (error) throw new Error(`storage download ${path} failed: ${error.message}`)
  return Buffer.from(await data.arrayBuffer())
}

/** A short-lived signed URL for a stored PDF, or null if the path is unset. */
export async function signedPdfUrl(path: string | null, expiresIn = 3600): Promise<string | null> {
  if (!path) return null
  const { data, error } = await storageClient().createSignedUrl(path, expiresIn)
  if (error) throw new Error(`sign ${path} failed: ${error.message}`)
  return data.signedUrl
}
