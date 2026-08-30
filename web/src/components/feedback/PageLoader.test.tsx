import { render, screen } from '@testing-library/react'
import { PageLoader } from './PageLoader'

// i18n: passthrough `t` that honours the `defaultValue` fallback so the
// component's copy renders without booting the full i18n runtime. Mirrors the
// convention in DraftRestorePrompt.test.tsx.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
  }),
}))

const DEFAULT_LABEL = 'Loading…'

describe('PageLoader', () => {
  it('renders the shared page-shaped skeleton with the translated default label', () => {
    render(<PageLoader />)

    const container = screen.getByTestId('page-loader')
    expect(container).toHaveClass('py-8')
    expect(screen.getByTestId('page-load-skeleton')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-print-card]')).toHaveLength(3)
  })

  it('exposes exactly one polite status region named by the loading label', () => {
    render(<PageLoader />)

    const regions = screen.getAllByRole('status')
    expect(regions).toHaveLength(1)
    // The accessible name is announced to assistive tech via aria-label.
    expect(screen.getByRole('status', { name: DEFAULT_LABEL })).toBeInTheDocument()
  })

  it('renders a custom label and uses it as the status accessible name', () => {
    render(<PageLoader label="Loading matrix…" />)

    expect(screen.getByRole('status', { name: 'Loading matrix…' })).toBeInTheDocument()
  })

  it('falls back to the default label when given a blank / whitespace-only label', () => {
    render(<PageLoader label="   " />)

    expect(screen.getByRole('status', { name: DEFAULT_LABEL })).toBeInTheDocument()
  })

  it('merges a custom className onto the container without dropping the defaults', () => {
    render(<PageLoader className="min-h-screen" />)

    const container = screen.getByTestId('page-loader')
    expect(container).toHaveClass('min-h-screen')
    expect(container).toHaveClass('py-8')
  })
})
