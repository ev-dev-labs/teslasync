/**
 * MetricBar — sublabel="" suppression regression.
 *
 * Pre-fix: `<span>{sublabel || fmtNumber(value)}</span>`. The empty
 * string is JS-falsy, so passing `sublabel=""` to suppress the
 * value-readout (because the same value is already shown in a sibling
 * row) fell through to `fmtNumber(value)`. With value=0 this rendered
 * a stray "0.00" beneath the Conservative pill in the Throttle
 * Behavior panel of /driving.
 *
 * Post-fix: `sublabel ?? fmtNumber(value)` — only undefined/null
 * triggers the value fallback; an explicit empty string is honoured.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: () => (props: Record<string, unknown>) => {
        const Component = (props.as as string) ?? 'div'
        const { children, ...rest } = props as { children?: unknown } & Record<string, unknown>
        return (
          <Component {...(rest as Record<string, unknown>)}>{children as React.ReactNode}</Component>
        )
      },
    },
  ),
  useReducedMotion: () => false,
}))

import { MetricBar } from '../MetricBar'

describe('MetricBar — sublabel rendering', () => {
  it('renders the formatted value when sublabel is undefined (omitted prop)', () => {
    render(<MetricBar value={42.5} max={100} color="#22c55e" label="Power" />)
    // fmtNumber default precision = 2 → "42.50"
    expect(screen.getByText('42.50')).toBeInTheDocument()
  })

  it('renders sublabel verbatim when it is a non-empty string', () => {
    render(<MetricBar value={42.5} max={100} color="#22c55e" label="Power" sublabel="42.5 kW" />)
    expect(screen.getByText('42.5 kW')).toBeInTheDocument()
    // The auto-formatted value should NOT also appear.
    expect(screen.queryByText('42.50')).toBeNull()
  })

  it('renders an EMPTY sublabel verbatim — does NOT fall back to fmtNumber(value)', () => {
    // This is the regression: the bug rendered "0.00" for value=0
    // because sublabel="" was treated as "no sublabel".
    const { container } = render(
      <MetricBar value={0} max={100} color="#22c55e" label="Power" sublabel="" />,
    )
    expect(container.textContent).not.toMatch(/0\.00/)
    expect(screen.queryByText('0.00')).toBeNull()
  })

  it('renders the label even when sublabel is suppressed', () => {
    render(<MetricBar value={50} max={100} color="#22c55e" label="My Label" sublabel="" />)
    expect(screen.getByText('My Label')).toBeInTheDocument()
  })

  it('clamps the bar percentage to 100 when value > max (visual sanity)', () => {
    // No assertion failure expected — just verify rendering doesn't throw
    // and the formatted value (when no sublabel) is still shown.
    render(<MetricBar value={500} max={100} color="#22c55e" label="Over" />)
    expect(screen.getByText('500.00')).toBeInTheDocument()
  })
})
