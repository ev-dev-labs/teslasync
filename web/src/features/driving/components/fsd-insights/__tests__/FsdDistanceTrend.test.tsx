/**
 * FsdDistanceTrend — the chart must not draw a measurement that does not exist.
 *
 * The regression this guards: a vehicle that streams MilesSinceReset but never
 * emits SelfDrivingMilesSinceReset used to render a full row of zero-height
 * self-driving bars and an export/SR table full of `0.0 km`, which reads as
 * "the car drove itself zero metres" rather than "the counter said nothing".
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

const { unitsMock } = vi.hoisted(() => ({ unitsMock: vi.fn() }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => unitsMock() }));

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, opts?: unknown) => {
        const template = typeof fallback === 'string' ? fallback : key;
        const vars = (opts && typeof opts === 'object' ? opts : undefined) as
          | Record<string, unknown>
          | undefined;
        if (!vars) return template;
        return template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        );
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// The chart frame is exercised elsewhere; here we only care about the rows and
// the gating decision, so capture what the container is handed.
const { chartPropsMock, linePropsMock } = vi.hoisted(() => ({
  chartPropsMock: vi.fn(),
  linePropsMock: vi.fn(),
}));
vi.mock('@/components/charts', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  type ChildArgs = { hiddenSeries: null };
  return {
    ChartContainer: (props: Record<string, unknown> & { children: (a: ChildArgs) => ReactNode }) => {
      chartPropsMock(props);
      return React.createElement(
        'section',
        { 'data-testid': 'chart-container' },
        props.children({ hiddenSeries: null }),
      );
    },
    ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    ComposedChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Bar: () => <div data-testid="bar-series" />,
    Line: (props: Record<string, unknown>) => {
      linePropsMock(props);
      return <div data-testid="line-series" />;
    },
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    ChartLegend: () => null,
    ChartTooltip: () => null,
    CHART_COLORS: ['#0ff', '#f0f', '#ff0'],
    axisTick: {},
    chartGrid: null,
  };
});

import { FsdDistanceTrend, type FsdDistanceRow } from '../FsdDistanceTrend';
import { fsdDrivingOnlyInsights, fsdInsights } from './fixtures';
import type { FsdSectionState } from '../types';

function state(overrides: Partial<FsdSectionState> = {}): FsdSectionState {
  return { isLoading: false, error: null, onRetry: vi.fn(), noVehicle: false, ...overrides };
}

function renderTrend(node: ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

/** Rows the container was handed on the most recent render. */
function lastRows(): FsdDistanceRow[] {
  const props = chartPropsMock.mock.calls.at(-1)?.[0] as { data: FsdDistanceRow[] };
  return props.data;
}

beforeEach(() => {
  vi.clearAllMocks();
  unitsMock.mockReturnValue({
    unitPrefs: {
      distance: 'km',
      speed: 'km/h',
      temperature: '°C',
      pressure: 'kPa',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
    },
    formatDistance: () => '',
    formatSpeed: () => '',
    formatTemperature: () => '',
    formatPressure: () => '',
    formatEnergy: () => '',
    formatDuration: () => '',
    formatPower: () => '',
  });
});

describe('FsdDistanceTrend', () => {
  it('converts measured metres to the display unit and keeps unmeasured days null', () => {
    renderTrend(<FsdDistanceTrend insights={fsdInsights()} state={state()} />);

    const rows = lastRows();
    expect(rows).toHaveLength(3);
    // 4 023.36 m → 4.02336 km
    expect(rows[0].fsd).toBeCloseTo(4.02336, 5);
    expect(rows[1].fsd).toBeCloseTo(8.04672, 5);
    // Day three reported nothing — a gap, not a zero.
    expect(rows[2].fsd).toBeNull();
    expect(rows[2].driving).toBeNull();
    expect(screen.getByTestId('bar-series')).toBeInTheDocument();
    const lineProps = linePropsMock.mock.calls.at(-1)?.[0] as {
      dot: unknown;
      connectNulls: boolean;
    };
    expect(lineProps.dot).not.toBe(false);
    expect(lineProps.connectNulls).toBe(false);
  });

  it('plots nothing and explains why when the self-driving counter never reported', () => {
    renderTrend(<FsdDistanceTrend insights={fsdDrivingOnlyInsights()} state={state()} />);

    const rows = lastRows();
    expect(rows.every((row) => row.fsd === null)).toBe(true);
    // Driving telemetry exists — that must NOT be enough to claim a series.
    expect(rows.some((row) => row.driving != null)).toBe(true);
    expect(screen.queryByTestId('bar-series')).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'The supervised self-driving counter did not report a measurable distance in this period.',
      ),
    ).toBeInTheDocument();
  });

  it('still plots a period whose only measurement is a real zero', () => {
    const base = fsdInsights();
    const insights = fsdInsights({
      daily: base.daily.map((day) => ({
        ...day,
        fsd_distance_m: day.has_counter_observation ? 0 : null,
      })),
    });

    renderTrend(<FsdDistanceTrend insights={insights} state={state()} />);

    expect(screen.getByTestId('bar-series')).toBeInTheDocument();
    expect(lastRows().filter((row) => row.fsd === 0)).toHaveLength(2);
  });

  it('labels an unmeasured cell in the accessible table as "Not reported"', () => {
    renderTrend(<FsdDistanceTrend insights={fsdInsights()} state={state()} />);

    const props = chartPropsMock.mock.calls.at(-1)?.[0] as {
      dataColumns: { key: string; format?: (v: unknown) => string }[];
    };
    const fsdColumn = props.dataColumns.find((column) => column.key === 'fsd');
    expect(fsdColumn?.format?.(null)).toBe('Not reported');
    expect(fsdColumn?.format?.(4.02336)).toBe('4.0 km');
  });

  it('keeps the frame mounted with a recovery CTA when no vehicle is selected', () => {
    renderTrend(<FsdDistanceTrend insights={undefined} state={state({ noVehicle: true })} />);

    expect(screen.getByTestId('fsd-distance-trend')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Choose a vehicle' })).toHaveAttribute(
      'href',
      '/vehicles',
    );
  });
});
