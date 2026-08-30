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
    refetchInterval: (query) =>
      query.state.data?.invoice.status === 'auditing' ? 1500 : false,
  })
}

export function useVendors() {
  return useQuery({ queryKey: invoiceKeys.vendors, queryFn: () => api.get<Vendor[]>('/vendors') })
}

export function useUploadInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (form: FormData) => api.postForm<{ id: string }>('/invoices', form),
    onSuccess: () => qc.invalidateQueries({ queryKey: invoiceKeys.all }),
  })
}
