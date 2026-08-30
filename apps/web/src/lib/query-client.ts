import { QueryClient } from '@tanstack/react-query'

/**
 * The app's single QueryClient. Server state lives here (CONVENTIONS §7); no
 * mirroring into client state. Sensible defaults for a small app: one retry,
 * refetch off window-focus disabled to keep the review workflow predictable.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 },
  },
})
