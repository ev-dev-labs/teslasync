import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  Area, Bar, Brush, CartesianGrid, Cell, ChartLegend, ComposedChart, Line,
  Pie, PieChart, PolarAngleAxis, PolarGrid, Radar, RadarChart, ReferenceLine,
  Scatter, ScatterChart, XAxis, YAxis,
} from '../index';

const observations = [
  { sample: 0, power: -25, energy: 0 },
  { sample: 1, power: 0, energy: 8 },
  { sample: 2, power: null, energy: 16 },
  { sample: 3, power: 75, energy: 24 },
  { sample: 4, power: 25, energy: 32 },
];
const seriesColors = { power: '#d4664a', energy: '#63a6b0', reference: '#caad7d' };

describe('shared chart child parsing and source preservation', () => {
  it('renders the original mixed series, null gap, axes, annotation and native brush through the barrel', () => {
    const { container } = render(
      <ComposedChart width={600} height={320} data={observations}>
        <CartesianGrid />
        <XAxis type="number" dataKey="sample" domain={[0, 4]} />
        <YAxis domain={[-50, 100]} />
        <Area dataKey="energy" fill={seriesColors.energy} fillOpacity={0.08} isAnimationActive={false} />
        <Bar dataKey="energy" fill={seriesColors.energy} isAnimationActive={false} />
        <Line dataKey="power" type="linear" connectNulls={false} stroke={seriesColors.power} isAnimationActive={false} />
        <ReferenceLine y={0} stroke={seriesColors.reference} label="Zero power" />
        <Brush dataKey="sample" height={28} startIndex={0} endIndex={4} />
      </ComposedChart>,
    );
    const line = container.querySelector('.recharts-line-curve');
    expect(line).toHaveAttribute('stroke', seriesColors.power);
    expect(line?.getAttribute('d')?.match(/M/g)).toHaveLength(2);
    expect(container.querySelector('.recharts-area-area')).toHaveAttribute('fill', seriesColors.energy);
    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(5);
    expect(container.querySelectorAll('.recharts-brush-traveller')).toHaveLength(2);
    expect(container.querySelector('.recharts-reference-line-line')).toHaveAttribute('stroke', seriesColors.reference);
    expect(screen.getByText('Zero power')).toBeInTheDocument();
    expect(container.querySelector('.recharts-yAxis')).toHaveTextContent('-50');
    expect(container.querySelector('.recharts-yAxis')).toHaveTextContent('100');
    expect(observations[2].power).toBeNull();
  });

  it('retains the discoverable shared legend, stable toggle IDs and native hidden-series behavior', () => {
    function ToggleChart() {
      const [hidden, setHidden] = useState(false);
      return (
        <ComposedChart width={600} height={320} data={observations}>
          <XAxis dataKey="sample" />
          <YAxis />
          <Line dataKey="power" name="Signed power" stroke={seriesColors.power} hide={hidden} isAnimationActive={false} />
          <Area dataKey="energy" name="Energy" fill={seriesColors.energy} isAnimationActive={false} />
          <ChartLegend state={{ isHidden: key => key === 'power' && hidden, toggle: key => {
            if (key === 'power') setHidden(value => !value);
          } }} />
        </ComposedChart>
      );
    }
    const { container } = render(<ToggleChart />);
    const toggle = screen.getByRole('button', { name: 'Signed power' });
    expect(toggle).toHaveAttribute('data-series-key', 'power');
    expect(toggle.closest('[data-app-part~="chart-legend"]')).not.toBeNull();
    expect(container.querySelector('.recharts-line-curve')).not.toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('.recharts-line-curve')).toBeNull();
    expect(container.querySelector('.recharts-area-area')).not.toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(container.querySelector('.recharts-line-curve')).toHaveAttribute('stroke', seriesColors.power);
  });

  it('keeps sector values and per-cell colors, scatter coordinates and radar primitives discoverable', () => {
    const sectors = [{ name: 'A', value: 25 }, { name: 'B', value: 75 }];
    const { container } = render(
      <>
        <PieChart width={320} height={240}>
          <Pie data={sectors} dataKey="value" innerRadius={45} outerRadius={80} isAnimationActive={false}>
            <Cell fill={seriesColors.power} />
            <Cell fill={seriesColors.energy} />
          </Pie>
        </PieChart>
        <ScatterChart width={320} height={240}>
          <XAxis type="number" dataKey="sample" domain={[0, 4]} />
          <YAxis type="number" dataKey="power" domain={[-50, 100]} />
          <Scatter data={observations.filter(point => point.power != null)} fill={seriesColors.power} isAnimationActive={false} />
        </ScatterChart>
        <RadarChart width={320} height={240} data={sectors}>
          <PolarGrid />
          <PolarAngleAxis dataKey="name" />
          <Radar dataKey="value" fill={seriesColors.energy} stroke={seriesColors.energy} isAnimationActive={false} />
        </RadarChart>
      </>,
    );
    expect([...container.querySelectorAll('.recharts-pie-sector .recharts-sector')].map(path => path.getAttribute('fill')))
      .toEqual([seriesColors.power, seriesColors.energy]);
    expect(container.querySelectorAll('.recharts-scatter-symbol')).toHaveLength(4);
    expect(container.querySelector('.recharts-radar-polygon')).not.toBeNull();
    expect(container.querySelector('.recharts-polar-grid')).not.toBeNull();
  });
});
