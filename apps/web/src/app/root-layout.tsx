import { Link, Outlet } from '@tanstack/react-router'

/** App shell: top nav + routed content (plan T9). */
const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/invoices', label: 'Invoices' },
  { to: '/review', label: 'Review queue' },
  { to: '/upload', label: 'Upload' },
] as const

export function RootLayout() {
  return (
    <div className="bg-background text-foreground min-h-screen">
      <header className="border-b">
        <nav className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-4">
          <span className="font-semibold">Invoice Audit</span>
          <div className="flex gap-4 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="text-muted-foreground hover:text-foreground [&.active]:text-foreground transition-colors [&.active]:font-medium"
                activeOptions={{ exact: item.to === '/' }}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
