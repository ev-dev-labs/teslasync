import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { YearReview } from '@/api/types';
import type { HiddenSeriesState } from '@/hooks/useHiddenSeries';
import { Button } from '@/components/ui';
import { resolveChartPalette } from '@/hooks/useChartPalette';
import { YearMonthlyActivity } from './YearMonthlyActivity';

const state = vi.hoisted(() => ({
  preference: 'cb_safe',
  distance: 'km',
  locale: 'en-US',
  container: {} as Record<string, unknown>,
  series: {} as Record<string, Record<string, unknown>>,
  reduce: false,
}));

vi.mock('@/hooks/useChartPalette', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useChartPalette')>(),
  useChartPalette: () => resolveChartPalette(state.preference),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string | Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : String(fallback.defaultValue ?? key);
      return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String(typeof fallback === 'string' ? '' : fallback[name]));
    },
  }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: state.distance, locale: state.locale } }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtInt: (value: number) => String(Math.round(value)) }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: state.reduce }),
}));
vi.mock('@/components/layout/layout-reference', () => ({
  useCardPlacement: () => undefined,
  containerPolicy: () => ({ chartHeight: 300 }),
}));
vi.mock('@/components/charts', () => {
  const childrenOnly = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const series = (props: Record<string, unknown>) => {
    state.series[String(props.dataKey)] = props;
    return null;
  };
  return {
    ChartContainer: (props: Record<string, unknown> & { children?: ReactNode }) => {
      state.container = props;
      return <>{props.children}</>;
    },
    ComposedChart: childrenOnly,
    ResponsiveContainer: childrenOnly,
    ChartLegend: ({ state: hidden }: { state: HiddenSeriesState }) => <>
      <Button onClick={() => hidden.toggle('drives')}>Toggle drives</Button>
      <Button onClick={() => hidden.toggle('distance')}>Toggle distance</Button>
    </>,
    Bar: series,
    Line: series,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    ChartTooltip: () => null,
    chartGrid: null,
    axisTick: {},
  };
});

const data = {
  avg_drives_per_week: 2.5,
  monthly_stats: [
    { month: 6, drives: 13, distance_km: 14.75, energy_wh: 6125, cost: 8 },
    { month: 1, drives: 4, distance_km: 100.4, energy_wh: 25900, cost: 3 },
  ],
} as YearReview;

function Location() {
  return <output data-testid="location">{useLocation().search}</output>;
}

function chart(source: YearReview | undefined = data) {
  return <MemoryRouter initialEntries={['/?vehicle_id=7&hidden_year-monthly-chart=distance']}>
    <YearMonthlyActivity data={source} loading={false} onRetry={vi.fn()} emptyMessage="Empty year" />
    <Location />
  </MemoryRouter>;
}

beforeEach(() => {
  state.preference = 'cb_safe';
  state.distance = 'km';
  state.locale = 'en-US';
  state.reduce = false;
  state.container = {};
  state.series = {};
});

describe('monthly year-review saved palette', () => {
  it('updates colors without changing series identities, URL visibility or source/export values', () => {
    const original = structuredClone(data);
    const { rerender, unmount } = render(chart());
    expect(state.series.drives).toMatchObject({
      fill: resolveChartPalette('cb_safe')[0], dataKey: 'drives', yAxisId: 'left', hide: false,
    });
    expect(state.series.distance).toMatchObject({
      stroke: resolveChartPalette('cb_safe')[1], dataKey: 'distance', yAxisId: 'right', hide: true,
    });
    const rows = state.container.data;
    fireEvent.click(screen.getByRole('button', { name: 'Toggle drives' }));
    expect(state.series.drives.hide).toBe(true);
    const search = screen.getByTestId('location').textContent ?? '';
    expect(new URLSearchParams(search).get('hidden_year-monthly-chart')).toBe('distance,drives');
    expect(new URLSearchParams(search).get('vehicle_id')).toBe('7');

    state.preference = 'neon';
    rerender(chart());
    expect(state.series.drives).toMatchObject({ fill: resolveChartPalette('neon')[0], hide: true });
    expect(state.series.distance).toMatchObject({ stroke: resolveChartPalette('neon')[1], hide: true });
    expect(state.container.data).toBe(rows);
    expect(state.container).toMatchObject({
      chartKey: 'year-monthly-chart', exportable: true, exportFilename: 'year-review-monthly',
    });
    expect(screen.getByTestId('location')).toHaveTextContent(search);
    expect(data).toEqual(original);

    unmount();
    render(<MemoryRouter initialEntries={[`/${search}`]}>
      <YearMonthlyActivity data={data} loading={false} onRetry={vi.fn()} emptyMessage="Empty year" />
    </MemoryRouter>);
    expect(state.series.drives.hide).toBe(true);
    expect(state.series.distance.hide).toBe(true);
  });

  it.each([['km', 15, 100], ['mi', 9, 62]])(
    'preserves populated %s rows, ordering, rounding and the energy export column',
    (unit, juneDistance, januaryDistance) => {
      state.distance = unit;
      render(chart());
      expect(state.container.data).toEqual([
        { month: 'Jun', drives: 13, distance: juneDistance, energy: 6 },
        { month: 'Jan', drives: 4, distance: januaryDistance, energy: 26 },
      ]);
      expect(state.series.distance.name).toBe(`Distance (${unit})`);
      expect(state.container.dataColumns).toEqual([
        { key: 'month', label: 'Month' }, { key: 'drives', label: 'drives' },
        { key: 'distance', label: `Distance (${unit})` }, { key: 'energy', label: 'kWh' },
      ]);
      expect(state.series.drives.animationDuration).toBe(800);
    },
  );

  it('retains the empty frame and reduced-motion behavior', () => {
    state.reduce = true;
    render(chart({ ...data, monthly_stats: [] }));
    expect(state.container).toMatchObject({ empty: true, emptyMessage: 'Empty year', data: [] });
    expect(state.series.drives.animationDuration).toBe(0);
    expect(state.series.distance.animationDuration).toBe(0);
  });
});
