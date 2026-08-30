import { Hono } from 'hono'
import { listVendors } from '../invoices/service'

/** Vendor routes (plan T6). Mounted under /api by app.ts. */
export const vendorsRoutes = new Hono()

vendorsRoutes.get('/vendors', async (c) => c.json(await listVendors(), 200))
