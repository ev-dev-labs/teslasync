import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Children, isValidElement, type ComponentProps, type ReactNode } from 'react';
import type { ComponentRUL, ComponentDetailResponse } from '@/api/hooks/useRUL';
import type { FormatOptions } from '@/hooks/useUnits';
import { formatDistance, type DistanceUnitPref } from '@/lib/unitConversion';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import RemainingUsefulLifePage from './RemainingUsefulLifePage';

const sources = vi.hoisted(() => ({ board: vi.fn(), detail: vi.fn() }));
const units = vi.hoisted((): { distance: DistanceUnitPref } => ({ distance: 'km' }));
const preferences = vi.hoisted(() => ({
  reduce: false, vehicleId: 7 as number | null, locale: 'en-US', timezone: 'UTC',
}));
const chart = vi.hoisted(() => ({
  line: vi.fn(), area: vi.fn(), axis: vi.fn(), tooltip: vi.fn(), data: vi.fn(),
}));
const translations = vi.hoisted(() => ({ values: {} as Record<string, string> }));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: preferences.reduce, durationMs: preferences.reduce ? 0 : 250 }),
}));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    locale: preferences.locale,
    settings: { tz_display_default: 'user', timezone_user: preferences.timezone },
  }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: units.distance, speed: 'km/h', temperature: 'C', pressure: 'bar',
      energy: 'kWh', duration: 'h', power: 'kW', locale: 'en-US',
    },
    formatDistance: (value: number | null | undefined, options?: FormatOptions) => formatDistance(value, {
      distance: units.distance, speed: 'km/h', temperature: 'C', pressure: 'bar',
      energy: 'kWh', duration: 'h', power: 'kW', locale: 'en-US',
    }, options),
  }),
}));
vi.mock('@/api/hooks/useRUL', () => ({
  useRUL: (vehicleId: number | null) => sources.board(vehicleId),
  useComponentRUL: (vehicleId: number | null, component: string | null) => sources.detail(vehicleId, component),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: preferences.vehicleId }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('react-i18next', async (importActual) => ({
  ...await importActual<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, values?: Record<string, unknown>) =>
      (translations.values[key] ?? (typeof fallback === 'string' ? fallback : key))
        .replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? `{{${name}}}`)),
    i18n: { language: 'en' },
  }),
}));
vi.mock('@/components/charts', async (importActual) => {
  const actual = await importActual<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return {
    ...actual, ...chartTestDoubles, EmbeddedChart: actual.EmbeddedChart,
    ComposedChart: (props: ComponentProps<typeof actual.ComposedChart>) => {
      chart.data(props.data);
      Children.forEach(props.children, (child) => {
        if (!isValidElement(child)) return;
        if (child.type === actual.Line) chart.line(child.props);
        if (child.type === actual.Area) chart.area(child.props);
        if (child.type === actual.XAxis) chart.axis(child.props);
        if (child.type === actual.Tooltip) chart.tooltip(child.props);
      });
      return <actual.ComposedChart {...props} />;
    },
  };
});

const component: ComponentRUL = {
  component: 'tires', label: 'Tires', health_pct: 75, wear_rate_per_day: 0.1,
  remaining_days: 100, remaining_km: null, projected_eol_date: '2026-08-01',
  confidence: 0.75, status: 'watch', basis: 'Measured tread trend',
  observation_available: true, projection_available: true, basis_kind: 'whole_life_odometer',
};
const detail: ComponentDetailResponse = {
  ...component, eol_threshold: 20, nominal_life_km: null, nominal_life_days: null,
  notes: 'Observed trend only', projection: [{
    date: '2026-08-01', projected_health: 20, confidence_low: 15, confidence_high: 25,
  }],
};

function query<T>(data: T, error: Error | null = null) {
  return {
    data, error, isError: error != null, isLoading: false, isFetching: false,
    dataUpdatedAt: Date.now(), refetch: vi.fn(),
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<RemainingUsefulLifePage />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </MemoryRouter>
    ),
  });
}

beforeEach(() => {
  translations.values = {};
  units.distance = 'km';
  preferences.reduce = false;
  preferences.vehicleId = 7;
  preferences.locale = 'en-US';
  preferences.timezone = 'UTC';
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  chart.line.mockClear();
  chart.area.mockClear();
  chart.axis.mockClear();
  chart.tooltip.mockClear();
  chart.data.mockClear();
  sources.board.mockReturnValue(query({
    vehicle_id: 7, components: [component], next_service: { component: 'tires', date: '2026-08-01' },
  }));
  sources.detail.mockReturnValue(query(detail));
});

describe('RemainingUsefulLifePage independent sources', () => {
  it.each(['America/Los_Angeles', 'Pacific/Kiritimati'])(
    'honors saved locale and precision without shifting calendar days in %s', (timezone) => {
      preferences.locale = 'de-DE';
      preferences.timezone = timezone;
      setGlobalLocale('de-DE');
      setGlobalPrecision(3);
      const measured = { ...component, confidence: 0.751, health_pct: 75.125 };
      const projection = Object.freeze({
        date: '2026-08-01', projected_health: 20.125, confidence_low: 15.125, confidence_high: 25.125,
      });
      sources.board.mockReturnValue(query({
        vehicle_id: 7, components: [measured], next_service: { component: 'tires', date: projection.date },
      }));
      sources.detail.mockReturnValue(query({ ...detail, projection: [projection] }));
      renderPage();
      const expectedDate = '1. Aug. 2026';
      expect(screen.getByRole('button', { name: 'Show forecast for Tires' })).toHaveTextContent(expectedDate);
      expect(screen.getAllByText('Measured health: 75,125%')).toHaveLength(1);
      expect(screen.getByRole('table')).toHaveTextContent('20,125%');
      expect(screen.getByRole('table')).toHaveTextContent(expectedDate);
      const brief = screen.getByTestId('rul-next-service-summary');
      expect(brief).toHaveTextContent(expectedDate);
      fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
      expect(screen.getByRole('dialog')).toHaveTextContent(expectedDate);
      const axis: ComponentProps<typeof import('@/components/charts').XAxis> = chart.axis.mock.lastCall?.[0];
      expect(axis.tickFormatter?.(projection.date, 0)).toBe(expectedDate);
      const tooltip: ComponentProps<typeof import('@/components/charts').Tooltip> = chart.tooltip.mock.lastCall?.[0];
      expect(isValidElement<{ labelFormatter: (value: string) => string }>(tooltip.content)).toBe(true);
      if (isValidElement<{ labelFormatter: (value: string) => string }>(tooltip.content)) {
        expect(tooltip.content.props.labelFormatter(projection.date)).toBe(expectedDate);
      }
      expect(chart.data).toHaveBeenLastCalledWith([{
        date: projection.date, projected_health: 20.125, band: [15.125, 25.125],
      }]);
      expect(projection.date).toBe('2026-08-01');
    },
  );

  it('formats true instants in the saved timezone separately from business days', () => {
    preferences.locale = 'de-DE';
    preferences.timezone = 'America/Los_Angeles';
    const instant = '2026-08-01T00:30:00Z';
    sources.board.mockReturnValue(query({
      vehicle_id: 7, components: [{ ...component, projected_eol_date: instant }],
      next_service: { component: 'tires', date: instant },
    }));
    sources.detail.mockReturnValue(query({
      ...detail, projection: [{ ...detail.projection[0], date: instant }],
    }));
    renderPage();
    const expected = '31. Juli 2026, 17:30';
    expect(screen.getByRole('button', { name: 'Show forecast for Tires' })).toHaveTextContent(expected);
    expect(screen.getByTestId('rul-next-service-summary')).toHaveTextContent(expected);
    expect(screen.getByRole('table')).toHaveTextContent(expected);
    expect(chart.data.mock.lastCall?.[0][0].date).toBe(instant);
  });

  it.each([null, undefined, '', 'not-a-date', '2026-02-30', '2026-13-01', 'invalidTinstant'])(
    'shows an unknown date for %s without losing forecast readings', (date) => {
      sources.board.mockReturnValue(query({
        vehicle_id: 7, components: [{ ...component, projected_eol_date: date }],
        next_service: { component: 'tires', date },
      }));
      sources.detail.mockReturnValue(query({
        ...detail, projection: [{ ...detail.projection[0], date }],
      }));
      renderPage();
      const table = screen.getByRole('table');
      expect(within(table).getAllByRole('cell').map((cell) => cell.textContent))
        .toEqual(['—', '20.00%', '15.00%', '25.00%']);
      const brief = screen.getByTestId('rul-next-service-summary');
      expect(brief.querySelector('[data-value-state="missing"]')).toBeInTheDocument();
      expect(brief).not.toHaveTextContent('Invalid Date');
      expect(screen.getByRole('button', { name: 'Show forecast for Tires' })).not.toHaveTextContent('Invalid Date');
    },
  );

  it.each([
    ['hv_battery', 'High-voltage battery'],
    ['lv_battery', 'Low-voltage battery'],
    ['tires', 'Tires'],
    ['brakes', 'Brakes'],
    ['cabin_filter', 'Cabin filter'],
  ])('localizes recognized %s labels across the board, brief, drawer and forecast', (key, label) => {
    translations.values[`rul.components.${key}`] = `Localized ${label}`;
    const measured = { ...component, component: key, label: 'Server label' };
    sources.board.mockReturnValue(query({
      vehicle_id: 7, components: [measured], next_service: { component: key, date: '2026-08-01' },
    }));
    sources.detail.mockReturnValue(query({ ...detail, ...measured }));
    renderPage();
    expect(screen.getByRole('button', { name: `Show forecast for Localized ${label}` })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: `Health forecast · Localized ${label}` })).toBeInTheDocument();
    const brief = screen.getByTestId('rul-next-service-summary');
    expect(brief).toHaveTextContent(`Localized ${label}`);
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(`Localized ${label}`);
    expect(screen.queryByText('Server label')).toBeNull();
  });

  it('preserves unknown labels, raw numeric rationale and user notes verbatim', () => {
    const raw = 'Signed slope -0.125 over 3.5 days; user-added context.';
    const measured = { ...component, component: 'custom_part', label: 'Custom user label', basis: raw };
    sources.board.mockReturnValue(query({
      vehicle_id: 7, components: [measured], next_service: { component: 'custom_part', date: null },
    }));
    sources.detail.mockReturnValue(query({ ...detail, ...measured, notes: 'Keep 0, -2.5 and {{notes}} unchanged.' }));
    renderPage();
    expect(screen.getByRole('button', { name: 'Show forecast for Custom user label' })).toBeInTheDocument();
    expect(screen.getAllByText(`Basis: ${raw}`)).toHaveLength(2);
    expect(screen.getByText('Keep 0, -2.5 and {{notes}} unchanged.')).toBeInTheDocument();
  });

  it.each([undefined, null, NaN, Infinity, -Infinity, '', '0'])(
    'keeps invalid or missing numeric rationale %s distinct from measured zero', (value) => {
      const invalid = {
        ...component, health_pct: value, wear_rate_per_day: value,
        remaining_days: value, confidence: value, remaining_km: value,
      };
      sources.board.mockReturnValue(query({ vehicle_id: 7, components: [invalid], next_service: null }));
      sources.detail.mockReturnValue(query({ ...detail, ...invalid, projection: [] }));
      renderPage();
      const card = screen.getByRole('button', { name: 'Show forecast for Tires' });
      expect(within(card).getByText('Measured health: unavailable')).toBeInTheDocument();
      expect(within(card).getByText('Daily health decline: unavailable')).toBeInTheDocument();
      expect(within(card).getByText('Projected remaining life: unavailable')).toBeInTheDocument();
      expect(within(card).getByText('Model confidence: unavailable')).toBeInTheDocument();
      expect(card).not.toHaveTextContent('NaN');
      expect(card).not.toHaveTextContent('Infinity');
      expect(within(card).queryByText('Measured health: 0.00%')).toBeNull();
    },
  );

  it('uses explicit availability rather than interpreting fallback zero as a measurement', () => {
    const absent = {
      ...component, health_pct: 0, wear_rate_per_day: 0, remaining_days: 0, confidence: 0,
      observation_available: false, projection_available: false, basis_kind: 'invalid_input',
    };
    sources.board.mockReturnValue(query({ vehicle_id: 7, components: [absent], next_service: null }));
    renderPage();
    const card = screen.getByRole('button', { name: 'Show forecast for Tires' });
    expect(within(card).getByText('Model: Invalid inputs')).toBeInTheDocument();
    expect(within(card).getByText('Measured health: unavailable')).toBeInTheDocument();
    expect(within(card).getByText('Projected remaining life: unavailable')).toBeInTheDocument();
    expect(within(card).queryByText('0 days')).toBeNull();
  });

  it.each([0, -0.125, 0.125])('localizes structured facts without losing signed or fractional %s values', (value) => {
    translations.values['rul.facts.wearRate'] = 'Localized decline: {{value}}';
    translations.values['rul.basisKinds.soh_trend'] = 'Localized trend';
    const measured = {
      ...component, basis_kind: 'soh_trend', health_pct: value,
      wear_rate_per_day: value, remaining_days: value, confidence: value,
    };
    sources.board.mockReturnValue(query({ vehicle_id: 7, components: [measured], next_service: null }));
    sources.detail.mockReturnValue(query({ ...detail, ...measured }));
    renderPage();
    expect(screen.getAllByText(`Localized decline: ${value.toFixed(2)}`)).toHaveLength(2);
    expect(screen.getAllByText('Model: Localized trend')).toHaveLength(2);
    expect(screen.getAllByText(`Measured health: ${value.toFixed(2)}%`)).toHaveLength(2);
    expect(screen.getAllByText(`Projected remaining life: ${value.toFixed(2)} days`)).toHaveLength(2);
    expect(screen.getAllByText(`Model confidence: ${(value * 100).toFixed(2)}%`)).toHaveLength(2);
  });

  it('uses canonical active initial loading for the board and next-service brief', () => {
    sources.board.mockReturnValue({
      ...query(undefined), isPending: true, isFetching: true, fetchStatus: 'fetching',
    });
    sources.detail.mockReturnValue(query(undefined));
    renderPage();
    expect(screen.getByTestId('rul-next-service-summary')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('region', { name: 'Component health' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Component health will appear once telemetry is available.')).toBeNull();
    expect(screen.queryByText('No upcoming service projected.')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Health forecast' })).toBeInTheDocument();
  });

  it('keeps a paused initial board unresolved and retries only that source', () => {
    const board = { ...query(undefined), isPending: true, isLoading: true, fetchStatus: 'paused' };
    sources.board.mockReturnValue(board);
    sources.detail.mockReturnValue(query(undefined));
    const view = renderPage();
    const brief = screen.getByTestId('rul-next-service-summary');
    expect(brief).not.toHaveAttribute('aria-busy');
    expect(brief.querySelectorAll('[data-value-state="missing"]')).toHaveLength(2);
    expect(within(brief).queryByText('Loading')).toBeNull();
    expect(within(brief).getByText('Refresh paused')).toBeInTheDocument();
    expect(within(brief).queryByText('Showing retained measurements')).toBeNull();
    const section = screen.getByRole('region', { name: 'Component health' });
    expect(section).toHaveAttribute('aria-busy', 'false');
    expect(within(section).getByText('Refresh paused')).toBeInTheDocument();
    expect(within(section).getByText('No requested source has returned usable data yet.')).toBeInTheDocument();
    expect(screen.queryByText('Component health will appear once telemetry is available.')).toBeNull();
    expect(screen.queryByText('No upcoming service projected.')).toBeNull();
    expect(screen.queryByText(/offline|network is unavailable/i)).toBeNull();
    fireEvent.click(within(section).getByRole('button', { name: 'Retry' }));
    expect(board.refetch).toHaveBeenCalledOnce();
    expect(sources.detail().refetch).not.toHaveBeenCalled();
    sources.board.mockReturnValue(query({ vehicle_id: 7, components: [], next_service: null }));
    view.rerender(<RemainingUsefulLifePage />);
    expect(screen.getByText('No upcoming service projected.')).toBeInTheDocument();
    expect(screen.getByText('Component health will appear once telemetry is available.')).toBeInTheDocument();
    expect(screen.queryByText('Refresh paused')).toBeNull();
  });

  it.each(['fetching', 'paused'] as const)('keeps the successful board independent of an initial %s forecast', (fetchStatus) => {
    const forecast = {
      ...query(undefined), isPending: true, isFetching: fetchStatus === 'fetching', fetchStatus,
    };
    sources.detail.mockReturnValue(forecast);
    renderPage();
    expect(screen.getByRole('button', { name: 'Show forecast for Tires' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('rul-next-service-summary')).toHaveTextContent('Tires');
    expect(screen.queryByText('No forecast available for this component yet.')).toBeNull();
    if (fetchStatus === 'paused') {
      expect(screen.getByText('Refresh paused')).toBeInTheDocument();
      expect(screen.getByText('No requested source has returned usable data yet.')).toBeInTheDocument();
      expect(screen.queryByText(/offline|network is unavailable/i)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(forecast.refetch).toHaveBeenCalledOnce();
      expect(sources.board().refetch).not.toHaveBeenCalled();
    } else {
      expect(screen.getByRole('heading', { name: 'Health forecast' }).parentElement).toHaveAttribute('aria-busy', 'true');
    }
  });

  it('preserves measured zero health and forecast bounds', () => {
    const zero = { ...component, health_pct: 0, remaining_km: 0, remaining_days: 0, confidence: 0 };
    sources.board.mockReturnValue(query({ vehicle_id: 7, components: [zero], next_service: null }));
    sources.detail.mockReturnValue(query({
      ...detail, ...zero, eol_threshold: 0,
      projection: [{ date: '2026-08-01', projected_health: 0, confidence_low: 0, confidence_high: 0 }],
    }));
    renderPage();
    expect(screen.getByRole('button', { name: 'Show forecast for Tires' })).toHaveTextContent('0% · Low');
    expect(screen.getByRole('table')).toHaveTextContent('0.00%');
    expect(screen.queryByText('No forecast available for this component yet.')).toBeNull();
  });

  it('retries retained sources independently and clears warnings after recovery', () => {
    const board = { ...sources.board(), error: new Error('board refresh'), isError: true };
    const forecast = query(detail, new Error('forecast refresh'));
    sources.board.mockReturnValue(board);
    sources.detail.mockReturnValue(forecast);
    const view = renderPage();
    const warnings = screen.getAllByTestId('stale-refresh-warning');
    fireEvent.click(within(warnings[0]).getByRole('button', { name: 'Refresh' }));
    expect(board.refetch).toHaveBeenCalledOnce();
    expect(forecast.refetch).not.toHaveBeenCalled();
    fireEvent.click(within(warnings[1]).getByRole('button', { name: 'Refresh' }));
    expect(forecast.refetch).toHaveBeenCalledOnce();
    expect(screen.getByRole('table')).toHaveTextContent('20.00%');
    expect(screen.getByTestId('rul-next-service-summary')).toHaveTextContent('Showing retained measurements');
    sources.board.mockReturnValue({ ...board, error: null, isError: false });
    view.rerender(<RemainingUsefulLifePage />);
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(1);
    expect(screen.getByTestId('rul-next-service-summary')).toHaveTextContent('Component board available');
    sources.detail.mockReturnValue(query({ ...detail, notes: 'Recovered forecast' }));
    view.rerender(<RemainingUsefulLifePage />);
    expect(screen.queryByTestId('stale-refresh-warning')).toBeNull();
    expect(screen.getByText('Recovered forecast')).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('20.00%');
    expect(screen.getByRole('button', { name: 'Show forecast for Tires' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens the actual next-service review drawer without converting the projection into a certainty', () => {
    renderPage();
    const brief = screen.getByTestId('rul-next-service-summary');
    expect(brief).toHaveAttribute('data-operational-brief');
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(2);
    expect(brief.querySelectorAll('[data-value-state="value"]')).toHaveLength(2);
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('Service component')).toBeInTheDocument();
    expect(drawer).toHaveTextContent('Tires');
    expect(drawer).toHaveTextContent('Aug 1, 2026');
    expect(drawer).toHaveTextContent('not a guaranteed failure date');
    expect(drawer).toHaveTextContent('component forecasts retain their own confidence and basis below');
    expect(drawer).toHaveTextContent('Existing next-service projection from the component health board.');
  });

  it('retains the real board projection, forecast confidence band and basis during a cause-neutral pause', () => {
    sources.board.mockReturnValue({ ...sources.board(), fetchStatus: 'paused' });
    sources.detail.mockReturnValue({ ...sources.detail(), fetchStatus: 'paused' });
    renderPage();
    const brief = screen.getByTestId('rul-next-service-summary');
    expect(within(brief).getByText('Showing retained measurements')).toBeInTheDocument();
    expect(brief.querySelectorAll('[data-value-state="value"]')).toHaveLength(2);
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(2);
    expect(screen.queryByText(/offline|network is unavailable/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Show forecast for Tires' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByText(/Measured tread trend/)).toHaveLength(2);
    expect(screen.getByText('75% · High')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Health forecast\s*·\s*Tires$/ })).toBeInTheDocument();
    expect(detail.projection[0]).toEqual({
      date: '2026-08-01', projected_health: 20, confidence_low: 15, confidence_high: 25,
    });
  });

  it('keeps an absent next-service projection missing, distinct from a completed board with none projected', () => {
    sources.board.mockReturnValue({ ...query(undefined), isLoading: true });
    const { unmount } = renderPage();
    const pending = screen.getByTestId('rul-next-service-summary');
    expect(pending).toHaveAttribute('aria-busy', 'true');
    expect(pending.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(pending.querySelectorAll('[data-value-state="missing"]')).toHaveLength(2);
    unmount();
    sources.board.mockReturnValue(query({ vehicle_id: 7, components: [], next_service: null }));
    renderPage();
    const empty = screen.getByTestId('rul-next-service-summary');
    expect(within(empty).getByText('No upcoming service projected.')).toBeInTheDocument();
    expect(empty.querySelectorAll('[data-value-state="missing"]')).toHaveLength(2);
    expect(empty).not.toHaveAttribute('aria-busy');
  });

  it.each([
    { preference: 'km' as const, remaining: 2, expected: /^2\s+km$/ },
    { preference: 'mi' as const, remaining: 1.609344, expected: /^1\s+mi$/ },
    { preference: 'km' as const, remaining: 0, expected: /^0\s+km$/ },
  ])('formats $remaining wire kilometres for the $preference display preference', ({ preference, remaining, expected }) => {
    units.distance = preference;
    const measured = { ...component, remaining_km: remaining };
    sources.board.mockReturnValue(query({
      vehicle_id: 7, components: [measured], next_service: null,
    }));
    renderPage();
    const card = screen.getByRole('button', { name: 'Show forecast for Tires' });
    expect(within(card).getByText(expected)).toBeInTheDocument();
    expect(measured.remaining_km).toBe(remaining);
  });

  it('keeps missing wear distance unknown instead of formatting a measured zero', () => {
    renderPage();
    const card = screen.getByRole('button', { name: 'Show forecast for Tires' });
    expect(within(card).getByText('—')).toBeInTheDocument();
    expect(within(card).queryByText(/^0\s+(km|mi)$/)).toBeNull();
  });

  it('keeps component selection, forecast basis and readings when both sources fail to refresh', () => {
    sources.board.mockReturnValue({
      ...sources.board(), error: new Error('board refresh'), isError: true,
    });
    sources.detail.mockReturnValue(query(detail, new Error('forecast refresh')));
    renderPage();
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Show forecast for Tires' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByText(/Measured tread trend/)).toHaveLength(2);
    expect(screen.getByRole('heading', { name: /^Health forecast\s*·\s*Tires$/ })).toBeInTheDocument();
    expect(screen.queryByText('Unable to load service projection.')).toBeNull();
  });

  it('keeps a recoverable forecast prerequisite panel when the board source has a fatal initial failure', () => {
    sources.board.mockReturnValue(query(undefined, new Error('board unavailable')));
    renderPage();
    expect(screen.getByText('Unable to load service projection.')).toBeInTheDocument();
    // No component can be selected from an absent board, so forecast remains a
    // labelled, recoverable prerequisite panel rather than disappearing.
    expect(screen.getByRole('heading', { name: /^Health forecast\s*·\s*Tires$/ })).toBeInTheDocument();
    expect(screen.getByText('Select a component above to see its forecast.')).toBeInTheDocument();
  });

  it('exposes every actual forecast value and bound through the canonical chart table', () => {
    sources.detail.mockReturnValue(query({
      ...detail, projection: [...detail.projection, {
        date: '2026-09-01', projected_health: 10, confidence_low: 5, confidence_high: 16,
      }],
    }));
    renderPage();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent))
      .toEqual(['Date', 'Projected health', 'Lower bound', 'Upper bound']);
    expect(within(table).getAllByRole('row').slice(1).map((row) =>
      within(row).getAllByRole('cell').map((cell) => cell.textContent),
    )).toEqual([
      ['Aug 1, 2026', '20.00%', '15.00%', '25.00%'],
      ['Sep 1, 2026', '10.00%', '5.00%', '16.00%'],
    ]);
    expect(screen.getByText('Observed trend only')).toBeInTheDocument();
    expect(detail.projection[0]).toEqual({
      date: '2026-08-01', projected_health: 20, confidence_low: 15, confidence_high: 25,
    });
  });

  it('keeps basis and configuration caveats visible without inventing an empty forecast', () => {
    sources.detail.mockReturnValue(query({ ...detail, projection: [] }));
    renderPage();
    expect(screen.getByText('No forecast available for this component yet.')).toBeInTheDocument();
    expect(screen.getAllByText(/Measured tread trend/)).toHaveLength(2);
    expect(screen.getByText('Observed trend only')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('uses named native toggles and retains explicit selection ahead of the default', () => {
    const brakes = { ...component, component: 'brakes', label: 'Brakes' };
    sources.board.mockReturnValue(query({
      vehicle_id: 7, components: [component, brakes], next_service: { component: 'tires', date: '2026-08-01' },
    }));
    renderPage();
    const group = screen.getByRole('group', { name: 'Component health' });
    const tiresCard = within(group).getByRole('button', { name: 'Show forecast for Tires' });
    const brakesCard = within(group).getByRole('button', { name: 'Show forecast for Brakes' });
    expect(tiresCard).toHaveAttribute('aria-pressed', 'true');
    expect(brakesCard).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('option')).toBeNull();
    fireEvent.click(brakesCard);
    expect(brakesCard).toHaveAttribute('aria-pressed', 'true');
    expect(tiresCard).toHaveAttribute('aria-pressed', 'false');
    expect(sources.detail).toHaveBeenLastCalledWith(7, 'brakes');
  });

  it.each([false, true])('preserves both series with shared motion reduction %s', (reduce) => {
    preferences.reduce = reduce;
    renderPage();
    expect(chart.line).toHaveBeenLastCalledWith(expect.objectContaining({
      dataKey: 'projected_health', strokeWidth: 2, dot: false,
      isAnimationActive: !reduce, animationDuration: reduce ? 0 : 250,
    }));
    expect(chart.area).toHaveBeenLastCalledWith(expect.objectContaining({
      dataKey: 'band', fillOpacity: 0.08, isAnimationActive: false,
    }));
    expect(screen.getByRole('table')).toHaveTextContent('Aug 1, 2026');
  });

  it('retains all section shells when workspace vehicle selection is absent', () => {
    preferences.vehicleId = null;
    sources.board.mockReturnValue(query(undefined));
    sources.detail.mockReturnValue(query(undefined));
    renderPage();
    expect(screen.getByTestId('rul-next-service-summary')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Component health' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Health forecast' })).toBeInTheDocument();
    expect(screen.getAllByText('Select a vehicle to view its component prognostics.')).toHaveLength(3);
    expect(sources.board).toHaveBeenLastCalledWith(null);
    expect(sources.detail).toHaveBeenLastCalledWith(null, null);
  });
});
