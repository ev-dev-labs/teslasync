import { fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import { SectionErrorBoundary } from './SectionErrorBoundary'

function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Section explosion')
  return <div>Section OK</div>
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('SectionErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <SectionErrorBoundary name="test">
          <div>Section content</div>
        </SectionErrorBoundary>
      </I18nextProvider>,
    )
    expect(screen.getByText('Section content')).toBeInTheDocument()
  })

  it('falls back to inline UI by default and shows Retry', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <SectionErrorBoundary name="test">
          <ThrowingComponent shouldThrow />
        </SectionErrorBoundary>
      </I18nextProvider>,
    )
    expect(screen.queryByText('Section OK')).not.toBeInTheDocument()
    // Underlying ErrorBoundary inline mode
    expect(screen.getByText('Component failed to load')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('uses fallbackTitle when provided', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <SectionErrorBoundary name="test" fallbackTitle="Custom title">
          <ThrowingComponent shouldThrow />
        </SectionErrorBoundary>
      </I18nextProvider>,
    )
    expect(screen.getByText('Custom title')).toBeInTheDocument()
    expect(screen.getByText(/other parts of the page should still work/i)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('keeps healthy native children interactive even when fallbacks are supplied', () => {
    const onClick = vi.fn()
    const { container } = render(
      <SectionErrorBoundary
        name="healthy"
        fallbackTitle="Unused title"
        fallback={<div>Unused fallback</div>}
      >
        <a href="#section" aria-label="Section link" onClick={onClick}>Open section</a>
      </SectionErrorBoundary>,
    )
    const link = screen.getByRole('link', { name: 'Section link' })
    expect(container.firstElementChild).toBe(link)
    expect(link).toHaveAttribute('href', '#section')
    fireEvent.click(link)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Unused title')).not.toBeInTheDocument()
    expect(screen.queryByText('Unused fallback')).not.toBeInTheDocument()
  })

  it('retains the default retry and captured error for an empty title', () => {
    render(
      <SectionErrorBoundary name="empty-title" fallbackTitle="">
        <ThrowingComponent shouldThrow />
      </SectionErrorBoundary>,
    )
    expect(screen.getByText('Component failed to load')).toBeInTheDocument()
    expect(screen.getByText('Section explosion')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('renders custom fallback node when provided', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <SectionErrorBoundary
          name="test"
          fallback={<div data-testid="custom">Custom fallback</div>}
        >
          <ThrowingComponent shouldThrow />
        </SectionErrorBoundary>
      </I18nextProvider>,
    )
    expect(screen.getByTestId('custom')).toBeInTheDocument()
    expect(screen.queryByText('Component failed to load')).not.toBeInTheDocument()
  })

  it('isolates failures — sibling renders normally', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <div>
          <SectionErrorBoundary name="left">
            <ThrowingComponent shouldThrow />
          </SectionErrorBoundary>
          <SectionErrorBoundary name="right">
            <div>Sibling OK</div>
          </SectionErrorBoundary>
        </div>
      </I18nextProvider>,
    )
    // The thrown sibling shows the inline fallback
    expect(screen.getByText('Component failed to load')).toBeInTheDocument()
    // The healthy sibling continues to render
    expect(screen.getByText('Sibling OK')).toBeInTheDocument()
  })

  it('preserves error reporting with the caller name and captured details', () => {
    render(
      <SectionErrorBoundary name="correlated-section" fallbackTitle="Failed section">
        <ThrowingComponent shouldThrow />
      </SectionErrorBoundary>,
    )
    expect(console.error).toHaveBeenCalledWith(
      '[ErrorBoundary:correlated-section]',
      expect.objectContaining({
        error: 'Section explosion',
        componentStack: expect.any(String),
        retryCount: 0,
      }),
    )
  })

  it('retries the children without replacing the independent sibling', () => {
    let shouldThrow = true
    function RecoverableSection() {
      return <ThrowingComponent shouldThrow={shouldThrow} />
    }
    render(
      <div>
        <SectionErrorBoundary name="recoverable">
          <RecoverableSection />
        </SectionErrorBoundary>
        <div>Retained sibling</div>
      </div>,
    )
    const sibling = screen.getByText('Retained sibling')
    shouldThrow = false
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(screen.getByText('Section OK')).toBeInTheDocument()
    expect(screen.getByText('Retained sibling')).toBe(sibling)
  })

  it('resets a captured failure when the caller changes its React key', () => {
    const { rerender } = render(
      <SectionErrorBoundary key="before" name="keyed">
        <ThrowingComponent shouldThrow />
      </SectionErrorBoundary>,
    )
    rerender(
      <SectionErrorBoundary key="after" name="keyed">
        <ThrowingComponent shouldThrow={false} />
      </SectionErrorBoundary>,
    )
    expect(screen.getByText('Section OK')).toBeInTheDocument()
    expect(screen.queryByText('Component failed to load')).not.toBeInTheDocument()
  })

  it('preserves custom fallback precedence and structural markup', () => {
    render(
      <table>
        <tbody>
          <SectionErrorBoundary
            name="table-section"
            fallbackTitle="Unused title"
            fallback={<tr><td>Structural fallback</td></tr>}
          >
            <ThrowingComponent shouldThrow />
          </SectionErrorBoundary>
        </tbody>
      </table>,
    )
    expect(screen.getByRole('cell')).toHaveTextContent('Structural fallback')
    expect(screen.queryByText('Unused title')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('keeps long RTL titles readable with quiet semantic roles and a decorative icon', () => {
    const title = 'عنوان طويل '.repeat(30)
    render(
      <div dir="rtl">
        <SectionErrorBoundary name="rtl-section" fallbackTitle={title}>
          <ThrowingComponent shouldThrow />
        </SectionErrorBoundary>
      </div>,
    )
    const alert = screen.getByRole('alert')
    const titleNode = alert.querySelector('p')
    expect(titleNode).toHaveTextContent(title.trim())
    expect(titleNode).toHaveClass('break-words')
    expect(alert).toHaveClass('min-w-0', 'rounded-panel', 'bg-[var(--semantic-danger-bg)]')
    expect(alert.className).not.toMatch(/tesla-red|glow|animate-/)
    expect(alert.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
