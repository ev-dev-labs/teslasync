import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChartTooltipBase } from './ChartTooltip'

// useSettings → fmtNumber locale resolution path is exercised by the existing
// Format.test.tsx; here we only assert the tooltip's wiring & label heuristics.

describe('ChartTooltipBase', () => {
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
    // No crash; renders empty value cell
    expect(container.querySelector('[role="tooltip"]')).not.toBeNull()
  })
})
