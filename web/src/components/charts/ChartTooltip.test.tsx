import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { ChartTooltip, ChartTooltipBase } from './ChartTooltip'
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat'
import { useNumberFormatting } from '@/hooks/useNumberFormatting'

// useSettings → fmtNumber locale resolution path is exercised by the existing
// Format.test.tsx; here we only assert the tooltip's wiring & label heuristics.

describe('ChartTooltipBase', () => {
  it('uses neutral elevation and wrapping without changing series order or supplied colors', () => {
    setGlobalLocale('en-US')
    const longName = 'VeryLongUnbrokenSignalIdentity'.repeat(12)
    const longLabel = 'Long timestamp context '.repeat(16).trim()
    const payload = [
      { name: longName, value: 0, color: '#385e7e', fill: '#83464e', unit: 'W' },
      { dataKey: 'fallback-series', value: -12.5, fill: '#38614f' },
    ]
    render(<ChartTooltipBase active label={longLabel} payload={payload} precision={2} />)
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveClass('rounded-panel', 'shadow-e2', 'max-w-tooltip-viewport')
    expect(tooltip.className).not.toMatch(/backdrop-blur|shadow-\[/)
    expect(screen.getByText(longLabel)).toHaveClass('break-words')
    const names = [screen.getByText(`${longName}:`), screen.getByText('fallback-series:')]
    expect(names.map((name) => name.textContent)).toEqual([`${longName}:`, 'fallback-series:'])
    expect(names[0]).toHaveClass('break-words', 'min-w-0')
    expect(names[0].parentElement).toHaveClass('flex-wrap')
    const swatches = tooltip.querySelectorAll('[aria-hidden="true"]')
    expect(swatches[0]).toHaveStyle({ backgroundColor: '#385e7e' })
    expect(swatches[1]).toHaveStyle({ backgroundColor: '#38614f' })
    expect(swatches[0]).toHaveClass('shrink-0')
    expect(screen.getByText('W')).toHaveClass('ms-0.5')
    expect(screen.getByText('0.00')).toBeInTheDocument()
    expect(screen.getByText('-12.50')).toBeInTheDocument()
  })

  it('keeps zero and valid negative measurements distinct from every missing or nonfinite value', () => {
    setGlobalLocale('en-US')
    render(<ChartTooltipBase active precision={2} payload={[
      { name: 'zero', value: 0 },
      { name: 'negative', value: -4.5 },
      { name: 'null', value: null },
      { name: 'undefined', value: undefined },
      { name: 'nan', value: Number.NaN },
      { name: 'infinite', value: Number.POSITIVE_INFINITY },
    ]} />)
    expect(screen.getByText('0.00')).toBeInTheDocument()
    expect(screen.getByText('-4.50')).toBeInTheDocument()
    expect(screen.getAllByText('—')).toHaveLength(4)
  })

  it('preserves raw formatter inputs and valueFormatter precedence with rich content', () => {
    const payload = [{ name: 'Power', value: 0, unit: 'W', color: '#385e7e' }]
    const formatter = vi.fn(() => 'unused')
    const valueFormatter = vi.fn((value: unknown, name: string, unit?: string) => (
      <strong>{`${name} ${String(value)} ${unit}`}</strong>
    ))
    const labelFormatter = vi.fn(() => <em>Sample context</em>)
    render(<ChartTooltipBase active label="raw" payload={payload}
      valueFormatter={valueFormatter} formatter={formatter} labelFormatter={labelFormatter} />)
    expect(valueFormatter).toHaveBeenCalledWith(0, 'Power', 'W')
    expect(labelFormatter).toHaveBeenCalledWith('raw', payload)
    expect(formatter).not.toHaveBeenCalled()
    expect(screen.getByText('Power 0 W').tagName).toBe('STRONG')
    expect(screen.getByText('Sample context').tagName).toBe('EM')
    expect(payload).toEqual([{ name: 'Power', value: 0, unit: 'W', color: '#385e7e' }])
  })

  it('refreshes memoized mounted tooltip values while retaining clocks, strings, counts and missing data', () => {
    setGlobalLocale('en-US')
    setGlobalPrecision(2)
    function CountTooltip() {
      const { fmtInt } = useNumberFormatting()
      return <ChartTooltip active payload={[{ name: 'count', value: 1234 }]} valueFormatter={(value) => fmtInt(value)} />
    }
    render(
      <>
        <ChartTooltip active label="14:25" payload={[
          { name: 'reading', value: 12.3456, unit: 'V' },
          { name: 'formatted', value: '03:04' },
          { name: 'missing', value: null },
        ]} />
        <ChartTooltip active precision={1} payload={[{ name: 'override', value: 2.3456 }]} />
        <CountTooltip />
      </>,
    )
    expect(screen.getByText('12.35')).toBeInTheDocument()
    act(() => setGlobalPrecision(3))
    expect(screen.getByText('12.346')).toBeInTheDocument()
    expect(screen.getByText('1,234')).toBeInTheDocument()
    expect(screen.getByText('2.3')).toBeInTheDocument()
    expect(screen.getByText('14:25')).toBeInTheDocument()
    expect(screen.getByText('03:04')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    act(() => setGlobalLocale('de-DE'))
    expect(screen.getByText('12,346')).toBeInTheDocument()
    expect(screen.getByText('1.234')).toBeInTheDocument()
    act(() => {
      setGlobalPrecision(2)
      setGlobalLocale('en-US')
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders nothing when not active', () => {
    const { container } = render(<ChartTooltipBase active={false} payload={[{ name: 'x', value: 1 }]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when payload is empty', () => {
    const { container } = render(<ChartTooltipBase active={true} payload={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders payload entries with name + value', () => {
    render(
      <ChartTooltipBase
        active={true}
        label="12:34"
        payload={[
          { name: 'Speed', value: 65, color: '#3b82f6', unit: 'km/h' },
          { name: 'Power', value: 12.5, color: '#f59e0b', unit: 'kW' },
        ]}
      />,
    )
    expect(screen.getByText('Speed:')).toBeInTheDocument()
    expect(screen.getByText('Power:')).toBeInTheDocument()
    expect(screen.getByText('12:34')).toBeInTheDocument()
    // numbers go through fmtNumber → "65.0" / "12.5" by default
    expect(screen.getByText(/65/)).toBeInTheDocument()
    expect(screen.getByText(/12\.5/)).toBeInTheDocument()
  })

  it('passes through pre-formatted string labels (e.g., "HH:MM") unchanged', () => {
    render(
      <ChartTooltipBase
        active={true}
        label="14:25"
        payload={[{ name: 'x', value: 1 }]}
      />,
    )
    expect(screen.getByText('14:25')).toBeInTheDocument()
  })

  it('auto-formats ISO timestamp labels via formatDateTime', () => {
    render(
      <ChartTooltipBase
        active={true}
        label="2026-04-30T13:30:15Z"
        payload={[{ name: 'x', value: 1 }]}
      />,
    )
    // formatDateTime renders something like "Apr 30, 2026, 06:30 AM" — exact
    // output depends on test runner's timezone, so just assert it's not the
    // raw ISO string.
    expect(screen.queryByText('2026-04-30T13:30:15Z')).toBeNull()
    expect(screen.getByText(/2026/)).toBeInTheDocument()
  })

  it('passes an explicit vehicle timezone and precision to shared formatters', () => {
    render(
      <ChartTooltipBase
        active={true}
        label="2026-04-30T13:30:15Z"
        timezone="America/Los_Angeles"
        precision={2}
        payload={[{ name: 'speed', value: 65.678, unit: 'km/h' }]}
      />,
    )
    expect(screen.getByText(/65\.68/)).toBeInTheDocument()
    expect(screen.queryByText('2026-04-30T13:30:15Z')).toBeNull()
  })

  it('falls back to the browser zone when an IANA timezone is invalid', () => {
    expect(() => render(
      <ChartTooltipBase
        active={true}
        label="2026-04-30T13:30:15Z"
        timezone="Mars/Olympus_Mons"
        payload={[{ name: 'speed', value: 65 }]}
      />,
    )).not.toThrow()
    expect(screen.queryByText('2026-04-30T13:30:15Z')).toBeNull()
  })

  it('leaves default number precision to the shared user formatting policy', () => {
    render(
      <ChartTooltipBase active={true} label="x" payload={[{ name: 'speed', value: 65.678 }]} />,
    )
    expect(screen.getByText('65.68')).toBeInTheDocument()
  })

  it('honors custom valueFormatter', () => {
    render(
      <ChartTooltipBase
        active={true}
        label="x"
        payload={[{ name: 'temp', value: 21.4, unit: '°C' }]}
        valueFormatter={(v, n, u) => `<<${n}=${v}${u ?? ''}>>`}
      />,
    )
    expect(screen.getByText('<<temp=21.4°C>>')).toBeInTheDocument()
  })

  it('honors custom labelFormatter', () => {
    render(
      <ChartTooltipBase
        active={true}
        label="2026-04-30T13:30:15Z"
        payload={[{ name: 'x', value: 1 }]}
        labelFormatter={(l) => `RAW:${l}`}
      />,
    )
    expect(screen.getByText('RAW:2026-04-30T13:30:15Z')).toBeInTheDocument()
  })

  it('honors the formatter prop Recharts injects into custom tooltip content', () => {
    const formatter = vi.fn(() => ['65 km/h', 'Road speed'] as const)
    const payload = [{ name: 'speed', value: 65, unit: 'km/h' }]

    render(
      <ChartTooltipBase
        active={true}
        label="x"
        payload={payload}
        formatter={formatter}
      />,
    )

    expect(screen.getByText('Road speed:')).toBeInTheDocument()
    expect(screen.getByText('65 km/h')).toBeInTheDocument()
    expect(formatter).toHaveBeenCalledWith(65, 'speed', payload[0], 0, payload)
  })

  it('passes the payload to a Recharts-compatible label formatter', () => {
    const labelFormatter = vi.fn((tooltipLabel: string | number | undefined) => `Sample ${tooltipLabel}`)
    const payload = [{ name: 'speed', value: 65 }]

    render(
      <ChartTooltipBase
        active={true}
        label="12:34"
        payload={payload}
        labelFormatter={labelFormatter}
      />,
    )

    expect(screen.getByText('Sample 12:34')).toBeInTheDocument()
    expect(labelFormatter).toHaveBeenCalledWith('12:34', payload)
  })

  it('renders the unit suffix from default formatter when provided', () => {
    render(
      <ChartTooltipBase
        active={true}
        label="x"
        payload={[{ name: 'spd', value: 65, unit: 'km/h' }]}
      />,
    )
    expect(screen.getByText('km/h')).toBeInTheDocument()
  })

  it('handles non-numeric values via String coercion', () => {
    render(
      <ChartTooltipBase
        active={true}
        label="x"
        payload={[{ name: 'state', value: 'driving' }]}
      />,
    )
    expect(screen.getByText('driving')).toBeInTheDocument()
  })

  it('handles null/undefined values gracefully', () => {
    const { container } = render(
      <ChartTooltipBase
        active={true}
        label="x"
        payload={[{ name: 'state', value: null }]}
      />,
    )
    // No crash; missingness remains explicit instead of becoming a fabricated zero.
    expect(container.querySelector('[role="tooltip"]')).not.toBeNull()
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
