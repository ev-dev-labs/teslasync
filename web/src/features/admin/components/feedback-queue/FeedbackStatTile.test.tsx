/**
 * FeedbackStatTile contract.
 *
 * A single KPI tile in the feedback-queue overview band. It has exactly two
 * visual outcomes and the suite pins both branches plus the a11y + null-safety
 * contract that guards them:
 *
 *   1. Placeholder — while `loading` is true OR the count is not a finite number
 *      (undefined / null / NaN / Infinity slipping through untyped API data), the
 *      tile renders a card-shaped Skeleton wrapped in a labelled `role="status"`
 *      live region, so assistive tech announces the in-flight load instead of a
 *      silent pulsing box. The icon and value are intentionally absent here.
 *   2. Resolved — with a finite count and `loading` false it renders a MetricCard
 *      whose value is locale-formatted through `fmtInt` (thousands separators),
 *      forwarding `label`, `icon`, and `color` verbatim.
 *
 * Two edge cases matter and are pinned explicitly:
 *   - `0` is a *valid* count, not "empty": it must render the card ("0"), never
 *     the skeleton (regression guard against a falsy `!value` check).
 *   - `loading` wins over an already-present value (loading precedence).
 *
 * react-i18next is mocked (mirroring the sibling BridgeStatus test) so the
 * fallback strings render deterministically without locale files.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

import { FeedbackStatTile } from './FeedbackStatTile'

const icon = <svg data-testid="tile-icon" aria-hidden="true" />

afterEach(() => {
  cleanup()
})

describe('FeedbackStatTile', () => {
  it('resolved: renders a MetricCard with the label, icon, and fmtInt-formatted value', () => {
    render(
      <FeedbackStatTile label="Total feedback" icon={icon} color="cyan" value={12345} loading={false} />,
    )

    // fmtInt applies locale grouping (en-US default) — proves formatting, not raw value.
    expect(screen.getByText('12,345')).toBeInTheDocument()
    expect(screen.getByText('Total feedback')).toBeInTheDocument()
    // Icon is forwarded straight into the card.
    expect(screen.getByTestId('tile-icon')).toBeInTheDocument()
    // Resolved state is never a loading live region.
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('resolved: 0 is a valid count and renders the card ("0"), never the skeleton', () => {
    const { container } = render(
      <FeedbackStatTile label="New" icon={icon} color="amber" value={0} loading={false} />,
    )

    expect(screen.getByText('0')).toBeInTheDocument()
    // Regression guard: a `!value` check would wrongly treat 0 as not-ready.
    expect(screen.queryByRole('status')).toBeNull()
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })

  it('resolved: forwards the neon color through to the MetricCard icon box', () => {
    render(<FeedbackStatTile label="Triaged" icon={icon} color="amber" value={7} loading={false} />)

    // MetricCard tints the icon's inner wrapper via neonColorMap[color].text.
    const iconEl = screen.getByTestId('tile-icon')
    expect(iconEl.parentElement?.className).toContain('text-amber-300')
  })

  it('resolved: large counts keep grouping separators via fmtInt', () => {
    render(
      <FeedbackStatTile label="Total feedback" icon={icon} color="cyan" value={1000000} loading={false} />,
    )

    expect(screen.getByText('1,000,000')).toBeInTheDocument()
  })

  it('loading: shows a labelled status region with a skeleton and hides the value', () => {
    const { container } = render(
      <FeedbackStatTile label="Total feedback" icon={icon} color="cyan" value={999} loading />,
    )

    const region = screen.getByRole('status')
    expect(region.getAttribute('aria-busy')).toBe('true')
    expect(region).toHaveAccessibleName('Loading…')
    // Skeleton primitive renders an animate-pulse bar inside the region.
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
    // Loading precedence: the value is withheld even though it was provided.
    expect(screen.queryByText('999')).toBeNull()
    // The icon belongs to the resolved card only.
    expect(screen.queryByTestId('tile-icon')).toBeNull()
  })

  it('placeholder: an undefined value (not yet loaded) renders the skeleton, not a card', () => {
    render(
      <FeedbackStatTile label="New" icon={icon} color="green" value={undefined} loading={false} />,
    )

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByTestId('tile-icon')).toBeNull()
    // Label is a MetricCard concern — the placeholder must not leak it.
    expect(screen.queryByText('New')).toBeNull()
  })

  it('placeholder: a non-finite value (NaN) resolves to the skeleton, never a fabricated "0"', () => {
    // NaN is statically a `number`, so a bare `=== undefined` guard would let it
    // through and fmtInt would coerce it to "0"; isFiniteNumber must catch it.
    render(<FeedbackStatTile label="Resolved" icon={icon} color="blue" value={NaN} loading={false} />)

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('0')).toBeNull()
  })

  it('placeholder: an Infinity value resolves to the skeleton, never a fabricated "0"', () => {
    render(
      <FeedbackStatTile
        label="Resolved"
        icon={icon}
        color="red"
        value={Number.POSITIVE_INFINITY}
        loading={false}
      />,
    )

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('0')).toBeNull()
  })
})
