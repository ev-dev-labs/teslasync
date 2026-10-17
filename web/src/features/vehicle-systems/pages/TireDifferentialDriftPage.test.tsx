import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cloneElement, type ReactElement, type ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HiddenSeriesState } from '@/hooks/useHiddenSeries';
import type { TireDifferentialSample } from '../lib/tireDifferentialDrift';
import { convertPressureFromSI, formatPressure, type UnitPref } from '@/lib/unitConversion';
import { fmtNumber, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import type { ChartTooltipProps } from '@/components/charts/ChartTooltip';
import { formatDateTime, formatRelative, formatTime } from '@/lib/dateFormat';
import type { UseDateFormatResult } from '@/hooks/useDateFormat';
import { chartTokens } from '@/lib/tokens';
import { Button } from '@/components/ui';
import { calendarRangeToInstants } from '@/lib/dateRange';
import { SHARED_RANGE_STORAGE_KEY } from '@/hooks/useRangeState';
import type { DriveWindow } from '@/api/hooks/useDriving';

interface QueryStub {
  data: TireDifferentialSample[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  isFetching: boolean;
  fetchStatus: 'idle' | 'fetching' | 'paused';
  dataUpdatedAt: number;
  refetch: () => void;
}
const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  pressure: 'bar' as 'bar' | 'psi',
  locale: 'en-US',
  precision: 2,
  tz: 'UTC',
  query: undefined as unknown as QueryStub,
  hook: vi.fn(),
  residuals: [] as Record<string, unknown>[],
  slopes: [] as Record<string, unknown>[],
}));
const retry = vi.fn();
const BASE = Date.parse('2026-01-01T00:15:00.000Z');
const prefs = (): UnitPref => ({
  distance: 'km', speed: 'km/h', temperature: '°C', pressure: h.pressure,
  energy: 'kWh', duration: 'h', power: 'kW', locale: h.locale, precision: h.precision,
});

vi.mock('@/api/hooks/useVehicleSystems', () => ({
  useTirePressureAnalysisHistory: (id: string, days: number, range: Pick<DriveWindow, 'start' | 'end'>) => {
    h.hook(id, days, range); return h.query;
  },
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: h.vehicleId }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: prefs(), formatPressure: (value: number | null) => formatPressure(value, prefs()) }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    tz: h.tz, locale: h.locale,
    formatDateTime: value => formatDateTime(value, { tz: h.tz, locale: h.locale }),
    formatRelative: value => formatRelative(value, { tz: h.tz, locale: h.locale }),
    formatTime: value => formatTime(value, { tz: h.tz, locale: h.locale }),
  } satisfies Pick<UseDateFormatResult, 'tz' | 'locale' | 'formatDateTime' | 'formatRelative' | 'formatTime'>),
}));
vi.mock('@/components/motion', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/motion')>(),
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
// Keep canonical cards, trust, brief, data tables and export/help controls real.
// Only the unmeasurable jsdom plot boundary is replaced; capture complete rows.
vi.mock('@/components/charts', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/components/charts')>(),
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <>{children}</>,
  LineChart: ({ children, data }: { children: ReactNode; data: Record<string, unknown>[] }) => {
    h.residuals = data;
    return <div data-testid="residual-plot">{children}</div>;
  },
  BarChart: ({ children, data }: { children: ReactNode; data: Record<string, unknown>[] }) => {
    h.slopes = data;
    return <div data-testid="slope-plot">{children}</div>;
  },
  Line: ({ dataKey, hide }: { dataKey: string; hide: boolean }) => <span data-testid={`line-${dataKey}`} data-hidden={hide} />,
  Bar: ({ children }: { children: ReactNode }) => <>{children}</>,
  Cell: ({ fill }: { fill: string }) => <span data-testid="corner-color" data-fill={fill} />,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: ({ unit, tickFormatter }: { unit: string; tickFormatter: (value: number) => string }) =>
    <span data-testid="axis-unit">{unit}<span data-testid="axis-value">{tickFormatter(-0.0012345)}</span></span>,
  Tooltip: ({ content }: { content: ReactElement<ChartTooltipProps> }) => cloneElement(content, {
    active: true, payload: [{ name: 'Residual', value: h.residuals[1]?.fl }],
  }),
  ChartLegend: ({ state }: { state: HiddenSeriesState }) => <div>
    {(['fl', 'fr', 'rl', 'rr'] as const).map(key => <Button key={key} type="button" aria-pressed={!state.isHidden(key)} onClick={() => state.toggle(key)}>Toggle {key}</Button>)}
  </div>,
}));

import TireDifferentialDriftPage from './TireDifferentialDriftPage';

function samples(days = 12, drift = -1000, offset = 0): TireDifferentialSample[] {
  return Array.from({ length: days }, (_, d) => ({
    ts: new Date(BASE + d * 86_400_000).toISOString(),
    front_left: 240_000 - 500 * d + drift * d,
    front_right: 240_000 - 500 * d,
    rear_left: 240_000 - 500 * d + offset,
    rear_right: 240_000 - 500 * d,
  }));
}
function query(overrides: Partial<QueryStub> = {}): QueryStub {
  return { data: samples(), isLoading: false, isError: false, error: null,
    isFetching: false, fetchStatus: 'idle', dataUpdatedAt: BASE, refetch: retry, ...overrides };
}
function Location() {
  return <output data-testid="location">{useLocation().search}</output>;
}
function renderPage(path = '/tire-differential-drift') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>
    <TireDifferentialDriftPage /><Location />
  </MemoryRouter></QueryClientProvider>);
}
const sections = ['Differential drift metrics', 'Common-mode-removed residuals', 'Per-corner drift rate', 'Reading this inference'];
function everySection() {
  for (const name of sections) expect(screen.getByRole('heading', { name })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1, name: 'Tire differential drift' })).toBeInTheDocument();
}
function expectBriefDetail(text: string | RegExp, label?: string) {
  fireEvent.click(within(brief()).getByRole('button', { name: 'Review details' }));
  const dialog = screen.getByRole('dialog');
  const target = label ? within(dialog).getByRole('group', { name: label }) : dialog;
  expect(within(target).getByText(text)).toBeInTheDocument();
  fireEvent.keyDown(dialog, { key: 'Escape' });
}

function brief() { return screen.getByTestId('tire-differential-drift-summary'); }

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.removeItem(SHARED_RANGE_STORAGE_KEY);
  h.vehicleId = 7; h.pressure = 'bar'; h.locale = 'en-US'; h.tz = 'UTC'; h.precision = 2;
  setGlobalPrecision(0); setGlobalLocale('en-US');
  h.query = query(); h.residuals = []; h.slopes = [];
});

describe('TireDifferentialDriftPage', () => {
  it('sends saved-timezone day boundaries for the actual route without filtering returned evidence', () => {
    h.locale = 'de-DE'; h.tz = 'America/Los_Angeles';
    renderPage('/tire-differential-drift?from=2024-03-10&to=2024-03-10');
    expect(h.hook).toHaveBeenLastCalledWith('7', 30, {
      start: '2024-03-10T08:00:00.000Z', end: '2024-03-11T07:00:00.000Z',
    });
    everySection();
    expect(h.residuals).toHaveLength(12);
    expect(screen.queryByRole('button', { name: /select.*range/i })).not.toBeInTheDocument();
  });

  it.each(['', '?from=invalid&to=invalid', '?from=2024-03-10'])(
    'uses the saved workspace range when URL dates are missing or invalid: %s', search => {
      h.locale = 'de-DE'; h.tz = 'America/Los_Angeles';
      localStorage.setItem(SHARED_RANGE_STORAGE_KEY, JSON.stringify({
        version: 2, start: '2024-11-03', end: '2024-11-03',
      }));
      renderPage(`/tire-differential-drift${search}`);
      const range = calendarRangeToInstants({
        startDate: '2024-11-03', endDate: '2024-11-03', timezone: h.tz,
      });
      expect(h.hook).toHaveBeenLastCalledWith('7', 30, {
        start: range.startInstant, end: range.endInstantExclusive,
      });
      expect(range).toEqual({
        startInstant: '2024-11-03T07:00:00.000Z',
        endInstantExclusive: '2024-11-04T08:00:00.000Z',
      });
    },
  );

  it('renders the real header freshness timestamp with the saved locale and timezone', () => {
    h.locale = 'de-DE'; h.tz = 'America/Los_Angeles';
    renderPage(); everySection();
    const time = formatTime(new Date(BASE), { locale: h.locale, tz: h.tz });
    // FreshnessDot carries the timestamp in its tooltip description, not a title.
    const escaped = time.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(screen.getByRole('tooltip', { name: new RegExp(`Last updated: ${escaped}`) })).toBeInTheDocument();
    expect(screen.getByTestId('residual-plot')).toBeInTheDocument();
    expect(screen.getByTestId('slope-plot')).toBeInTheDocument();
  });

  it('preserves four sections, four metrics, four residual series and four corner readings', () => {
    const raw = structuredClone(h.query.data);
    renderPage(); everySection();
    expect(h.hook).toHaveBeenLastCalledWith('7', 30, {
      start: expect.any(String), end: expect.any(String),
    });
    for (const key of ['fl', 'fr', 'rl', 'rr']) expect(screen.getByTestId(`line-${key}`)).toBeInTheDocument();
    for (const label of ['Likely leak corner', 'Structural imbalance', 'Days to threshold', 'Samples analyzed']) expect(within(brief()).getByText(label)).toBeInTheDocument();
    expect(h.residuals).toHaveLength(12); expect(h.slopes).toHaveLength(4);
    expect(screen.getAllByText(/slope .*confidence .*mean offset/)).toHaveLength(4);
    expect(h.query.data).toEqual(raw);
  });

  it('keeps all sections and the original governed onboarding action without a vehicle', () => {
    h.vehicleId = null; h.query = query({ data: undefined });
    renderPage(); everySection();
    expect(h.hook).toHaveBeenLastCalledWith('', 30, {
      start: expect.any(String), end: expect.any(String),
    });
    expect(screen.getByRole('link', { name: 'Set up TeslaSync' })).toHaveAttribute('href', '/onboarding');
    expect(screen.queryByTestId('residual-plot')).not.toBeInTheDocument();
    expect(screen.queryByTestId('slope-plot')).not.toBeInTheDocument();
    expect(screen.getAllByText('Add a vehicle to your fleet to see data on this page.')).toHaveLength(4);
  });

  it('keeps every section during initial loading without fabricating readings', () => {
    h.query = query({ data: undefined, isLoading: true, isFetching: true, fetchStatus: 'fetching' });
    renderPage(); everySection();
    expect(screen.queryByText('None detected')).not.toBeInTheDocument();
    expect(screen.queryByTestId('residual-plot')).not.toBeInTheDocument();
    expect(screen.queryByTestId('slope-plot')).not.toBeInTheDocument();
  });

  it.each(['empty', 'unusable'] as const)('treats %s history as unknown inference while preserving raw and usable counts', mode => {
    h.query = query({ data: mode === 'empty' ? [] : [{ ts: new Date(BASE).toISOString(), front_left: 240_000 }] });
    renderPage(); everySection();
    expect(screen.queryByText('None detected')).not.toBeInTheDocument();
    expect(screen.queryByText('corners evenly matched')).not.toBeInTheDocument();
    expect(screen.queryByTestId('slope-plot')).not.toBeInTheDocument();
    expect(screen.getByText(/At least two usable four-corner samples/)).toBeInTheDocument();
    expect(within(brief()).getByText('Samples analyzed')).toBeInTheDocument();
    expectBriefDetail(new RegExp(`${mode === 'empty' ? 0 : 1} raw rows`), 'Samples analyzed');
  });

  it('keeps a single measured residual and offset but does not invent a fitted slope or projection', () => {
    h.query = query({ data: samples(1, 0, 5000) });
    renderPage(); everySection();
    expect(h.residuals).toHaveLength(1);
    expect(screen.queryByTestId('slope-plot')).not.toBeInTheDocument();
    expect(screen.getAllByText(/slope —\/day · confidence 0 ·/)).toHaveLength(4);
    expect(screen.getByText(/mean offset 0.05 bar/)).toBeInTheDocument();
  });

  it('preserves genuine zero drift and imbalance with usable common-mode history', () => {
    h.query = query({ data: samples(12, 0) });
    renderPage(); everySection();
    expect(within(brief()).getByText('None detected')).toBeInTheDocument();
    expect(h.slopes.map(row => row.slope)).toEqual([0, 0, 0, 0]);
    expect(screen.getAllByText(/confidence 1/)).toHaveLength(4);
  });

  it('retains all sections and source-local retry actions on a fatal acquisition failure', () => {
    h.query = query({ data: undefined, isError: true, error: new Error('TPMS unavailable') });
    renderPage(); everySection();
    const buttons = screen.getAllByRole('button', { name: /retry|try again/i });
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    for (const button of buttons) fireEvent.click(button);
    expect(retry).toHaveBeenCalledTimes(buttons.length);
    expect(screen.queryByTestId('residual-plot')).not.toBeInTheDocument();
  });

  it.each(['refresh-error', 'offline'] as const)('retains metrics and both plots with honest %s trust', state => {
    h.query = query(state === 'refresh-error'
      ? { isError: true, error: new Error('Refresh failed') }
      : { fetchStatus: 'paused' });
    renderPage(); everySection();
    expectBriefDetail('Retained evidence');
    expect(screen.getByText('Showing retained measurements')).toBeInTheDocument();
    expect(screen.getByTestId('residual-plot')).toBeInTheDocument();
    expect(screen.getByTestId('slope-plot')).toBeInTheDocument();
    expect(h.residuals).toHaveLength(12);
  });

  it('converts pressure deltas only at display and reacts to saved bar/psi preferences', () => {
    const view = renderPage();
    expect(h.slopes[0]?.slope).toBe(-0.01);
    expect(h.residuals[11]?.fl).toBe(-0.11);
    h.pressure = 'psi'; view.rerender(<QueryClientProvider client={new QueryClient()}><MemoryRouter><TireDifferentialDriftPage /></MemoryRouter></QueryClientProvider>);
    expect(h.slopes[0]?.slope).toBe(convertPressureFromSI(-1, 'psi'));
    expect(h.residuals[11]?.fl).toBe(convertPressureFromSI(-11, 'psi'));
    expect(screen.getAllByTestId('axis-unit').map(node => node.firstChild?.textContent)).toEqual([' psi', ' psi/d']);
    expect(h.query.data?.[11]?.front_left).toBe(223_500);
  });

  it.each([undefined, null, NaN, Infinity, -Infinity, 0])('does not turn invalid pressure %s into a measured zero residual', value => {
    h.query = query({ data: samples(2).map(row => ({ ...row, front_left: value })) });
    const raw = structuredClone(h.query.data);
    renderPage(); everySection();
    expect(h.residuals).toEqual([]);
    expect(h.slopes).toEqual([]);
    expect(screen.queryByText('None detected')).not.toBeInTheDocument();
    expect(screen.queryByText('corners evenly matched')).not.toBeInTheDocument();
    expect(h.query.data).toEqual(raw);
  });

  it.each(['bar', 'psi'] as const)('preserves signed fractional %s rows and formats only display surfaces', pressure => {
    h.pressure = pressure; h.locale = 'de-DE'; h.precision = 5;
    setGlobalPrecision(5); setGlobalLocale('de-DE');
    h.query = query({ data: samples(3, -123.45, 67.89) });
    const raw = structuredClone(h.query.data);
    const view = renderPage();
    const negative = convertPressureFromSI((239_376.55 - 239_500) / 1000, pressure);
    const positive = convertPressureFromSI((239_567.89 - 239_500) / 1000, pressure);
    expect(h.residuals[1]?.fl).toBe(negative);
    expect(h.residuals[1]?.rl).toBe(positive);
    expect(h.residuals[1]?.fr).toBe(0);
    expect(h.residuals[1]?.rr).toBe(0);
    expect(h.slopes[0]?.slope).toBeCloseTo(convertPressureFromSI(-0.12345, pressure), 12);
    expect(typeof h.residuals[1]?.fl).toBe('number');
    expect(screen.getAllByTestId('axis-value').map(node => node.textContent))
      .toEqual(Array(2).fill(fmtNumber(-0.0012345, 5, 'de-DE')));
    expect(screen.getAllByRole('cell', { name: fmtNumber(negative, 5, 'de-DE') }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('cell', { name: fmtNumber(positive, 5, 'de-DE') }).length).toBeGreaterThan(0);
    const rows = structuredClone(h.residuals);
    const slopes = structuredClone(h.slopes);
    h.precision = 2;
    act(() => setGlobalPrecision(2));
    view.rerender(<QueryClientProvider client={new QueryClient()}><MemoryRouter><TireDifferentialDriftPage /></MemoryRouter></QueryClientProvider>);
    expect(h.residuals).toEqual(rows);
    expect(h.slopes).toEqual(slopes);
    expect(screen.getAllByTestId('axis-value').map(node => node.textContent))
      .toEqual(Array(2).fill(fmtNumber(-0.0012345, 2, 'de-DE')));
    expect(h.query.data).toEqual(raw);
  });

  it('retains precise UTC identities and localized complete timestamps in the data alternative', () => {
    h.locale = 'de-DE'; h.tz = 'America/Los_Angeles';
    renderPage();
    expect(h.residuals[0]?.timestamp).toBe('2026-01-01T00:15:00.000Z');
    const label = formatDateTime(new Date(BASE), { locale: h.locale, tz: h.tz }) + ' (' + h.tz + ')';
    expect(h.residuals[0]?.time).toBe(label);
    expect(screen.getByText('Timestamp (UTC)')).toBeInTheDocument();
    expect(screen.getByText('2026-01-01T00:15:00.000Z')).toBeInTheDocument();
  });

  it('preserves URL-backed legend keys and stable corner colors with a textual leak cue', () => {
    renderPage('/tire-differential-drift?hidden_tire-differential-drift-residuals=fl');
    expect(screen.getByTestId('line-fl')).toHaveAttribute('data-hidden', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle fl' }));
    expect(screen.getByTestId('line-fl')).toHaveAttribute('data-hidden', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle rr' }));
    expect(screen.getByTestId('location')).toHaveTextContent('hidden_tire-differential-drift-residuals=rr');
    expect(h.slopes[0]?.corner).toBe('Front left · Leak suspect');
    expect(screen.getAllByTestId('corner-color').map(node => node.dataset.fill)).toEqual(chartTokens.series.slice(0, 4));
    expect(screen.getByRole('button', { name: 'More info about this inference' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /export/i }).length).toBeGreaterThanOrEqual(2);
  });
});
