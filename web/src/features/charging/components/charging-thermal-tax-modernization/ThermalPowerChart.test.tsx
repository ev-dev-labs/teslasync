import { type ComponentProps, type PropsWithChildren } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartContainer, ChartLegend } from '@/components/charts';
import { deriveDataState } from '@/api/dataState';
import { chartTokens } from '@/lib/tokens';
import { ThermalPowerChart } from './ThermalPowerChart';

const captured = vi.hoisted(() => ({
  container: vi.fn(),
  composed: vi.fn(),
  responsive: vi.fn(),
  area: vi.fn(),
  line: vi.fn(),
  legend: vi.fn(),
  hidden: {
    isHidden: vi.fn((key: string) => key === 'heaterW'),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatPower: (value: number | null) => String(value) }),
}));
vi.mock('@/components/layout', () => ({
  useCardPlacement: () => ({ className: 'allocated-chart' }),
}));
vi.mock('@/components/charts', () => ({
  ChartContainer: (props: ComponentProps<typeof ChartContainer>) => {
    captured.container(props);
    return typeof props.children === 'function'
      ? props.children({ annotations: [], hidden: false, hiddenSeries: null })
      : props.children;
  },
  ResponsiveContainer: ({ children, ...props }: PropsWithChildren) => {
    captured.responsive(props);
    return children;
  },
  ComposedChart: ({ children, ...props }: PropsWithChildren) => {
    captured.composed(props);
    return children;
  },
  Area: (props: Record<string, unknown>) => { captured.area(props); return null; },
  Line: (props: Record<string, unknown>) => { captured.line(props); return null; },
  ChartLegend: (props: ComponentProps<typeof ChartLegend>) => {
    captured.legend(props);
    return null;
  },
  ChartTooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}));

const data = [
  { timestamp: '2026-10-01T00:00:03Z', tMs: 3, time: 'third', heaterW: 1200, chargeW: 45000 },
  { timestamp: '2026-10-01T00:00:01Z', tMs: 1, time: 'first', heaterW: null, chargeW: null },
  { timestamp: '2026-10-01T00:00:02Z', tMs: 2, time: 'second', heaterW: 0, chargeW: 0 },
];
const retry = vi.fn();
const state = deriveDataState({
  data, error: new Error('refresh failed'), isError: true, refetch: retry,
}, { provenance: 'historical' });

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-mode');
  vi.unstubAllGlobals();
});

describe('ThermalPowerChart caller contract', () => {
  it.each([
    ['neon-cyan', 'dark', false],
    ['neon-cyan', 'light', false],
    ['matrix-green', 'oled', false],
    ['custom', 'dark', false],
    ['custom', 'light', false],
    ['neon-cyan', 'light', true],
  ])('keeps the bounded tint and original series in %s/%s (forced colors %s)', (theme, mode, forced) => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-mode', mode);
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: forced && query === '(forced-colors: active)', media: query,
      onchange: null, addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
    }));
    render(<ThermalPowerChart selected loading={false} state={state} data={data} />);

    const area = captured.area.mock.calls[0][0];
    expect(area).toMatchObject({
      type: 'monotone', dataKey: 'heaterW', name: 'Heater',
      fill: chartTokens.series[3], stroke: chartTokens.series[3],
      fillOpacity: 0.08,
    });
    expect(Number(area.fillOpacity)).toBeLessThanOrEqual(0.08);
    expect(area.connectNulls).toBeUndefined();
    expect(captured.line).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      type: 'monotone', dataKey: 'chargeW', name: 'Charge power',
      stroke: chartTokens.series[0], strokeWidth: 2, dot: false,
    }));
    expect(captured.area.mock.invocationCallOrder[0])
      .toBeLessThan(captured.line.mock.invocationCallOrder[0]);
    expect(captured.composed.mock.calls[0][0].data).toBe(data);
    expect(captured.container.mock.calls[0][0]).toMatchObject({
      chartKey: 'charging-thermal-tax-power', height: 320,
      loading: false, empty: false, error: null, onRetry: state.retry,
      className: 'h-full min-w-0 allocated-chart',
      dataColumns: [
        { key: 'time', label: 'Time' },
        { key: 'timestamp', label: 'Exact timestamp' },
        { key: 'heaterW', label: 'Heater (W)' },
        { key: 'chargeW', label: 'Charge power (W)' },
      ],
    });
    expect(captured.container.mock.calls[0][0].data).toBe(data);
    expect(captured.container.mock.calls[0][0].exportData).toBe(data);
    expect(captured.responsive).toHaveBeenCalledWith({ width: '100%', height: '100%' });
    expect(data[1]).toEqual({
      timestamp: '2026-10-01T00:00:01Z', tMs: 1, time: 'first', heaterW: null, chargeW: null,
    });
  });

  it('uses the unchanged heater and charge keys for hidden-series state', () => {
    const chart = ThermalPowerChart({ selected: true, loading: false, state, data });
    const children = chart.props.children;
    const tree = children({ hiddenSeries: captured.hidden });
    render(tree);
    expect(captured.hidden.isHidden.mock.calls).toEqual([['heaterW'], ['chargeW']]);
    expect(captured.area.mock.calls[0][0].hide).toBe(true);
    expect(captured.line.mock.calls[0][0].hide).toBe(false);
    expect(captured.legend).toHaveBeenCalledWith({ state: captured.hidden });
  });
});
