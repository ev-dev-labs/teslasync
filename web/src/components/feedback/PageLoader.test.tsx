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

// Keep the brand Spinner deterministic: force motion-enabled so the render
// path never depends on jsdom's (absent) matchMedia.
vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion')
  return { ...actual, useReducedMotion: () => false }
})

const DEFAULT_LABEL = 'Loading…'

describe('PageLoader', () => {
  it('centres the brand spinner and shows the translated default loading label', () => {
    render(<PageLoader />)

    const container = screen.getByTestId('page-loader')
    // Centring contract for the Suspense fallback.
    expect(container).toHaveClass('flex', 'items-center', 'justify-center', 'py-32')
    // Default copy comes from the shared translation key, not a hardcoded string.
    expect(screen.getByText(DEFAULT_LABEL)).toBeInTheDocument()
    // Large brand spinner (sizeMap.lg → h-20 w-20).
    expect(container.querySelector('.h-20.w-20')).not.toBeNull()
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

    expect(screen.getByText('Loading matrix…')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading matrix…' })).toBeInTheDocument()
    // The default copy must not leak through when a caller overrides it.
    expect(screen.queryByText(DEFAULT_LABEL)).not.toBeInTheDocument()
  })

  it('falls back to the default label when given a blank / whitespace-only label', () => {
    render(<PageLoader label="   " />)

    // Null-safety branch: a blank label is treated as absent.
    expect(screen.getByText(DEFAULT_LABEL)).toBeInTheDocument()
    expect(screen.getByRole('status', { name: DEFAULT_LABEL })).toBeInTheDocument()
  })

  it('merges a custom className onto the container without dropping the defaults', () => {
    render(<PageLoader className="min-h-screen" />)

    const container = screen.getByTestId('page-loader')
    expect(container).toHaveClass('min-h-screen')
    // cn() must preserve the base centring classes alongside the override.
    expect(container).toHaveClass('items-center', 'justify-center', 'py-32')
  })
})
