import { serve } from '@hono/node-server'
import { app } from './app'

// Node runtime in prod (CONVENTIONS §29); Bun runs this same entry locally.
const port = Number(process.env.PORT ?? 3000)

serve({ fetch: app.fetch, port }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`api listening on http://localhost:${info.port}`)
})
