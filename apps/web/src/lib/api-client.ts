/**
 * Tiny typed fetch wrapper for the Hono API. In dev, Vite proxies `/api` to the
 * API server (vite.config.ts); in prod both are served from the same origin, so
 * a relative base works everywhere. Throws on non-2xx so TanStack Query surfaces
 * the error (CONVENTIONS §8).
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    throw new Error(body?.error?.message ?? `request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  postJson: <T>(path: string, body: unknown) =>
    request<T>(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  postForm: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
}
