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
 *   - compact descriptions remain accessible through the info tooltip
 *   - the compact header is unboxed, without a decorative gradient underline
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react'
import { createRef, type ReactNode } from 'react'
import { ToastProvider } from '@/components/feedback/Toast'
import { Button } from '../ui/Button'
import userEvent from '@testing-library/user-event'

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

  it('owns the compact description in an accessible info tooltip and omits it when unset', () => {
    const { container, rerender } = renderHeader(
      <PageHeader title="Drives" subtitle="Last 30 days" />,
    )
    const info = screen.getByRole('button', { name: 'More info: Drives' })
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('Last 30 days')
    expect(info).toHaveAttribute('aria-describedby', tooltip.id)
    expect(container.querySelector('p')).toBeNull()

    rerender(
      <ToastProvider>
        <PageHeader title="Drives" />
      </ToastProvider>,
    )
    expect(screen.queryByText('Last 30 days')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'More info: Drives' })).toBeNull()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('keeps the explicit expanded subtitle readable without an info button', () => {
    const { container } = renderHeader(
      <PageHeader title="Drives" subtitle="Last 30 days" compactHeader={false} />,
    )
    expect(container.querySelector('p')).toHaveTextContent('Last 30 days')
    expect(screen.queryByRole('button', { name: 'More info: Drives' })).toBeNull()
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
        actions={<Button type="button" variant="secondary">Export CSV</Button>}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Export CSV' }),
    ).toBeInTheDocument()
  })

  it('does not render the actions rail when neither actions nor copyLink are set', () => {
    renderHeader(<PageHeader title="Analytics" subtitle="TCO" />)
    expect(screen.getByRole('button', { name: 'More info: Analytics' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Actions' })).toBeNull()
    expect(screen.queryByRole('button', { name: /copy link to this view/i })).toBeNull()
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
        actions={<Button type="button" variant="secondary">New rule</Button>}
      />,
    )
    expect(
      screen.getByRole('button', { name: /copy link to this view/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New rule' })).toBeInTheDocument()
  })

  it('places typed page actions in the canonical groups', () => {
    const { container } = renderHeader(
      <PageHeader
        title="Fleet"
        metadataActions={<span>Fresh</span>}
        contextActions={<Button type="button" variant="secondary">Vehicle</Button>}
        secondaryActions={<Button type="button" variant="secondary">Compare</Button>}
        destructiveActions={<Button type="button" variant="danger">Remove</Button>}
        overflowActions={<Button type="button" variant="ghost">More</Button>}
        primaryAction={<Button type="button">Sync</Button>}
      />,
    )

    expect(
      Array.from(container.querySelectorAll('[data-action-group]'))
        .map((group) => group.getAttribute('data-action-group')),
    ).toEqual(['metadata', 'context', 'secondary', 'destructive', 'overflow', 'primary'])
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
    expect(btn).toHaveAccessibleName('Copied')
    expect(btn.textContent).toBe('')
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
    expect(heading.className).toContain('font-bold')
    expect(heading.className).not.toContain('bg-clip-text')
  })

  it('uses compact unboxed framing and omits the decorative gradient underline', () => {
    const { container } = renderHeader(<PageHeader title="Fleet Overview" />)
    expect(container.querySelector('header')).toHaveClass(
      'rounded-none',
      'border-0',
      'bg-transparent',
      'shadow-none',
    )
    expect(container.querySelector('header')).not.toHaveClass('rounded-panel', 'shadow-e1')
    expect(container.querySelector('.from-neon-cyan')).toBeNull()
  })

  it('keeps expanded framing neutral and the optional icon subordinate to the title', () => {
    const { container } = renderHeader(
      <PageHeader title="Battery" compactHeader={false} icon={<svg data-testid="neutral-icon" />} />,
    )
    expect(container.querySelector('header')).toHaveClass('rounded-panel', 'shadow-e1')
    expect(container.querySelector('header')).toHaveClass('p-4', 'sm:p-6', 'flex-col', 'xl:flex-row')
    expect(screen.getByTestId('neutral-icon').parentElement).toHaveClass(
      'text-[var(--text-secondary)]', 'bg-[var(--surface-2)]',
    )
    expect(screen.getByTestId('neutral-icon').parentElement).not.toHaveClass('shadow-e1')
    expect(container.querySelector('[class*="theme-primary"]')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).className).not.toContain('tracking-[')
  })

  it('retains long RTL text, route focus and ref-backed legacy and semantic actions', async () => {
    const user = userEvent.setup()
    const ref = createRef<HTMLButtonElement>()
    const onAction = vi.fn()
    const title = 'تقرير المركبات '.repeat(20)
    const subtitle = 'تفاصيل النطاق '.repeat(20)
    const { container } = renderHeader(
      <div dir="rtl">
        <PageHeader
          title={title}
          subtitle={subtitle}
          compactHeader={false}
          actions={<Button ref={ref} onClick={onAction} variant="secondary">Legacy export</Button>}
          secondaryActions={<Button variant="secondary">Compare</Button>}
        />
      </div>,
    )
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.textContent).toBe(title)
    expect(heading).toHaveClass('min-w-0', 'break-words')
    expect(heading).toHaveAttribute('data-route-focus-target', 'true')
    expect(heading).toHaveAttribute('tabindex', '-1')
    heading.focus()
    expect(heading).toHaveFocus()
    expect(container.querySelector('[dir="rtl"]')).toContainElement(heading)
    expect(container.querySelector('p')?.textContent).toBe(subtitle)
    expect(container.querySelector('p')).toHaveClass('break-words')
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Legacy export' }))
    await user.tab()
    expect(ref.current).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onAction).toHaveBeenCalledTimes(1)
    await user.tab()
    expect(screen.getByRole('button', { name: 'Compare' })).toHaveFocus()
  })

  it('keeps compact help keyboard reachable with shared focus and touch sizing', async () => {
    const user = userEvent.setup()
    renderHeader(<PageHeader title="Drives" subtitle="Last 30 days" />)
    const info = screen.getByRole('button', { name: 'More info: Drives' })
    await user.tab()
    expect(info).toHaveFocus()
    expect(info).toHaveClass(
      'h-11', 'w-11', 'sm:h-9', 'sm:w-9',
      'focus-visible:outline-[var(--focus-ring)]',
    )
    expect(screen.getByRole('tooltip')).toHaveTextContent('Last 30 days')
    await user.keyboard('{Escape}')
    expect(info).toHaveFocus()
    expect(screen.getByRole('tooltip')).toHaveClass('!opacity-0')
  })
})
