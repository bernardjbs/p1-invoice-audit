import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import type { InvoiceDetail, InvoiceListItem, InvoiceStatus, Vendor } from './types'

/**
 * Invoice server-state hooks + query-key factory (CONVENTIONS §7, §16). Keys
 * come from the factory, never inline arrays, so invalidation can't drift.
 */
export const invoiceKeys = {
  all: ['invoices'] as const,
  list: (status?: InvoiceStatus) => [...invoiceKeys.all, 'list', status ?? 'all'] as const,
  detail: (id: string) => [...invoiceKeys.all, 'detail', id] as const,
  vendors: ['vendors'] as const,
  sampleHolds: ['sample-holds'] as const,
}

export function useInvoices(status?: InvoiceStatus) {
  return useQuery({
    queryKey: invoiceKeys.list(status),
    queryFn: () => api.get<InvoiceListItem[]>(`/invoices${status ? `?status=${status}` : ''}`),
  })
}

export function useInvoice(id: string) {
  return useQuery({
    queryKey: invoiceKeys.detail(id),
    queryFn: () => api.get<InvoiceDetail>(`/invoices/${id}`),
    // While an audit is in flight, poll so the results appear without a manual
    // refresh (plan T11).
    refetchInterval: (query) => (query.state.data?.invoice.status === 'auditing' ? 1500 : false),
  })
}

export type SampleHolds = {
  ttlMinutes: number
  holds: { invoiceNumber: string; freesAt: string }[]
}

/**
 * Which sample invoices are already taken. Polled, because in production the
 * row is shared: a sample can be taken by somebody else while this page is
 * open, and a button that is still offered is a 409 waiting to happen.
 */
export function useSampleHolds() {
  return useQuery({
    queryKey: invoiceKeys.sampleHolds,
    queryFn: () => api.get<SampleHolds>('/samples/holds'),
    refetchInterval: 30_000,
  })
}

export function useVendors() {
  return useQuery({ queryKey: invoiceKeys.vendors, queryFn: () => api.get<Vendor[]>('/vendors') })
}

export function useUploadInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (form: FormData) => api.postForm<{ id: string }>('/invoices', form),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: invoiceKeys.all })
      // A sample just became taken. Without this the button stays offered for
      // up to the poll interval, and the next press is a 409.
      await qc.invalidateQueries({ queryKey: invoiceKeys.sampleHolds })
    },
  })
}
