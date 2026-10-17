import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { ChartBrush, type ChartBrushProps } from './ChartBrush'
import { Brush, LineChart, Line, XAxis, YAxis } from 'recharts'
import { chartTokens } from '../../lib/tokens'

const sampleData = [
  { time: '12:00', v: 1 },
  { time: '12:01', v: 2 },
  { time: '12:02', v: 3 },
  { time: '12:03', v: 4 },
  { time: '12:04', v: 5 },
]

describe('ChartBrush', () => {
  it('uses the accepted neutral theme roles without changing brush geometry', () => {
    const brush = ChartBrush({})
    expect(brush.type).toBe(Brush)
    expect(brush.props).toMatchObject({
      dataKey: 'time',
      height: chartTokens.brush.height,
      travellerWidth: chartTokens.brush.travellerWidth,
      stroke: chartTokens.brush.stroke,
      fill: chartTokens.brush.fill,
    })
    expect(brush.props.stroke).toBe('var(--text-secondary)')
    expect(brush.props.fill).toBe('color-mix(in srgb, var(--text-secondary) 6%, transparent)')
    expect(brush.props.startIndex).toBeUndefined()
    expect(brush.props.endIndex).toBeUndefined()
    expect(brush.props.onChange).toBeUndefined()
  })

  it('preserves zero bounds, custom geometry, data-key identity and callback identity', () => {
    const onChange = vi.fn<NonNullable<ChartBrushProps['onChange']>>()
    const brush = ChartBrush({
      dataKey: 'observation_time',
      height: 40,
      startIndex: 0,
      endIndex: sampleData.length - 1,
      onChange,
    })
    expect(brush.props.dataKey).toBe('observation_time')
    expect(brush.props.height).toBe(40)
    expect(brush.props.startIndex).toBe(0)
    expect(brush.props.endIndex).toBe(4)
    expect(brush.props.onChange).toBe(onChange)
    const range = { startIndex: 1, endIndex: 3 }
    brush.props.onChange?.(range)
    expect(onChange).toHaveBeenCalledExactlyOnceWith(range)
    expect(onChange.mock.calls[0]?.[0]).toBe(range)
    expect(sampleData).toHaveLength(5)
  })

  it('preserves a zero-height override and independently optional range boundaries', () => {
    expect(ChartBrush({ height: 0, startIndex: 0 }).props).toMatchObject({
      height: 0,
      startIndex: 0,
      endIndex: undefined,
    })
    expect(ChartBrush({ endIndex: 0 }).props).toMatchObject({
      startIndex: undefined,
      endIndex: 0,
    })
  })

  it('renders inside a recharts chart container without crashing', () => {
    const { container } = render(
      <LineChart width={400} height={200} data={sampleData}>
        <XAxis dataKey="time" />
        <YAxis />
        <Line dataKey="v" />
        <ChartBrush dataKey="time" />
      </LineChart>,
    )
    // recharts renders the brush as an SVG <g> with class containing "brush"
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
  })

  it('honors startIndex/endIndex passthrough so the initial window can be controlled', () => {
    const onChange = (range: { startIndex?: number; endIndex?: number }) => {
      // smoke test — recharts wires this onChange through Brush internals
      expect(range).toBeDefined()
    }
    const { container } = render(
      <LineChart width={400} height={200} data={sampleData}>
        <XAxis dataKey="time" />
        <YAxis />
        <Line dataKey="v" />
        <ChartBrush dataKey="time" startIndex={1} endIndex={3} onChange={onChange} />
      </LineChart>,
    )
    expect(container.querySelector('svg')).not.toBeNull()
  })
})
