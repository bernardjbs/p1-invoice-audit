/**
 * A link out to the audit run's LangSmith trace.
 *
 * A plain anchor, not a router link: the destination is another origin, so
 * TanStack Router has nothing to route to. `noreferrer` goes with `_blank` for
 * the usual reason — without it the opened tab can reach back through
 * `window.opener`.
 *
 * Renders nothing without a URL, which is the common case rather than an error:
 * runs made by the mock engine, and any run made with tracing off, have no
 * trace, and an inert "View trace" link would be worse than no link at all.
 */
export function TraceLink({ url }: { url: string | null }) {
  if (url === null) return null
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      data-testid="trace-link"
      className="text-muted-foreground text-sm underline"
    >
      View trace ↗
    </a>
  )
}
