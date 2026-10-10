import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { UnitPref } from '@/lib/unitConversion';
import CostBreakdownWidget from './CostBreakdownWidget';
import CostForecastWidget from './CostForecastWidget';
import EnergyStatsWidget from './EnergyStatsWidget';
import MonthlyMileageWidget from './MonthlyMileageWidget';
import MotorHistoryWidget from './MotorHistoryWidget';
import PowerFlowHistoryWidget from './PowerFlowHistoryWidget';
import SolarProductionWidget from './SolarProductionWidget';
import TirePressureHistoryWidget from './TirePressureHistoryWidget';
import WallConnectorWidget from './WallConnectorWidget';

interface AxisProps {
  width?: number;
  hide?: boolean;
  yAxisId?: string;
  domain?: [number, number];
  tick?: { fontSize: number };
  tickFormatter?: (value: number) => string;
}
interface ChartProps {
  data?: Record<string, unknown>[];
  margin?: { left?: number };
  children?: ReactNode;
}

const state = vi.hoisted(() => ({
  axes: [] as AxisProps[],
  charts: [] as ChartProps[],
  labels: [] as string[],
  fonts: [] as string[],
  precision: 4,
  locale: 'de-DE',
  currency: 'CHF',
  prefs: {
    distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
    energy: 'kWh', power: 'kW', duration: 'h', locale: 'de-DE',
  } as UnitPref,
}));

function query(data: unknown) {
  return {
    data, isLoading: false, isPending: false, isError: false, error: null,
    isFetching: false, isStale: false, dataUpdatedAt: 1, refetch: vi.fn(),
  };
}

const timestamp = '2026-10-03T12:00:00Z';
const amount = -1234567.89123;
vi.mock('@/api/hooks/useAnalytics', () => ({
  useCostBreakdown: () => query({
    monthly_breakdown: [{ month: '2026-10', ev_cost: amount }],
  }),
  useMonthlyMileage: () => query([{ year_month: '2026-10', total_km: amount }]),
}));
vi.mock('@/api/hooks/useCharging', () => ({
  useCostForecast: () => query({
    historical: [{ month: '2026-09', cost: amount }], forecast: [],
  }),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => query([{ id: 42 }]),
  useMotorHistory: () => query([
    { ts: timestamp, di_torque: amount, di_stator_temp: 1234.56789 },
  ]),
}));
vi.mock('@/api/hooks/useEnergy', () => ({
  useEnergyStats: () => query({
    daily_breakdown: [{ date: '2026-10-03', energy_wh: amount * 1000 }],
  }),
  useTeslaEnergySites: () => query([{ energy_site_id: 42 }]),
  useTeslaEnergyLiveStatusHistory: () => query([
    { timestamp, solar_power: 12345, battery_power: amount * 1000, grid_power: null, load_power: 0 },
  ]),
  useTeslaEnergyHistory: () => query([{ timestamp, solar_energy_wh: amount * 1000 }]),
  useTeslaWCChargingHistory: () => query([{ timestamp, energy_wh: amount * 1000 }]),
}));
vi.mock('@/api/hooks/useVehicleSystems', () => ({
  useTirePressureHistory: () => query([
    { created_at: timestamp, frontLeft: 123456789.123, frontRight: null, rearLeft: 0, rearRight: 240000 },
  ]),
}));

function fmt(value: number, precision = state.precision) {
  return new Intl.NumberFormat(state.locale, {
    minimumFractionDigits: precision, maximumFractionDigits: precision,
  }).format(value);
}
function currency(value: number, precision = state.precision) {
  return new Intl.NumberFormat(state.locale, {
    style: 'currency', currency: state.currency,
    minimumFractionDigits: precision, maximumFractionDigits: precision,
  }).format(value);
}
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtNumber: fmt, fmtInt: (value: number) => fmt(value, 0),
    precision: state.precision, locale: state.locale,
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: state.currency, formatCurrency: currency }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: state.prefs,
    formatEnergy: (value: number | null) => value == null ? '—' : fmt(value),
    formatPressure: (value: number | null) => value == null ? '—' : fmt(value),
  }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatDateTime: (value: string) => value }),
}));
vi.mock('@/hooks/useDataState', () => ({
  useDataState: () => ({ provenance: 'historical', status: 'ready' }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key,
  }),
}));
vi.mock('./WidgetShell', () => ({
  WidgetShell: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('./shared', () => ({
  WidgetChartSummary: ({ chart }: { chart?: ReactNode }) => <>{chart}</>,
  WidgetBigNumber: () => null,
  WidgetStatGrid: () => null,
  WidgetDetailCard: () => null,
  WidgetRankedList: () => null,
}));
vi.mock('@/components/charts', async () => {
  const { useMeasuredAxisWidth } = await import('@/components/charts/useMeasuredAxisWidth');
  const { axisTick, axisTickSm, chartMargin } = await import('@/components/charts/chartUtils');
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  const Chart = (props: ChartProps) => {
    state.charts.push(props);
    return <svg>{props.children}</svg>;
  };
  const Grid = () => <g />;
  const Nothing = () => null;
  return {
    ...chartTestDoubles, useMeasuredAxisWidth, axisTick, axisTickSm, chartMargin,
    chartAnimation: {}, chartGrid: <Grid />,
    useThemeChartPalette: () => ({ primary: '#123456', neutral: '#654321', series: ['#123456'] }),
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <>{children}</>,
    BarChart: Chart, AreaChart: Chart, LineChart: Chart, ComposedChart: Chart, PieChart: Chart,
    YAxis: (props: AxisProps) => { state.axes.push(props); return null; },
    XAxis: Nothing, Bar: Nothing, Area: Nothing, Line: Nothing, Tooltip: Nothing,
    ReferenceArea: Nothing, ReferenceLine: Nothing, Cell: Nothing, Legend: Nothing, Pie: Nothing,
  };
});

const widgets = [
  { name: 'CostBreakdown', Component: CostBreakdownWidget, keys: ['value'], min: 45 },
  { name: 'CostForecast', Component: CostForecastWidget, keys: ['cost'], min: 40 },
  { name: 'EnergyStats', Component: EnergyStatsWidget, keys: ['energy'], min: 40 },
  { name: 'MonthlyMileage', Component: MonthlyMileageWidget, keys: ['distance'], min: 40 },
  { name: 'MotorHistory', Component: MotorHistoryWidget, keys: ['torque', 'statorTemp'], min: 40 },
  { name: 'PowerFlowHistory', Component: PowerFlowHistoryWidget, keys: ['solar', 'battery', 'grid', 'home'], min: 40 },
  { name: 'SolarProduction', Component: SolarProductionWidget, keys: ['solar_kwh'], min: 40 },
  { name: 'TirePressureHistory', Component: TirePressureHistoryWidget, keys: ['fl', 'fr', 'rl', 'rr'], min: 35 },
  { name: 'WallConnector', Component: WallConnectorWidget, keys: ['energy_kwh'], min: 40 },
];

beforeEach(() => {
  state.axes = [];
  state.charts = [];
  state.labels = [];
  state.fonts = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    font: '',
    measureText(this: { font: string }, label: string) {
      state.labels.push(label);
      state.fonts.push(this.font);
      return { width: label.length * 8 };
    },
  }) as unknown as CanvasRenderingContext2D);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe.each([
  { cols: 2, precision: 4, locale: 'de-DE', currency: 'CHF', energy: 'kWh', power: 'kW', distance: 'km', pressure: 'bar', temperature: '°C' },
  { cols: 3, precision: 0, locale: 'en-US', currency: 'USD', energy: 'Wh', power: 'W', distance: 'mi', pressure: 'psi', temperature: '°F' },
] as const)('complete formatted axes with $cols columns / $locale / precision $precision', (preferences) => {
  it.each(widgets)('$name measures the existing formatter on converted series without clipping', ({ name, Component, keys, min }) => {
    Object.assign(state, { precision: preferences.precision, locale: preferences.locale, currency: preferences.currency });
    Object.assign(state.prefs, preferences);
    render(<MemoryRouter><Component vehicleId={42} size={{ cols: preferences.cols, rows: 4 }} /></MemoryRouter>);
    const axes = [...new Map(state.axes.filter((axis) => !axis.hide).map((axis) => [axis.yAxisId, axis])).values()];
    expect(axes).toHaveLength(name === 'MotorHistory' ? 2 : 1);
    const chart = state.charts.find((entry) => entry.data?.length);
    expect(chart?.margin?.left).toBe(4);
    expect(chart?.data).toHaveLength(1);
    for (const axis of axes) {
      const axisKeys = name === 'MotorHistory'
        ? [axis.yAxisId === 'temp' ? 'statorTemp' : 'torque'] : keys;
      const values = [0, ...axisKeys.map((key) => chart?.data?.[0][key]), ...(axis.domain ?? [])]
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      const formatter = axis.tickFormatter!;
      const expected = values.map((value) =>
        name === 'CostBreakdown' ? currency(value)
          : name === 'CostForecast' ? `${state.currency}${fmt(value)}`
            : name === 'MotorHistory' && axis.yAxisId === 'temp' ? `${fmt(value)}°`
              : fmt(value));
      expect(values.map(formatter)).toEqual(expected);
      for (const label of expected) {
        expect(state.labels).toContain(label);
        expect(axis.width).toBeGreaterThanOrEqual(label.length * 8 + 20);
      }
      expect(axis.width).toBe(Math.max(min, ...expected.map((label) => label.length * 8 + 20)));
      expect(axis.width).toBeGreaterThanOrEqual(min);
      expect(axis.width).toBeGreaterThan(min);
      const fontSize = name === 'CostBreakdown' ? 10 : preferences.cols >= 3 ? 11 : 10;
      expect(axis.tick?.fontSize).toBe(fontSize);
      expect(state.fonts.some((font) => font.startsWith(`${fontSize}px `))).toBe(true);
    }
    if (name === 'MotorHistory') {
      expect(axes[0].width).not.toBe(axes[1].width);
      expect(axes[0].tickFormatter?.(12.5)).toBe(fmt(12.5));
      expect(axes[1].tickFormatter?.(12.5)).toBe(`${fmt(12.5)}°`);
    }
    if (name === 'MotorHistory' && preferences.cols === 3) {
      const hidden = state.axes.find((axis) => axis.yAxisId === 'acceleration');
      expect(hidden?.hide).toBe(true);
      expect(hidden?.width).toBeUndefined();
    }
    if (name === 'PowerFlowHistory') {
      expect(chart?.data?.[0]).toMatchObject({ grid: null, home: 0 });
    }
    if (name === 'TirePressureHistory') {
      expect(chart?.data?.[0]).toMatchObject({ time: timestamp, fr: null, rl: 0 });
    }
  });
});

it.each(widgets)('$name keeps compact layouts axis-free', ({ Component }) => {
  render(<MemoryRouter><Component vehicleId={42} size={{ cols: 1, rows: 2 }} /></MemoryRouter>);
  expect(state.axes).toHaveLength(0);
  expect(state.labels).toHaveLength(0);
});
