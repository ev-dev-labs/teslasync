/**
 * MetricCard — behaviour, branch, a11y and null-safety coverage.
 *
 * MetricCard is a pure presentational card. We isolate it from its `<Delta>`
 * child (which owns its own suite) by mocking `./Delta` with a spy, so we can
 * assert the *current-value derivation* MetricCard performs before delegating,
 * without dragging in Delta's settings/i18n/number-format graph. The real
 * `<HelpTooltip>` is kept so the accessible-name and keyboard-focus contract
 * is exercised end-to-end.
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MetricCard } from './MetricCard'

// Capture the props MetricCard forwards to <Delta>. Returning a plain string
// keeps the mock JSX-free (safe inside a hoisted factory) while still giving
// us a text marker to assert on.
const { deltaSpy } = vi.hoisted(() => ({ deltaSpy: vi.fn() }))
vi.mock('./Delta', () => ({
  Delta: (props: Record<string, unknown>) => {
    deltaSpy(props)
    return `delta[current=${String(props.current)}]`
  },
}))

// Deterministic translator: returns the English fallback with `{{label}}`
// interpolated so we can assert the exact aria-label MetricCard builds.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, second?: unknown, third?: Record<string, unknown>) => {
      let tpl = ''
      let opts: Record<string, unknown> | undefined
      if (typeof second === 'string') {
        tpl = second
        opts = third
      } else if (second && typeof second === 'object') {
        const o = second as Record<string, unknown>
        tpl = typeof o.defaultValue === 'string' ? o.defaultValue : ''
        opts = o
      }
      if (!opts) return tpl
      return Object.entries(opts).reduce(
        (acc, [k, v]) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v)),
        tpl,
      )
    },
  }),
}))

beforeEach(() => {
  deltaSpy.mockClear()
})

describe('MetricCard — label + value', () => {
  it('renders the label and a string value', () => {
    render(<MetricCard label="Battery Health" value="87%" />)
    expect(screen.getByText('Battery Health')).toBeInTheDocument()
    expect(screen.getByText('87%')).toBeInTheDocument()
  })

  it('renders a numeric value', () => {
    render(<MetricCard label="Drives" value={4} />)
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('shows the subtitle only when provided', () => {
    const { rerender } = render(
      <MetricCard label="Range" value="240 mi" subtitle="rated range" />,
    )
    expect(screen.getByText('rated range')).toBeInTheDocument()

    rerender(<MetricCard label="Range" value="240 mi" />)
    expect(screen.queryByText('rated range')).not.toBeInTheDocument()
  })

  it('merges a custom className onto the root card', () => {
    const { container } = render(<MetricCard label="X" value="1" className="my-custom-card" />)
    const root = container.firstChild as HTMLElement
    expect(root).toHaveClass('my-custom-card')
    expect(root).toHaveAttribute('data-role', 'metric-card')
  })
})

describe('MetricCard — icon + colour', () => {
  it('renders the icon inside a neutral surface with the cyan semantic color', () => {
    render(<MetricCard label="X" value="1" icon={<svg data-testid="ic" />} />)
    const inner = screen.getByTestId('ic').parentElement as HTMLElement
    const box = inner.parentElement as HTMLElement
    expect(box).toHaveAttribute('data-role', 'metric-icon')
    expect(box).toHaveAttribute('data-color', 'cyan')
    expect(box.className).toContain('bg-[var(--surface-2)]')
    expect(box.className).toContain('border-[var(--border-default)]')
    expect(inner).toHaveClass('text-cyan-300')
  })

  it('applies the requested colour variant', () => {
    render(<MetricCard label="X" value="1" color="green" icon={<svg data-testid="ic" />} />)
    const inner = screen.getByTestId('ic').parentElement as HTMLElement
    const box = inner.parentElement as HTMLElement
    expect(box).toHaveAttribute('data-color', 'green')
    expect(box.className).toContain('bg-[var(--surface-2)]')
    expect(inner).toHaveClass('text-emerald-300')
  })

  it('falls back to cyan for an unregistered colour instead of crashing', () => {
    render(
      <MetricCard
        label="X"
        value="1"
        color={'chartreuse' as never}
        icon={<svg data-testid="ic" />}
      />,
    )
    const inner = screen.getByTestId('ic').parentElement as HTMLElement
    expect(inner.className).toContain('text-cyan-300')
  })

  it('omits the icon box when no icon is passed', () => {
    const { container } = render(<MetricCard label="X" value="1" />)
    expect(container.querySelector('svg')).toBeNull()
  })
})

describe('MetricCard — legacy change pill', () => {
  it('renders a positive change in emerald with an up arrow', () => {
    const { container } = render(
      <MetricCard label="X" value="1" change={{ value: '5%', positive: true }} />,
    )
    const pill = container.querySelector('.text-emerald-300') as HTMLElement
    expect(pill).not.toBeNull()
    expect(pill.textContent).toContain('↑')
    expect(pill.textContent).toContain('5%')
    expect(container.querySelector('.text-rose-300')).toBeNull()
  })

  it('renders a negative change in rose with a down arrow', () => {
    const { container } = render(
      <MetricCard label="X" value="1" change={{ value: '3%', positive: false }} />,
    )
    const pill = container.querySelector('.text-rose-300') as HTMLElement
    expect(pill.textContent).toContain('↓')
    expect(pill.textContent).toContain('3%')
    expect(container.querySelector('.text-emerald-300')).toBeNull()
  })

  it('hides the change pill and renders the delta when both are supplied', () => {
    const { container } = render(
      <MetricCard
        label="X"
        value={10}
        change={{ value: '5%', positive: true }}
        delta={{ metric: 'range', previous: 8 }}
      />,
    )
    // change pill (emerald) is suppressed; the delta takes precedence.
    expect(container.querySelector('.text-emerald-300')).toBeNull()
    expect(container.textContent).toContain('delta[')
    expect(deltaSpy).toHaveBeenCalled()
  })
})

describe('MetricCard — delta current derivation', () => {
  it('passes a numeric value straight through as current', () => {
    render(<MetricCard label="Range" value={280} delta={{ metric: 'range', previous: 250 }} />)
    expect(deltaSpy).toHaveBeenCalledWith(
      expect.objectContaining({ current: 280, metric: 'range', previous: 250 }),
    )
  })

  it('parses a plain numeric string value into current', () => {
    render(<MetricCard label="Range" value="46.1" delta={{ metric: 'distance', previous: 40 }} />)
    expect(deltaSpy).toHaveBeenCalledWith(expect.objectContaining({ current: 46.1 }))
  })

  it('yields a null current for a unit-bearing string value', () => {
    render(<MetricCard label="Range" value="280 mi" delta={{ metric: 'range', previous: 250 }} />)
    expect(deltaSpy).toHaveBeenCalledWith(expect.objectContaining({ current: null }))
  })

  it('lets an explicit delta.current override the derived value', () => {
    render(
      <MetricCard
        label="Range"
        value={280}
        delta={{ metric: 'range', previous: 250, current: 999 }}
      />,
    )
    expect(deltaSpy).toHaveBeenCalledWith(expect.objectContaining({ current: 999 }))
  })
})

describe('MetricCard — help tooltip (a11y + i18n)', () => {
  it('builds an accessible name from the label when none is given', () => {
    render(<MetricCard label="Vampire Drain" value="1" help={{ text: 'Overnight battery loss' }} />)
    expect(
      screen.getByRole('button', { name: 'More info about Vampire Drain' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Overnight battery loss')).toBeInTheDocument()
  })

  it('prefers an explicit help.ariaLabel over the derived one', () => {
    render(
      <MetricCard label="Vampire Drain" value="1" help={{ text: 'x', ariaLabel: 'Custom label' }} />,
    )
    expect(screen.getByRole('button', { name: 'Custom label' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /more info about/i })).not.toBeInTheDocument()
  })

  it('renders no tooltip trigger when help is omitted', () => {
    render(<MetricCard label="X" value="1" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('exposes the help trigger as a focusable, enabled control', () => {
    render(<MetricCard label="Idle Time" value="2h" help={{ text: 'Time parked awake' }} />)
    const trigger = screen.getByRole('button', { name: 'More info about Idle Time' })
    // A real, enabled <button> is a native keyboard tab stop.
    expect(trigger).not.toBeDisabled()
    expect(trigger).not.toHaveFocus()
    trigger.focus()
    expect(trigger).toHaveFocus()
  })
})
