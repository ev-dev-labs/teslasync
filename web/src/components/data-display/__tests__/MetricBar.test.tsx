import type { CSSProperties, ReactNode } from 'react'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat'
import { MetricBar } from '../MetricBar'

interface FillProps {
  children?: ReactNode
  className?: string
  style?: CSSProperties
  initial?: false | { width: number }
  animate?: { width: string }
  transition?: { duration: number; ease: number[] }
}

const state = vi.hoisted(() => ({
  reduce: false,
  fill: vi.fn(),
  translate: vi.fn((_key: string, fallback: string) => fallback),
}))

vi.mock('@/components/motion', () => ({
  motion: {
    div: (props: FillProps) => {
      state.fill(props)
      return (
        <div
          className={props.className}
          style={{ ...props.style, width: props.animate?.width }}
        >{props.children}</div>
      )
    },
  },
}))

vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: state.reduce, durationMs: state.reduce ? 0 : 250 }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: state.translate }),
}))

beforeEach(() => {
  state.reduce = false
  state.fill.mockClear()
  state.translate.mockClear()
  setGlobalLocale('en-US')
  setGlobalPrecision(2)
})

afterEach(() => {
  cleanup()
  setGlobalLocale('en-US')
  setGlobalPrecision(2)
})

describe('MetricBar defaults and formatting', () => {
  it('preserves the header, height, gradient, supplied scale and animation', () => {
    render(<MetricBar value={42.5} max={250} color="#22c55e" label="Power" />)
    const bar = screen.getByRole('progressbar', { name: 'Power' })
    expect(screen.getByText('Power')).toHaveClass('text-[var(--text-secondary)]')
    expect(screen.getByText('42.50')).toHaveClass('font-mono', 'text-[var(--text-primary)]')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '250')
    expect(bar).toHaveAttribute('aria-valuenow', '42.5')
    expect(bar).not.toHaveAttribute('aria-valuetext')
    expect(bar.lastElementChild).toHaveClass('h-2.5')
    expect(state.fill).toHaveBeenLastCalledWith(expect.objectContaining({
      initial: { width: 0 },
      animate: { width: '17%' },
      transition: { duration: 0.25, ease: [0.2, 0, 0, 1] },
      style: { background: 'linear-gradient(90deg, #22c55e99, #22c55e)' },
    }))
  })

  it('preserves custom readouts and their neutral color', () => {
    render(<MetricBar value={42.5} max={100} color="#22c55e" label="Power" sublabel="42.5 kW" />)
    expect(screen.getByText('42.5 kW')).toHaveClass('text-[var(--text-primary)]')
    expect(screen.getByText('42.5 kW')).not.toHaveStyle({ color: '#22c55e' })
    expect(screen.queryByText('42.50')).not.toBeInTheDocument()
  })

  it('honors empty sublabels without hiding the label or fabricating a readout', () => {
    render(<MetricBar value={0} max={100} color="#22c55e" label="Power" sublabel="" />)
    expect(screen.queryByText('0.00')).not.toBeInTheDocument()
    expect(screen.getByText('Power')).toBeInTheDocument()
  })

  it('continues subscribing to caller formatting preferences', () => {
    render(<MetricBar value={42.5} max={100} color="#22c55e" label="Power" />)
    act(() => {
      setGlobalPrecision(3)
      setGlobalLocale('de-DE')
    })
    expect(screen.getByText('42,500')).toBeInTheDocument()
  })

  it('keeps long RTL labels and caller readouts complete in a wrapping header', () => {
    const label = 'استهلاك الطاقة'.repeat(12)
    const sublabel = 'A caller-provided explanation with a long identifier '.repeat(8)
    render(
      <div dir="rtl">
        <MetricBar value={12} max={24} color="var(--text-secondary)"
          label={label} sublabel={sublabel} fill="solid" />
      </div>,
    )
    const bar = screen.getByRole('progressbar', { name: label })
    expect(bar).toHaveClass('min-w-0')
    expect(bar.firstElementChild).toHaveClass('flex-wrap', 'gap-x-3', 'gap-y-1')
    const labelNode = bar.firstElementChild?.firstElementChild
    const readoutNode = bar.firstElementChild?.lastElementChild
    expect(labelNode?.textContent).toBe(label)
    expect(labelNode).toHaveClass('min-w-0', 'flex-1', 'break-words')
    expect(readoutNode?.textContent).toBe(sublabel)
    expect(readoutNode).toHaveClass('min-w-0', 'max-w-full', 'break-words', 'text-end')
    expect(bar).toHaveAttribute('aria-valuenow', '12')
    expect(bar).toHaveAttribute('aria-valuemax', '24')
    expect(state.fill).toHaveBeenLastCalledWith(expect.objectContaining({
      animate: { width: '50%' },
      style: { background: 'var(--text-secondary)' },
    }))
  })
})

describe('MetricBar compact passive presentation', () => {
  it('renders only a slim track with an independent accessible name', () => {
    const { container } = render(
      <MetricBar value={50} max={100} color="#22c55e" ariaLabel="Playback progress"
        showHeader={false} size="slim" />,
    )
    const bar = screen.getByRole('progressbar', { name: 'Playback progress' })
    expect(bar.textContent).toBe('')
    expect(bar.children).toHaveLength(1)
    expect(bar.firstElementChild).toHaveClass('h-1')
    expect(bar).not.toHaveAttribute('tabindex')
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(container.querySelector('button, input, select, textarea')).toBeNull()
  })

  it('retains the label as an accessible fallback when its header is hidden', () => {
    render(<MetricBar value={25} max={100} color="#22c55e" label="Pool usage" showHeader={false} />)
    expect(screen.getByRole('progressbar', { name: 'Pool usage' })).toHaveTextContent('')
    expect(screen.queryByText('Pool usage')).not.toBeInTheDocument()
    expect(screen.queryByText('25.00')).not.toBeInTheDocument()
  })

  it('can hide only the readout while independently naming the bar', () => {
    render(<MetricBar value={50} max={100} color="#22c55e" label="Remaining"
      ariaLabel="Trip progress" showValue={false} size="slim" />)
    expect(screen.getByText('Remaining')).toBeInTheDocument()
    expect(screen.queryByText('50.00')).not.toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Trip progress' })).toBeInTheDocument()
  })

  it('supports a readout without a visible label', () => {
    render(<MetricBar value={50} max={100} color="#22c55e" ariaLabel="Volume" />)
    expect(screen.getByRole('progressbar', { name: 'Volume' })).toHaveTextContent('50.00')
  })

  it('supports caller-prepared solid theme colors without changing the percentage', () => {
    render(<MetricBar value={12} max={24} color="var(--text-secondary)" label="Volume" fill="solid" />)
    expect(state.fill).toHaveBeenLastCalledWith(expect.objectContaining({
      animate: { width: '50%' },
      style: { background: 'var(--text-secondary)' },
    }))
  })

  it('preserves caller series color changes without reinterpreting the reading or scale', () => {
    const { rerender } = render(
      <MetricBar value={12} max={24} color="var(--theme-success)" label="Measured energy"
        sublabel="12 Wh / 24 Wh" fill="solid" />,
    )
    rerender(
      <MetricBar value={12} max={24} color="var(--theme-warning)" label="Measured energy"
        sublabel="12 Wh / 24 Wh" fill="solid" />,
    )
    const bar = screen.getByRole('progressbar', { name: 'Measured energy' })
    expect(bar).toHaveAttribute('aria-valuenow', '12')
    expect(bar).toHaveAttribute('aria-valuemax', '24')
    expect(screen.getByText('12 Wh / 24 Wh')).toBeInTheDocument()
    expect(state.fill).toHaveBeenLastCalledWith(expect.objectContaining({
      animate: { width: '50%' },
      style: { background: 'var(--theme-warning)' },
    }))
  })

  it('retains forced-colors track boundaries and a system fill without altering caller colors', () => {
    render(<MetricBar value={50} max={100} color="#22c55e" label="Power" />)
    const track = screen.getByRole('progressbar', { name: 'Power' }).lastElementChild
    expect(track).toHaveClass(
      'forced-colors:outline-1', 'forced-colors:outline-[CanvasText]',
      'forced-colors:!bg-[Canvas]', 'forced-colors:[forced-color-adjust:none]',
    )
    expect(state.fill).toHaveBeenLastCalledWith(expect.objectContaining({
      className: expect.stringContaining('forced-colors:!bg-[Highlight]'),
      style: { background: 'linear-gradient(90deg, #22c55e99, #22c55e)' },
    }))
  })
})

describe('MetricBar missing readings and supplied bounds', () => {
  it.each([null, undefined, NaN, Infinity, -Infinity])(
    'does not expose a zero reading or fill for %s',
    (value) => {
      render(<MetricBar value={value} max={100} color="#22c55e" label="Power" />)
      const bar = screen.getByRole('progressbar', { name: 'Power' })
      expect(bar).not.toHaveAttribute('aria-valuenow')
      expect(bar).toHaveAttribute('aria-valuetext', 'No reading')
      expect(bar).toHaveAttribute('aria-valuemax', '100')
      expect(screen.getByText('—')).toBeInTheDocument()
      expect(screen.queryByText('0.00')).not.toBeInTheDocument()
      expect(bar.lastElementChild?.children).toHaveLength(0)
      expect(state.fill).not.toHaveBeenCalled()
      expect(state.translate).toHaveBeenCalledWith('common.noReading', 'No reading')
    },
  )

  it('keeps an unavailable compact track accessible without printing a header', () => {
    render(<MetricBar value={null} max={100} color="#22c55e" ariaLabel="Pool usage"
      showHeader={false} size="slim" />)
    const bar = screen.getByRole('progressbar', { name: 'Pool usage' })
    expect(bar).toHaveAttribute('aria-valuetext', 'No reading')
    expect(bar).not.toHaveAttribute('aria-valuenow')
    expect(bar.textContent).toBe('')
    expect(state.fill).not.toHaveBeenCalled()
  })

  it('preserves caller-provided unavailable explanations without inventing a value', () => {
    render(<MetricBar value={null} max={100} color="#22c55e" label="Power" sublabel="Offline" />)
    expect(screen.getByText('Offline')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow')
    expect(state.fill).not.toHaveBeenCalled()
  })

  it.each([
    { value: 0, bounded: 0, width: '0%', text: '0.00' },
    { value: -10, bounded: 0, width: '0%', text: '-10.00' },
    { value: 100, bounded: 100, width: '100%', text: '100.00' },
    { value: 500, bounded: 100, width: '100%', text: '500.00' },
  ])('preserves the zero-based clamp and unbounded readout for $value', ({ value, bounded, width, text }) => {
    render(<MetricBar value={value} max={100} color="#22c55e" label="Power" />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuenow', String(bounded))
    expect(bar).not.toHaveAttribute('aria-valuetext')
    expect(screen.getByText(text)).toBeInTheDocument()
    expect(state.fill).toHaveBeenLastCalledWith(expect.objectContaining({ animate: { width } }))
  })

  it.each([0, -1, NaN, Infinity, -Infinity])(
    'preserves the existing degenerate maximum behavior for %s',
    (max) => {
      render(<MetricBar value={42.5} max={max} color="#22c55e" label="Power" />)
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '0')
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
      expect(screen.getByText('42.50')).toBeInTheDocument()
      expect(state.fill).toHaveBeenLastCalledWith(expect.objectContaining({ animate: { width: '0%' } }))
    },
  )

  it('updates from a known reading to missing and back to a genuine zero', () => {
    const props = { max: 100, color: '#22c55e', label: 'Power' }
    const { rerender } = render(<MetricBar {...props} value={50} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')
    rerender(<MetricBar {...props} value={null} />)
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow')
    expect(screen.getByRole('progressbar').lastElementChild?.children).toHaveLength(0)
    rerender(<MetricBar {...props} value={0} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuetext')
    expect(screen.getByText('0.00')).toBeInTheDocument()
  })
})

describe('MetricBar motion preference', () => {
  it('skips entrance and duration while preserving the target width for reduced motion', () => {
    state.reduce = true
    render(<MetricBar value={60} max={100} color="#22c55e" label="Power" size="slim" fill="solid" />)
    expect(state.fill).toHaveBeenLastCalledWith(expect.objectContaining({
      initial: false,
      animate: { width: '60%' },
      transition: { duration: 0, ease: [0.2, 0, 0, 1] },
    }))
  })
})
