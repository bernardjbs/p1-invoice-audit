import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { RootLayout } from './root-layout'
import { DashboardPage } from '@/features/dashboard/dashboard-page'
import { InvoicesPage } from '@/features/invoices/invoices-page'
import { InvoiceDetailPage } from '@/features/invoices/invoice-detail-page'
import { UploadPage } from '@/features/invoices/upload-page'
import { ReviewPage } from '@/features/review/review-page'

/**
 * Code-based route tree (the starter's style — no generated routeTree.gen.ts).
 * T9–T12 each add/replace a page here; the tree is the one shared file, so the
 * web tasks stay serial by design (plan dependency graph).
 */
const rootRoute = createRootRoute({ component: RootLayout })

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: DashboardPage })
const invoicesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/invoices', component: InvoicesPage })
const invoiceDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invoices/$id',
  component: function InvoiceDetailRoute() {
    return <InvoiceDetailPage id={invoiceDetailRoute.useParams().id} />
  },
})
const uploadRoute = createRoute({ getParentRoute: () => rootRoute, path: '/upload', component: UploadPage })
const reviewRoute = createRoute({ getParentRoute: () => rootRoute, path: '/review', component: ReviewPage })

const routeTree = rootRoute.addChildren([indexRoute, invoicesRoute, invoiceDetailRoute, uploadRoute, reviewRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
