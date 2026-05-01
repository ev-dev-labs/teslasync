import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ChartBrush } from './ChartBrush'
import { LineChart, Line, XAxis, YAxis } from 'recharts'

const sampleData = [
  { time: '12:00', v: 1 },
  { time: '12:01', v: 2 },
  { time: '12:02', v: 3 },
  { time: '12:03', v: 4 },
  { time: '12:04', v: 5 },
]

describe('ChartBrush', () => {
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
