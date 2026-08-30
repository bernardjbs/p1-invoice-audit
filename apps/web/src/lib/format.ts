/** Display formatters. Money is AUD; dates are stored/transported as ISO. */
const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })

export const formatAud = (n: number): string => aud.format(n)

export const formatDate = (iso: string | null): string => iso ?? '—'

export const formatPct = (fraction: number): string => `${(fraction * 100).toFixed(1)}%`
