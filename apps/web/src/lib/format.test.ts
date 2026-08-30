import { describe, expect, it } from 'vitest'
import { formatAud, formatDate } from './format'

describe('formatAud', () => {
  it('formats a number as AUD currency', () => {
    expect(formatAud(1234.5)).toBe('$1,234.50')
  })
})

describe('formatDate', () => {
  it('passes through an ISO date and dashes a null', () => {
    expect(formatDate('2026-02-01')).toBe('2026-02-01')
    expect(formatDate(null)).toBe('—')
  })
})
