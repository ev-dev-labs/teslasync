/**
 * AlertBanner contract.
 *
 * AlertBanner is a pure presentational component, so the spec exercises it
 * directly (no network / query client). The real i18n instance is loaded via
 * `@/i18n` so the dismiss control resolves its `common.dismiss` label exactly
 * as it does in production.
 *
 * Coverage:
 *   1. Title + body render.
 *   2. Body-only (no title paragraph emitted).
 *   3. Every variant maps to subdued semantic chrome with neutral content.
 *   4. Leading icon renders and is hidden from assistive tech.
 *   5. No dismiss button unless `onClose` is provided.
 *   6. Dismiss button fires `onClose`, is a non-submit button, and carries an
 *      accessible label.
 *   7. `closeLabel` overrides the default dismiss label.
 *   8. Arbitrary props (e.g. an explicit `role`) are forwarded to the container.
 *   9. Caller `className` is merged onto the container.
 *  10. An unknown variant degrades to `info` styling instead of crashing.
 */

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import '@/i18n'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { AlertBanner, type AlertVariant } from './AlertBanner'

describe('AlertBanner', () => {
  it('renders the title and body content', () => {
    render(
      <AlertBanner variant="info" title="Heads up">
        Something happened
      </AlertBanner>,
    )
    expect(screen.getByText('Heads up')).toBeInTheDocument()
    expect(screen.getByText('Something happened')).toBeInTheDocument()
  })

  it('renders body-only when no title is given', () => {
    const { container } = render(
      <AlertBanner variant="info">Body only</AlertBanner>,
    )
    expect(screen.getByText('Body only')).toBeInTheDocument()
    // The title paragraph is only emitted when `title` is truthy.
    expect(container.querySelector('p')).toBeNull()
  })

  it('maps each variant to theme-safe border, title, and body colours', () => {
    const cases: Array<[AlertVariant, string]> = [
      ['info', 'info'],
      ['success', 'success'],
      ['warning', 'warning'],
      ['danger', 'danger'],
    ]
    for (const [variant, tone] of cases) {
      const { container, unmount } = render(
        <AlertBanner variant={variant} title="T">
          body
        </AlertBanner>,
      )
      const banner = container.firstElementChild as HTMLElement
      expect(banner).toHaveClass(`border-[var(--semantic-${tone}-border)]`, `bg-[var(--semantic-${tone}-bg)]`)
      expect(screen.getByText('T')).toHaveClass('text-[var(--text-primary)]', 'font-semibold')
      expect(screen.getByText('body')).toHaveClass('text-[var(--text-primary)]')
      expect(banner.className).not.toMatch(/neon|backdrop-blur|shadow-e/)
      unmount()
    }
  })

  it('renders a leading icon and hides its wrapper from assistive tech', () => {
    render(
      <AlertBanner variant="warning" icon={<Bell data-testid="lead-icon" />}>
        body
      </AlertBanner>,
    )
    const icon = screen.getByTestId('lead-icon')
    expect(icon).toBeInTheDocument()
    expect(icon.parentElement?.getAttribute('aria-hidden')).toBe('true')
  })

  it('omits the dismiss button when onClose is not provided', () => {
    render(<AlertBanner variant="info">body</AlertBanner>)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders a dismiss button that fires onClose and never submits a form', () => {
    const onClose = vi.fn()
    render(
      <AlertBanner variant="danger" onClose={onClose}>
        body
      </AlertBanner>,
    )
    const btn = screen.getByRole('button', { name: /dismiss/i })
    // type="button" guards against accidental submits when nested in a <form>.
    expect(btn).toHaveAttribute('type', 'button')
    fireEvent.click(btn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('uses a custom closeLabel for the dismiss control', () => {
    render(
      <AlertBanner
        variant="info"
        onClose={() => undefined}
        closeLabel="Dismiss offline warning"
      >
        body
      </AlertBanner>,
    )
    expect(
      screen.getByRole('button', { name: 'Dismiss offline warning' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
  })

  it('forwards arbitrary props such as an explicit role to the container', () => {
    render(
      <AlertBanner variant="danger" role="alert">
        Critical
      </AlertBanner>,
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Critical')
  })

  it('merges a caller className onto the container', () => {
    const { container } = render(
      <AlertBanner variant="info" className="mb-6 custom-x">
        body
      </AlertBanner>,
    )
    const banner = container.firstElementChild as HTMLElement
    expect(banner.className).toContain('custom-x')
    expect(banner.className).toContain('mb-6')
  })

  it('falls back to info styling for an unknown variant instead of crashing', () => {
    const bogus = 'nope' as AlertVariant
    const { container } = render(
      <AlertBanner variant={bogus} title="T">
        resilient body
      </AlertBanner>,
    )
    expect(screen.getByText('resilient body')).toBeInTheDocument()
    const banner = container.firstElementChild as HTMLElement
    expect(banner).toHaveClass('border-[var(--semantic-info-border)]')
  })

  it('keeps static notices quiet without inventing live-region severity', () => {
    const { container } = render(<AlertBanner variant="danger">Static notice</AlertBanner>)
    expect(container.firstElementChild).not.toHaveAttribute('role')
    expect(container.firstElementChild).not.toHaveAttribute('aria-live')
  })

  it('preserves native attributes, explicit announcement policy, and caller events', () => {
    const onClick = vi.fn()
    render(
      <AlertBanner variant="warning" id="retained-warning" dir="rtl" role="status"
        aria-live="polite" aria-atomic="false" aria-describedby="context"
        tabIndex={0} data-source="retained" onClick={onClick} style={{ marginTop: 12 }}>
        Retained data <a href="/recovery">Recover</a>
      </AlertBanner>,
    )
    const banner = screen.getByRole('status')
    expect(banner).toHaveAttribute('id', 'retained-warning')
    expect(banner).toHaveAttribute('dir', 'rtl')
    expect(banner).toHaveAttribute('aria-live', 'polite')
    expect(banner).toHaveAttribute('aria-atomic', 'false')
    expect(banner).toHaveAttribute('aria-describedby', 'context')
    expect(banner).toHaveAttribute('tabindex', '0')
    expect(banner).toHaveAttribute('data-source', 'retained')
    expect(banner).toHaveStyle({ marginTop: '12px' })
    expect(screen.getByRole('link', { name: 'Recover' })).toHaveAttribute('href', '/recovery')
    fireEvent.click(banner)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('contains long rich content and retains visible keyboard dismissal', () => {
    const longTitle = 'LongUnbrokenWarning'.repeat(30)
    render(
      <AlertBanner variant="warning" title={longTitle} onClose={vi.fn()}>
        <p>Persistent context</p><a href="/details">All details</a>
      </AlertBanner>,
    )
    expect(screen.getByText(longTitle).parentElement).toHaveClass('min-w-0', 'break-words')
    expect(screen.getByText('Persistent context')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'All details' })).toBeInTheDocument()
    const dismiss = screen.getByRole('button', { name: 'Dismiss' })
    expect(dismiss).toHaveClass('h-11', 'w-11', 'md:h-8', 'md:w-8', 'focus-visible:outline-2')
    dismiss.focus()
    expect(dismiss).toHaveFocus()
  })

  it('retains an explicitly empty dismiss label', () => {
    render(<AlertBanner variant="info" closeLabel="" onClose={vi.fn()}>body</AlertBanner>)
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', '')
  })

  it('preserves retained facts and independent actions when severity changes', () => {
    const retry = vi.fn()
    const dismiss = vi.fn()
    const actionRef = createRef<HTMLButtonElement>()
    const content = (
      <>
        <p>Last successful reading: 0; current reading: unknown</p>
        <Button ref={actionRef} type="button" onClick={retry}>Retry this source</Button>
      </>
    )
    const { rerender } = render(
      <AlertBanner variant="warning" onClose={dismiss}>{content}</AlertBanner>,
    )
    const action = screen.getByRole('button', { name: 'Retry this source' })
    expect(actionRef.current).toBe(action)
    rerender(<AlertBanner variant="danger" onClose={dismiss}>{content}</AlertBanner>)
    expect(screen.getByText('Last successful reading: 0; current reading: unknown')).toBeVisible()
    expect(actionRef.current).toBe(action)
    fireEvent.click(action)
    expect(retry).toHaveBeenCalledTimes(1)
    expect(dismiss).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(dismiss).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Last successful reading: 0; current reading: unknown')).toBeVisible()
  })

  it('retains keyboard handlers and focus order without adding dismissal shortcuts', () => {
    const onKeyDown = vi.fn()
    const dismiss = vi.fn()
    render(
      <AlertBanner variant="warning" onKeyDown={onKeyDown} onClose={dismiss} dir="rtl">
        <a href="/recovery">Recover first</a>
      </AlertBanner>,
    )
    const link = screen.getByRole('link', { name: 'Recover first' })
    const close = screen.getByRole('button', { name: 'Dismiss' })
    expect(link.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    link.focus()
    expect(link).toHaveFocus()
    fireEvent.keyDown(link, { key: 'Escape' })
    expect(onKeyDown).toHaveBeenCalledTimes(1)
    expect(dismiss).not.toHaveBeenCalled()
    close.focus()
    expect(close).toHaveFocus()
  })
})
