import { render, screen } from '@testing-library/react'
import { PageErrorBoundary } from './PageErrorBoundary'

function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Page explosion')
  return <div>Page OK</div>
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('PageErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <PageErrorBoundary pageName="Battery Health">
        <div>Page content</div>
      </PageErrorBoundary>,
    )
    expect(screen.getByText('Page content')).toBeInTheDocument()
  })

  it('shows the full-page fallback UI on error', () => {
    render(
      <PageErrorBoundary pageName="Battery Health">
        <ThrowingComponent shouldThrow />
      </PageErrorBoundary>,
    )
    expect(screen.queryByText('Page OK')).not.toBeInTheDocument()
    // Full-page fallback (not inline)
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /go home/i })).toBeInTheDocument()
  })

  it('logs with the page name prefix', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <PageErrorBoundary pageName="Battery Health">
        <ThrowingComponent shouldThrow />
      </PageErrorBoundary>,
    )
    // ErrorBoundary's componentDidCatch logs `[ErrorBoundary:page:<name>]`
    const calls = errorSpy.mock.calls.map((args) => String(args[0]))
    expect(calls.some((tag) => tag.includes('page:Battery Health'))).toBe(true)
    errorSpy.mockRestore()
  })
})
