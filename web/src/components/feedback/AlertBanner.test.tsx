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
 *   3. Every variant maps to its themed border + toned title colour.
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
import '@/i18n'
import { Bell } from 'lucide-react'
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
    const cases: Array<[AlertVariant, RegExp, string, string, string, string]> = [
      ['info', /border-neon-cyan/, 'text-cyan-900', 'dark:text-cyan-200', 'text-cyan-800', 'dark:text-cyan-100'],
      ['success', /border-neon-green/, 'text-emerald-900', 'dark:text-emerald-200', 'text-emerald-800', 'dark:text-emerald-100'],
      ['warning', /border-neon-amber/, 'text-amber-900', 'dark:text-amber-200', 'text-amber-800', 'dark:text-amber-100'],
      ['danger', /border-neon-red/, 'text-rose-900', 'dark:text-rose-200', 'text-rose-800', 'dark:text-rose-100'],
    ]
    for (const [variant, borderRe, lightTitle, darkTitle, lightBody, darkBody] of cases) {
      const { container, unmount } = render(
        <AlertBanner variant={variant} title="T">
          body
        </AlertBanner>,
      )
      const banner = container.firstElementChild as HTMLElement
      expect(banner.className).toMatch(borderRe)
      expect(screen.getByText('T').className).toContain(lightTitle)
      expect(screen.getByText('T').className).toContain(darkTitle)
      expect(screen.getByText('body').className).toContain(lightBody)
      expect(screen.getByText('body').className).toContain(darkBody)
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
    const bogus = 'nope' as unknown as AlertVariant
    const { container } = render(
      <AlertBanner variant={bogus} title="T">
        resilient body
      </AlertBanner>,
    )
    expect(screen.getByText('resilient body')).toBeInTheDocument()
    const banner = container.firstElementChild as HTMLElement
    // Fallback is the `info` variant → neon-cyan border.
    expect(banner.className).toMatch(/border-neon-cyan/)
  })
})
