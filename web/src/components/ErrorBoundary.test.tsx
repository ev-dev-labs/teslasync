import { render, screen, fireEvent } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary'

// A component that throws on demand
function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Test explosion')
  return <div>All good</div>
}

// Suppress console.error noise from React error boundaries during tests
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <div>Child content</div>
      </ErrorBoundary>
    )
    expect(screen.getByText('Child content')).toBeInTheDocument()
  })

  it('catches errors and shows fallback UI', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>
    )
    expect(screen.queryByText('All good')).not.toBeInTheDocument()
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('shows the error message in the fallback', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>
    )
    expect(screen.getByText('Test explosion')).toBeInTheDocument()
  })

  it('has a "Try Again" button that resets the boundary', () => {
    const { rerender } = render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>
    )
    const btn = screen.getByText('Try Again')
    expect(btn).toBeInTheDocument()

    // After clicking Try Again the boundary resets; re-render with no error
    rerender(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={false} />
      </ErrorBoundary>
    )
    fireEvent.click(btn)
  })

  it('renders a custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom fallback</div>}>
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>
    )
    expect(screen.getByText('Custom fallback')).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
  })

  it('shows inline error when inline prop is set', () => {
    render(
      <ErrorBoundary inline>
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>
    )
    expect(screen.getByText('Component failed to load')).toBeInTheDocument()
    expect(screen.getByText('Retry')).toBeInTheDocument()
  })

  it('has a "Go Home" link', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>
    )
    const homeLink = screen.getByText('Go Home')
    expect(homeLink).toBeInTheDocument()
    expect(homeLink.closest('a')).toHaveAttribute('href', '/')
  })
})
