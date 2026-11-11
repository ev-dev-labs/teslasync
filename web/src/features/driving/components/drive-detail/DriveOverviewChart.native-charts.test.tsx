import { cloneElement, type ReactElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { DriveOverviewChart } from './DriveOverviewChart';
import type { ChartDataPoint } from './types';
import type { DriveDetail } from '@/types/driving';

vi.mock('@/components/motion/ambient', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/motion/ambient')>(),
  prefersReducedMotion: () => true,
}));
vi.mock('@/components/charts', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/charts')>(),
  ResponsiveContainer: ({ children }: {
    children: ReactElement<{ width?: number; height?: number }>;
  }) => cloneElement(children, { width: 640, height: 360 }),
}));

function point(index: number, power: number | null): ChartDataPoint {
  return {
    time: `09:0${index}`, power, speed: index * 10, battery: 80 - index, elevation: 0,
    outsideTemp: null, insideTemp: null, driverTemp: null, passengerTemp: null,
    idealRange: 300 - index, ratedRange: null, estRange: null, odometer: null,
    soc: null, usableSoc: null, tireFl: null, tireFr: null, tireRl: null, tireRr: null,
    climateOn: null, fanStatus: null,
  };
}

describe('drive overview native chart composition', () => {
  it('zooms with the real keyboard brush while preserving axes, signed power, gaps and legend IDs', () => {
    const points = [point(0, -25), point(1, 0), point(2, null), point(3, 75), point(4, 25)];
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><DriveOverviewChart drive={{} as DriveDetail} chartData={points} /></MemoryRouter>
      </QueryClientProvider>,
    );
    const powerCurve = () => container.querySelectorAll('.recharts-line-curve')[2];
    expect(container.querySelector('.recharts-yAxis')).toHaveTextContent('-');
    expect(powerCurve()?.getAttribute('d')?.match(/M/g)).toHaveLength(2);
    expect(container.querySelector('.recharts-reference-line-line')).toBeInTheDocument();
    const powerToggle = screen.getByRole('button', { name: 'Power kW' });
    expect(powerToggle).toHaveAttribute('data-series-key', 'power');
    const travellers = screen.getAllByRole('slider');
    expect(travellers).toHaveLength(2);
    expect(container.querySelector('.recharts-xAxis')).toHaveTextContent('09:00');
    fireEvent.keyDown(travellers[0], { key: 'ArrowRight' });
    expect(container.querySelector('.recharts-xAxis')).not.toHaveTextContent('09:00');
    expect(container.querySelector('.recharts-xAxis')).toHaveTextContent('09:01');
    fireEvent.click(powerToggle);
    expect(powerToggle).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(2);
    fireEvent.click(powerToggle);
    expect(powerToggle).toHaveAttribute('aria-pressed', 'false');
    expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(3);
    expect(screen.getByRole('table', { name: /Sample statistics/ })).toHaveTextContent('Speed');
    expect(screen.getByRole('button', { name: 'Export chart' })).toBeInTheDocument();
    expect(points[0].power).toBe(-25);
    expect(points[2].power).toBeNull();
  });
});
