import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ErrorBoundary } from '../ErrorBoundary'

function Throw({ msg }: { msg: string }) {
  throw new Error(msg)
}

describe('ErrorBoundary route reset', () => {
  // React logs caught errors via console.error in dev/test; silence to keep
  // the test output clean while still exercising the boundary code path.
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('clears its error when resetKey changes', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/live">
        <Throw msg="L is not defined" />
      </ErrorBoundary>
    )
    expect(screen.getByText(/L is not defined/i)).toBeInTheDocument()

    rerender(
      <ErrorBoundary resetKey="/drives">
        <div>fresh content</div>
      </ErrorBoundary>
    )
    expect(screen.getByText('fresh content')).toBeInTheDocument()
    expect(screen.queryByText(/L is not defined/i)).not.toBeInTheDocument()
  })

  it('keeps showing the error when resetKey does NOT change', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/live">
        <Throw msg="boom" />
      </ErrorBoundary>
    )
    expect(screen.getByText(/boom/i)).toBeInTheDocument()

    rerender(
      <ErrorBoundary resetKey="/live">
        <div>not visible — boundary still in error</div>
      </ErrorBoundary>
    )
    expect(screen.getByText(/boom/i)).toBeInTheDocument()
    expect(screen.queryByText(/not visible/i)).not.toBeInTheDocument()
  })

  it('renders children normally when no error and resetKey changes', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/a">
        <div>page A</div>
      </ErrorBoundary>
    )
    expect(screen.getByText('page A')).toBeInTheDocument()

    rerender(
      <ErrorBoundary resetKey="/b">
        <div>page B</div>
      </ErrorBoundary>
    )
    expect(screen.getByText('page B')).toBeInTheDocument()
  })
})
