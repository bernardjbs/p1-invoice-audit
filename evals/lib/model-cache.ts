import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { InvoiceReader } from '../../apps/api/src/audit/extraction'

/**
 * An on-disk cache for model replies, for the eval harnesses only.
 *
 * The problem it solves: every eval run re-read all twenty-odd invoice PDFs
 * through a vision model, so tuning a threshold — which means running the same
 * evaluation repeatedly against unchanged inputs — paid the full bill each time.
 * Nothing about the answer had changed; only our question about it had.
 *
 * The key is the CONTENT, never an identifier: the PDF's bytes, the prompt, and
 * the model id. That is what makes the cache safe to trust. Reword the prompt,
 * change the model, or regenerate a PDF and the key changes with it, so a stale
 * answer cannot survive a change that should have invalidated it. An
 * invoice-id key would look equivalent and would quietly serve last week's
 * reading of a document that has since been rebuilt.
 *
 * Deliberately NOT used by the application. Production must read the invoice in
 * front of it.
 */

/**
 * Overridable so a test can point at a scratch directory. A test writing into
 * the real cache could serve a fabricated reply to a later eval run, which would
 * look like a model answer rather than a test artefact.
 */
function cacheDir(): string {
  return process.env.EVAL_CACHE_DIR ?? resolve(import.meta.dirname, '../.cache/model-replies')
}

function keyFor(parts: string[]): string {
  const hash = createHash('sha256')
  for (const part of parts) {
    // Length-prefixed so that concatenating different parts cannot collide:
    // ["ab","c"] and ["a","bc"] must not hash the same.
    hash.update(String(part.length)).update(':').update(part)
  }
  return hash.digest('hex')
}

export type CacheStats = { hits: number; misses: number }

/**
 * Any model call shaped as two strings in, one string out. Both the invoice
 * reader (document, prompt) and the clause judge (system, prompt) fit, so one
 * cache serves both rather than two near-identical ones drifting apart.
 */
export type TextCall = (first: string, second: string) => Promise<string>

export type CacheOptions = {
  /** `--no-cache` sets this false for an honest full-price run. */
  enabled?: boolean
  /** Counters the caller prints, so a run always says how much it re-paid for. */
  stats?: CacheStats
}

/**
 * Wrap a reader so identical (pdf, prompt, model) triples are read once.
 *
 * When disabled it still COUNTS. An earlier version returned the inner reader
 * untouched, which left the counters at zero, so the honest full-price run
 * reported "no model reads" — the one run where every read was paid for. A
 * spend report that reads as "nothing was spent" precisely when the most was
 * spent is worse than no report at all.
 */
export function cachingCall(inner: TextCall, model: string, opts: CacheOptions = {}): TextCall {
  if (opts.enabled === false) {
    return async (first, second) => {
      if (opts.stats) opts.stats.misses += 1
      return inner(first, second)
    }
  }
  return async (first, second) => {
    const path = join(cacheDir(), `${keyFor([model, first, second])}.json`)
    try {
      const hit = JSON.parse(await readFile(path, 'utf8')) as { reply: string }
      if (opts.stats) opts.stats.hits += 1
      return hit.reply
    } catch {
      // Any failure to read a cache entry — absent, truncated, unparseable — is
      // a miss. A cache must never be able to fail the thing it accelerates.
    }
    const reply = await inner(first, second)
    if (opts.stats) opts.stats.misses += 1
    try {
      await mkdir(dirname(path), { recursive: true })
      // `model` and a prompt excerpt are stored purely so a human can tell what
      // an entry is; only the key decides what is served.
      await writeFile(
        path,
        JSON.stringify({ model, promptExcerpt: second.slice(0, 120), reply }, null, 2),
      )
    } catch (err) {
      console.warn(`[cache] could not write ${path}:`, err)
    }
    return reply
  }
}

/** The invoice reader, cached. Named for its caller so the eval reads plainly. */
export function cachingReader(
  inner: InvoiceReader,
  model: string,
  opts: CacheOptions = {},
): InvoiceReader {
  return cachingCall(inner, model, opts)
}

/** The clause judge, cached. Same machinery, different caller. */
export function cachingJudge(inner: TextCall, model: string, opts: CacheOptions = {}): TextCall {
  return cachingCall(inner, model, opts)
}

export function newStats(): CacheStats {
  return { hits: 0, misses: 0 }
}

export function describe(stats: CacheStats): string {
  const total = stats.hits + stats.misses
  if (total === 0) return 'no model reads'
  const pct = ((stats.hits / total) * 100).toFixed(0)
  return `${stats.hits} cached, ${stats.misses} paid for (${pct}% served from cache)`
}
