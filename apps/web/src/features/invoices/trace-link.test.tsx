// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TraceLink } from './trace-link'

// Nothing wires testing-library's auto-cleanup here, so without this each render
// stacks on the previous test's DOM and `screen` queries see both.
afterEach(cleanup)

const TRACE_URL =
  'https://apac.smith.langchain.com/o/tenant-1/projects/p/project-1/r/run-1?poll=true'

describe('TraceLink', () => {
  it('links out to the trace when the run has one', () => {
    render(<TraceLink url={TRACE_URL} />)
    const link = screen.getByTestId('trace-link')
    expect(link.getAttribute('href')).toBe(TRACE_URL)
    // Opens away from the app, and cannot reach back through window.opener.
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noreferrer')
  })

  it('renders nothing when the run was not traced', () => {
    render(<TraceLink url={null} />)
    expect(screen.queryByTestId('trace-link')).toBeNull()
  })
})
