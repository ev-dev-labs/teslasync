import { fireEvent, render, screen } from '@testing-library/react'
import '@/i18n'
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
    const title = screen.getByRole('heading', { name: 'Something went wrong' })
    const message = screen.getByText('Page explosion')
    const retry = screen.getByRole('button', { name: 'Try Again' })
    const actions = retry.closest('[data-app-part="feedback-actions"]')
    expect(actions).toContainElement(screen.getByRole('button', { name: 'Go Home' }))
    expect(actions).not.toContainElement(message)
    expect(title.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(message.compareDocumentPosition(retry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('lets the page recover without replacing surrounding shell content', () => {
    const page = (shouldThrow: boolean) => (
      <>
        <nav aria-label="Workspace">Workspace navigation</nav>
        <PageErrorBoundary pageName="Battery Health">
          <ThrowingComponent shouldThrow={shouldThrow} />
        </PageErrorBoundary>
      </>
    )
    const { rerender } = render(page(true))
    const shell = screen.getByRole('navigation', { name: 'Workspace' })
    expect(shell).toBeVisible()
    rerender(page(false))
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))

    expect(screen.getByRole('navigation', { name: 'Workspace' })).toBe(shell)
    expect(screen.getByText('Page OK')).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Something went wrong' })).not.toBeInTheDocument()
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
