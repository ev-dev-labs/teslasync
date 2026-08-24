/**
 * PageHeader behaviour + hardening tests.
 *
 * Covers the single export of PageHeader.tsx across its prop matrix and the
 * two a11y guarantees this file makes:
 *   - title renders as the page's single <h1>
 *   - subtitle / icon / actions branches render only when their prop is set
 *   - the actions rail appears only when `actions` OR `copyLink` is provided
 *   - `copyLink` mounts the real CopyLinkButton — clicking copies the current
 *     URL to the clipboard, flips to "Copied", and surfaces a success toast;
 *     a rejected clipboard write surfaces an error toast (failure path)
 *   - the page title uses the shared typography role without decorative
 *     gradient treatment
 *   - the header uses the shared subtle divider for consistent hierarchy
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { ToastProvider } from '@/components/feedback/Toast'

// i18n stub — return the caller-supplied default string so CopyLinkButton's
// labels/toasts resolve to their English fallbacks without booting i18next.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) =>
      typeof fallback === 'string' ? fallback : key,
  }),
}))

// Imported AFTER the mock so the module graph sees the stubbed react-i18next.
import { PageHeader } from './PageHeader'

const writeText = vi.fn(() => Promise.resolve())

beforeEach(() => {
  writeText.mockReset()
  writeText.mockResolvedValue(undefined)

  // framer-motion's useReducedMotion (via <FadeIn> and <ToastProvider>) reads
  // window.matchMedia, which jsdom does not implement. Provide a non-reduced
  // stub so the motion wrappers render their children.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  })

  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
})

afterEach(() => cleanup())

function renderHeader(ui: ReactNode) {
  return render(<ToastProvider>{ui}</ToastProvider>)
}

describe('PageHeader', () => {
  it('renders the title as the page-level heading (h1)', () => {
    renderHeader(<PageHeader title="Fleet Overview" />)
    const heading = screen.getByRole('heading', { level: 1, name: 'Fleet Overview' })
    expect(heading).toBeInTheDocument()
    expect(heading.tagName).toBe('H1')
  })

  it('renders the subtitle when provided and omits the paragraph when not', () => {
    const { rerender } = renderHeader(
      <PageHeader title="Drives" subtitle="Last 30 days" />,
    )
    expect(screen.getByText('Last 30 days')).toBeInTheDocument()

    rerender(
      <ToastProvider>
        <PageHeader title="Drives" />
      </ToastProvider>,
    )
    expect(screen.queryByText('Last 30 days')).not.toBeInTheDocument()
  })

  it('renders a leading icon only when the icon prop is set', () => {
    const { rerender } = renderHeader(
      <PageHeader title="Battery" icon={<svg data-testid="hdr-icon" />} />,
    )
    expect(screen.getByTestId('hdr-icon')).toBeInTheDocument()

    rerender(
      <ToastProvider>
        <PageHeader title="Battery" />
      </ToastProvider>,
    )
    expect(screen.queryByTestId('hdr-icon')).not.toBeInTheDocument()
  })

  it('renders custom actions passed via the actions prop', () => {
    renderHeader(
      <PageHeader
        title="Charging"
        actions={<button type="button">Export CSV</button>}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Export CSV' }),
    ).toBeInTheDocument()
  })

  it('does not render the actions rail when neither actions nor copyLink are set', () => {
    renderHeader(<PageHeader title="Analytics" subtitle="TCO" />)
    // No copy-link button and no action buttons ⇒ the rail is absent entirely.
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('mounts the CopyLinkButton when copyLink is true', () => {
    renderHeader(<PageHeader title="Notifications" copyLink />)
    expect(
      screen.getByRole('button', { name: /copy link to this view/i }),
    ).toBeInTheDocument()
  })

  it('renders both the copy-link button and custom actions together', () => {
    renderHeader(
      <PageHeader
        title="Notifications"
        copyLink
        actions={<button type="button">New rule</button>}
      />,
    )
    expect(
      screen.getByRole('button', { name: /copy link to this view/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New rule' })).toBeInTheDocument()
  })

  it('copies the current URL and shows a success toast + "Copied" state on click', async () => {
    renderHeader(<PageHeader title="Notifications" copyLink />)
    const btn = screen.getByRole('button', { name: /copy link to this view/i })

    fireEvent.click(btn)

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(window.location.href),
    )
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Link copied to clipboard')).toBeInTheDocument()
    // aria-label is stable; the *visible* label flips to "Copied".
    expect(btn).toHaveTextContent('Copied')
  })

  it('surfaces an error toast when the clipboard write is rejected', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'))
    renderHeader(<PageHeader title="Notifications" copyLink />)

    fireEvent.click(
      screen.getByRole('button', { name: /copy link to this view/i }),
    )

    expect(await screen.findByText('Could not copy link')).toBeInTheDocument()
    expect(screen.queryByText('Link copied to clipboard')).toBeNull()
  })

  it('uses the shared sober heading treatment instead of gradient text', () => {
    renderHeader(<PageHeader title="Fleet Overview" />)
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.className).toContain('font-semibold')
    expect(heading.className).not.toContain('bg-clip-text')
  })

  it('uses the shared subtle divider and omits the decorative underline', () => {
    const { container } = renderHeader(<PageHeader title="Fleet Overview" />)
    expect(container.querySelector('header')?.className).toContain('border-[var(--border-subtle)]')
    expect(container.querySelector('.from-neon-cyan')).toBeNull()
  })
})
