import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render as renderWithoutRouter, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SafetySnapshot } from '@/types/vehicle-systems';

const fake = vi.hoisted(() => ({
  safety: vi.fn(),
  history: vi.fn(),
  security: vi.fn(),
  vehicle: vi.fn(),
  distance: vi.fn(),
  refreshSafety: vi.fn(),
  refreshHistory: vi.fn(),
  refreshSecurity: vi.fn(),
}));

function render(content: ReactNode) {
  return renderWithoutRouter(content, { wrapper: MemoryRouter });
}

// No actual hook, request client, vehicle command, or mutation runs in these cases.
vi.mock('@/api/hooks/useVehicleSystems', () => ({
  useSafety: (id: string) => fake.safety(id),
  useSafetyHistory: (id: string) => fake.history(id),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useSecurityLatest: (id: number, interval: number) => fake.security(id, interval),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => fake.vehicle() }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatDistance: fake.distance, unitPrefs: { distance: 'km' } }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtInt: (value: number) => String(Math.round(value)), precision: 2 }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, options?: Record<string, string | number | undefined>) =>
      fallback.replace(/{{(\w+)}}/g, (_match, key: string) => String(options?.[key] ?? `{{${key}}}`)),
  }),
}));
vi.mock('@/components/ui', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  const pass = ({ children }: { children?: ReactNode }) => createElement('div', null, children);
  return {
    ...actual,
    GlassPanel: pass, Badge: pass, PanelTitle: pass, Caption: pass, Label: pass, Text: pass,
    Icon: () => null,
    Button: ({ children, onClick, ...props }: {
      children?: ReactNode; onClick?: () => void; 'aria-label'?: string; 'aria-busy'?: boolean;
    }) => createElement('button', {
      onClick, 'aria-label': props['aria-label'], 'aria-busy': props['aria-busy'],
    }, children),
    DataTable: ({ columns, data, tableId, mobileColumns, keyExtractor, pagination, compact, enableValueFilters }: {
      columns: { key: string; header: string; render: (row: SafetySnapshot) => ReactNode }[];
      data: SafetySnapshot[];
      tableId: string;
      mobileColumns: string[];
      keyExtractor: (row: SafetySnapshot) => number;
      pagination: boolean; compact: boolean; enableValueFilters: boolean;
    }) => createElement('div', {
      'data-testid': 'history-table', 'data-table-id': tableId,
      'data-mobile-columns': mobileColumns.join(','),
      'data-options': [pagination, compact, enableValueFilters].join(','),
    }, columns.map(column => createElement('div', { key: column.key },
      column.header, data.map(row => createElement('div', {
        key: keyExtractor(row), 'data-row-id': keyExtractor(row),
      }, column.render(row)))))),
  };
});
vi.mock('@/components/layout', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/layout')>(),
  ...await import('@/components/layout/layout-reference'),
  PrefetchLink: ({ to, children }: { to: string; children: ReactNode }) =>
    createElement('a', { href: to }, children),
}));
vi.mock('@/components/layout/layout-reference', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/layout/layout-reference')>(),
  PageLayout: ({ title, children, secondaryActions, dataSources }: {
    title: string; children: ReactNode; secondaryActions: ReactNode;
    dataSources: { id: string; query: { isError?: boolean }; enabled: boolean }[];
  }) => createElement('main', null,
    createElement('h1', null, title), secondaryActions,
    dataSources.filter(source => source.enabled && source.query.isError).map(source =>
      createElement('div', { key: source.id, role: 'alert' }, `${source.id} refresh failed`)),
    children),
  LayoutCard: ({ title, description, children }: { title: string; description?: string; children: ReactNode }) =>
    createElement('section', { 'aria-label': title }, createElement('h2', null, title),
      description ? createElement('p', null, description) : null, children),
  CardGrid: ({ items }: { items: { id: string; content: ReactNode }[] }) =>
    createElement('div', null, items.map(item => createElement('div', { key: item.id }, item.content))),
}));
vi.mock('@/components/data-display', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/data-display')>(),
  ...await import('@/components/data-display/stat-reference'),
  MetricCard: ({ label, value, subtitle }: { label: string; value: ReactNode; subtitle?: string }) =>
    createElement('div', null, label, createElement('span', null, value), subtitle),
  TimeStamp: ({ value }: { value?: string }) => createElement('span', null, value ?? '—'),
  DataFreshnessAuto: () => null,
}));
vi.mock('@/components/feedback', () => ({
  Skeleton: () => createElement('div', { 'data-testid': 'skeleton' }),
  EmptyState: ({ message, description, actionTo }: {
    message: string; description?: string; actionTo?: { to: string; label: string };
  }) => createElement('div', null, message, description,
    actionTo ? createElement('a', { href: actionTo.to }, actionTo.label) : null),
  QueryError: ({ error, onRetry }: { error: Error; onRetry: () => void }) =>
    createElement('div', { role: 'alert' }, error.message,
      createElement('button', { onClick: onRetry }, 'Retry')),
}));
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}));
vi.mock('@/components/charts', () => {
  const pass = ({ children }: { children: ReactNode }) => createElement('div', null, children);
  const none = () => null;
  return {
    LinearGauge: ({ value, max }: { value: number; max: number }) =>
      createElement('div', { 'data-testid': 'coverage-gauge' }, `${value}/${max}`),
    EmbeddedChart: ({ children, chartKey }: {
      children: (state: { hiddenSeries?: undefined }) => ReactNode; chartKey: string;
    }) => createElement('div', { 'data-testid': chartKey }, children({})),
    LineChart: ({ data }: { data: unknown }) =>
      createElement('div', { 'data-testid': 'chart-data' }, JSON.stringify(data)),
    ResponsiveContainer: pass,
    Line: none, XAxis: none, YAxis: none, Tooltip: none, ChartLegend: none, ChartTooltip: none,
    chartGrid: null, axisTick: {}, chartMargin: {}, CHART_COLORS: [], AREA_DEFAULTS: {},
  };
});

import SafetySettingsPage, {
  boolFeatures, buildFeatureCards, summarizeFeatures, toChartData,
} from '../../pages/SafetySettingsPage';

const snapshot: SafetySnapshot = {
  id: 7, vehicle_id: 42, created_at: '2026-10-04T12:00:00Z',
  automatic_emergency_braking_off: false,
  automatic_blind_spot_camera: true,
  blind_spot_collision_warning: false,
  emergency_lane_departure_avoidance: true,
  pin_to_drive_enabled: false,
  forward_collision_warning: 'ForwardCollisionSensitivityHigh',
  lane_departure_avoidance: 'LaneAssistLevelWarning',
  speed_limit_warning: 'SpeedAssistLevelNone',
  cruise_follow_distance: 'FollowDistance3',
  miles_since_reset: 0, self_driving_miles_since_reset: null,
};

function query<T>(data: T | null, refetch: () => void, overrides = {}) {
  return {
    data, refetch, isLoading: false, isFetching: false, isError: false, error: null,
    dataUpdatedAt: 0, isStale: false, ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.vehicle.mockReturnValue({ vehicleId: 42 });
  fake.distance.mockImplementation((meters: number) => `${meters / 1000} km`);
  fake.safety.mockReturnValue(query(snapshot, fake.refreshSafety));
  fake.history.mockReturnValue(query([snapshot], fake.refreshHistory));
  fake.security.mockReturnValue(query({
    ts: '2026-10-04T12:01:00Z', driver_seat_belt: true, passenger_seat_belt: false,
    driver_seat_occupied: null, locked: false,
  }, fake.refreshSecurity));
});

describe('source semantics: missing is not disabled, zero or AEB enabled', () => {
  it('keeps all nine fields and descriptions on an entirely unknown snapshot', () => {
    expect(boolFeatures({})).toEqual(Array(9).fill(null));
    expect(summarizeFeatures({})).toEqual({ enabled: 0, disabled: 0, unknown: 9, percent: null });
    const cards = buildFeatureCards({}, (_key, fallback) => fallback);
    expect(cards).toHaveLength(9);
    expect(cards.map(card => card.key)).toEqual(['aeb', 'bsc', 'fcw', 'lda', 'cfd', 'slw', 'ptd', 'bscw', 'elda']);
    expect(cards.every(card => card.enabled === null && card.valueText === 'Unknown' && card.description.length > 0)).toBe(true);
  });

  it('distinguishes explicit false/zero from unknown raw enums, without changing DTOs', () => {
    const source = Object.freeze({ ...snapshot, cruise_follow_distance: 0, forward_collision_warning: false });
    expect(summarizeFeatures(source)).toEqual({ enabled: 4, disabled: 5, unknown: 0, percent: 4 / 9 * 100 });
    const partial = { ...snapshot, automatic_emergency_braking_off: null, lane_departure_avoidance: '' };
    expect(summarizeFeatures(partial).unknown).toBe(2);
    expect(summarizeFeatures(partial).percent).toBeNull();
    expect(buildFeatureCards(source, (_key, fallback) => fallback).find(card => card.key === 'cfd')?.valueText).toBe('0');
    expect(summarizeFeatures({ forward_collision_warning: NaN }).unknown).toBe(9);
    expect(summarizeFeatures({ forward_collision_warning: 'Unknown' }).unknown).toBe(9);
    expect(source.cruise_follow_distance).toBe(0);
  });

  it('sorts copies and preserves chart gaps instead of inventing off/on states', () => {
    const rows: SafetySnapshot[] = [
      { id: 1, created_at: '2026-10-04T12:00:00Z' },
      { id: 2, created_at: '2026-10-03T12:00:00Z', automatic_emergency_braking_off: true, blind_spot_collision_warning: false, emergency_lane_departure_avoidance: true },
    ];
    const before = JSON.stringify(rows);
    expect(toChartData(rows).map(({ aeb, bscw, elda }) => [aeb, bscw, elda])).toEqual([[0, 0, 1], [null, null, null]]);
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe('mock-only page: pending/refetch/failure and lossless presentation', () => {
  it('retains query arguments, source fields, SI zero, unknown distance, and table preferences', () => {
    render(<SafetySettingsPage />);
    expect(fake.safety).toHaveBeenCalledWith('42');
    expect(fake.history).toHaveBeenCalledWith('42');
    expect(fake.security).toHaveBeenCalledWith(42, 15000);
    expect(fake.distance).toHaveBeenCalledWith(0, { precision: 2 });
    expect(fake.distance).toHaveBeenCalledTimes(1);
    expect(screen.getByText('0 km')).toBeInTheDocument();
    expect(screen.getByText('Unbuckled')).toBeInTheDocument();
    expect(screen.getByText('Unlocked')).toBeInTheDocument();
    expect(screen.getByText('Requires PIN before driving')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open FSD insights/ })).toHaveAttribute('href', '/fsd');
    const table = screen.getByTestId('history-table');
    expect(table).toHaveAttribute('data-table-id', 'vehicle-systems:safety-history');
    expect(table).toHaveAttribute('data-mobile-columns', 'time,aeb,fcw');
    expect(table).toHaveAttribute('data-options', 'true,true,true');
    for (const header of ['Time', 'AEB', 'BSC', 'BSCW', 'FCW', 'LDA', 'ELDA', 'CFD', 'SLW', 'PIN']) {
      expect(within(table).getByText(header)).toBeInTheDocument();
    }
  });

  it('refreshes all three sources through original callbacks and announces pending without dropping data', () => {
    const view = render(<SafetySettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(fake.refreshSafety).toHaveBeenCalledTimes(1);
    expect(fake.refreshHistory).toHaveBeenCalledTimes(1);
    expect(fake.refreshSecurity).toHaveBeenCalledTimes(1);
    fake.safety.mockReturnValue(query(snapshot, fake.refreshSafety, { isFetching: true }));
    view.rerender(<SafetySettingsPage />);
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Requires PIN before driving')).toBeInTheDocument();
    expect(screen.getByTestId('history-table')).toBeInTheDocument();
  });

  it('reacts to the units bridge without refetch, DTO conversion or page-local preference writes', () => {
    fake.safety.mockReturnValue(query({
      ...snapshot, miles_since_reset: 1609.344, self_driving_miles_since_reset: 0,
    }, fake.refreshSafety));
    fake.distance.mockImplementation((meters: number) => `${meters / 1000} km`);
    const view = render(<SafetySettingsPage />);
    expect(screen.getByText('1.609344 km')).toBeInTheDocument();
    fake.distance.mockImplementation((meters: number) => `${meters / 1609.344} mi`);
    view.rerender(<SafetySettingsPage />);
    expect(screen.getByText('1 mi')).toBeInTheDocument();
    expect(screen.getByText('0 mi')).toBeInTheDocument();
    expect(fake.distance).toHaveBeenLastCalledWith(0, { precision: 2 });
    expect(fake.refreshSafety).not.toHaveBeenCalled();
    expect(snapshot.miles_since_reset).toBe(0);
  });

  it('retains snapshots and neighbors on all background failures, then shows subsequent telemetry', () => {
    const view = render(<SafetySettingsPage />);
    const failed = { isError: true, error: new Error('Fake refresh failure') };
    fake.safety.mockReturnValue(query(snapshot, fake.refreshSafety, failed));
    fake.history.mockReturnValue(query([snapshot], fake.refreshHistory, failed));
    fake.security.mockReturnValue(query({ ts: snapshot.created_at, locked: false }, fake.refreshSecurity, failed));
    view.rerender(<SafetySettingsPage />);
    expect(screen.getByText('safety refresh failed')).toBeInTheDocument();
    expect(screen.getByText('history refresh failed')).toBeInTheDocument();
    expect(screen.getByText('security refresh failed')).toBeInTheDocument();
    expect(screen.getByTestId('history-table')).toBeInTheDocument();
    expect(screen.getByTestId('chart-data')).toBeInTheDocument();
    expect(screen.getByText('Unlocked')).toBeInTheDocument();
    fake.safety.mockReturnValue(query({ ...snapshot, automatic_blind_spot_camera: null }, fake.refreshSafety));
    view.rerender(<SafetySettingsPage />);
    expect(screen.getByText('Feature share unavailable: some settings are unknown.')).toBeInTheDocument();
    expect(screen.queryByTestId('coverage-gauge')).not.toBeInTheDocument();
  });

  it('keeps every shell while independent initial failure has retry and healthy neighbors remain', () => {
    fake.security.mockReturnValue(query(null, fake.refreshSecurity, {
      isError: true, error: new Error('Fake security failure'),
    }));
    render(<SafetySettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(fake.refreshSecurity).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('region', { name: 'Live safety signals' })).toBeInTheDocument();
    expect(screen.getByTestId('history-table')).toBeInTheDocument();
    expect(screen.getByText('Requires PIN before driving')).toBeInTheDocument();
  });

  it('preserves no-selection prompts and never adds a duplicate selector or fictitious draft/dialog', () => {
    fake.vehicle.mockReturnValue({ vehicleId: null });
    const { container } = render(<SafetySettingsPage />);
    expect(screen.getAllByText('Select a vehicle to view its safety settings.')).toHaveLength(7);
    expect(fake.safety).toHaveBeenCalledWith('');
    expect(fake.security).toHaveBeenCalledWith(0, 15000);
    expect(container.querySelector('input,select,textarea')).toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save|apply|confirm/i })).not.toBeInTheDocument();
    expect(fake.refreshSafety).not.toHaveBeenCalled();
  });

  it('keeps loading shells and read-only boundary across selected-vehicle changes', () => {
    fake.safety.mockReturnValue(query(null, fake.refreshSafety, { isLoading: true }));
    fake.history.mockReturnValue(query([], fake.refreshHistory, { isLoading: true }));
    fake.security.mockReturnValue(query(null, fake.refreshSecurity, { isLoading: true }));
    const view = render(<SafetySettingsPage />);
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(7);
    expect(screen.getByRole('region', { name: 'ADAS features' })).toBeInTheDocument();
    fake.vehicle.mockReturnValue({ vehicleId: 84 });
    fake.safety.mockReturnValue(query({}, fake.refreshSafety));
    view.rerender(<SafetySettingsPage />);
    expect(fake.safety).toHaveBeenLastCalledWith('84');
    expect(screen.getByText('Feature share unavailable: some settings are unknown.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
