import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { deriveDataState, type DataStateSource } from '@/api/dataState';
import { CardGrid, LayoutCard } from '@/components/layout/layout-reference';
import type { FadeInProps } from '@/components/motion';
import {
  MaintenanceGridSlot, MaintenanceItemCard, MaintenanceSummary, buildServiceColumns,
  type MaintenanceItem, type ServiceRecord,
} from '../index';
import MaintenancePage from '../../../pages/MaintenancePage';
import { MaintenanceSource } from '../MaintenanceSource';
import { item, record } from './fixtures';

const h = vi.hoisted(() => ({
  items: {} as DataStateSource<MaintenanceItem[]>,
  records: {} as DataStateSource<ServiceRecord[]>,
  vehicleId: 7 as number | null,
  precision: 2,
  distance: 'km' as 'km' | 'mi',
  currency: '€',
  request: vi.fn(),
  downloadCSV: vi.fn(),
  downloadJSON: vi.fn(),
}));

vi.mock('@/api/hooks/useMaintenance', () => ({
  useMaintenance: () => h.items,
  useServiceRecords: () => h.records,
}));
vi.mock('@/api/client', () => ({
  request: h.request,
}));
// Prevent incidental shared read hooks from invoking their query functions.
vi.mock('@tanstack/react-query', async importOriginal => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useQuery: () => ({
    data: undefined, isLoading: false, isError: false, isFetching: false,
    isStale: false, error: null, dataUpdatedAt: 0, refetch: vi.fn(),
  }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: h.vehicleId, vehicle: null, vehicles: [], setVehicleId: vi.fn() }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: h.distance, speed: 'km/h', energy: 'kWh', power: 'kW',
      temperature: '°C', pressure: 'bar', duration: 'h', locale: 'en-US', precision: h.precision,
    },
    formatDistance: (value: number | null | undefined) => value == null ? '—'
      : `${(value / (h.distance === 'mi' ? 1609.344 : 1000)).toFixed(h.precision)} ${h.distance}`,
  }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    precision: h.precision, locale: 'en-US',
    fmtNumber: (value: number) => value.toFixed(h.precision),
    fmtInt: (value: number) => String(value),
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    currencySymbol: h.currency,
    formatCurrency: (amount: number) => `${h.currency}${amount.toFixed(h.precision)}`,
  }),
}));
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: { locale: 'en-US', tz_display_default: 'utc', timezone_user: null, decimal_precision: h.precision },
    locale: 'en-US', decimals: h.precision, density: 'comfortable', rangeType: 'rated',
    isMiles: false, isFahrenheit: false, isPSI: false,
  }),
}));
// Partial motion mock: real motion/AnimatePresence and every other export survive.
vi.mock('@/components/motion', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/motion')>(),
  FadeIn: ({ children, className }: FadeInProps) => <div className={className}>{children}</div>,
}));
vi.mock('@/components/ai/AIPredictiveMaintenance', () => ({
  AIPredictiveMaintenance: ({ vehicleId }: { vehicleId?: number }) => (
    <div data-testid="maintenance-ai-scope" data-vehicle-id={vehicleId ?? ''} />
  ),
}));
vi.mock('@/lib/csvExport', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/csvExport')>(),
  downloadCSV: h.downloadCSV,
  downloadJSON: h.downloadJSON,
}));
vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, arg2?: unknown, arg3?: unknown) => {
      const options = arg3 && typeof arg3 === 'object'
        ? arg3 as Record<string, unknown>
        : arg2 && typeof arg2 === 'object' ? arg2 as Record<string, unknown> : undefined;
      const fallback = typeof arg2 === 'string' ? arg2
        : typeof options?.defaultValue === 'string' ? options.defaultValue : key;
      return fallback.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, name: string) => String(options?.[name] ?? ''));
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

function query<T>(data: T | undefined, overrides: DataStateSource<T> = {}): DataStateSource<T> {
  return {
    data, isLoading: false, isFetching: false, isError: false, isSuccess: data !== undefined,
    error: null, dataUpdatedAt: Date.parse('2024-01-01T00:00:00Z'), refetch: vi.fn(),
    ...overrides,
  };
}

function mount(content: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // RTL retains this wrapper (and client) when rerender replaces only content.
  // Rendering the providers as initial content instead would remove them on
  // rerender, remounting the presenter and resetting its disclosure state.
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/maintenance']}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(content, { wrapper: Providers });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.items = query([]);
  h.records = query([]);
  h.vehicleId = 7;
  h.precision = 2;
  h.distance = 'km';
  h.currency = '€';
  h.request.mockImplementation(() => { throw new Error('Unexpected network side effect'); });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('complete maintenance presenters', () => {
  it('keeps resolved null evidence empty and retains real children through refresh failure', () => {
    const empty = <span>No resolved maintenance evidence</span>;
    const children = <span>Measured maintenance evidence</span>;
    const { rerender } = mount(
      <MaintenanceSource source={deriveDataState(query<MaintenanceItem[] | null>(null))} enabled empty={empty}>
        {children}
      </MaintenanceSource>,
    );
    expect(screen.getByText('No resolved maintenance evidence')).toBeInTheDocument();
    expect(screen.queryByText('Measured maintenance evidence')).not.toBeInTheDocument();
    rerender(
      <MaintenanceSource source={deriveDataState(query([item()], {
        isError: true, error: new Error('Refresh failed'),
      }))} enabled empty={empty}>
        {children}
      </MaintenanceSource>,
    );
    expect(screen.getByText('Measured maintenance evidence')).toBeInTheDocument();
    expect(screen.queryByText('No resolved maintenance evidence')).not.toBeInTheDocument();
    expect(screen.getByText('Showing retained measurements')).toBeInTheDocument();
    expect(h.request).not.toHaveBeenCalled();
  });

  it('wires empty projection/category and cost/record recovery to their independent read sources', () => {
    mount(<MaintenancePage />);
    for (const message of [
      'No upcoming service projections available.',
      'No maintenance items to categorize yet.',
      'No cost data available yet. Log service records to see cost estimates.',
      'No service records logged yet.',
    ]) {
      const status = screen.getByText(message).closest('[role="status"]');
      if (!(status instanceof HTMLElement)) throw new Error(`Missing ${message} empty state`);
      fireEvent.click(within(status).getByRole('button', { name: 'Refresh' }));
    }
    expect(h.items.refetch).toHaveBeenCalledTimes(2);
    expect(h.records.refetch).toHaveBeenCalledTimes(2);
    expect(h.request).not.toHaveBeenCalled();
    expect(screen.getByText('No service records logged yet.')).toBeInTheDocument();
  });

  it('distinguishes all six missing KPI values from authoritative zero counts', () => {
    const { rerender } = mount(<MaintenanceSummary source={deriveDataState(query<MaintenanceItem[]>(undefined, {
      isError: true, error: new Error('Unavailable'),
    }))} enabled />);
    const missing = within(screen.getByRole('region', { name: 'Maintenance summary' }));
    expect(missing.queryByText('0')).not.toBeInTheDocument();
    expect(missing.getAllByText('—')).toHaveLength(6);
    rerender(<MaintenanceSummary source={deriveDataState(query<MaintenanceItem[]>([]))} enabled />);
    expect(screen.getAllByText('0')).toHaveLength(6);
    expect(h.request).not.toHaveBeenCalled();
  });

  it('retains item records, projections, costs and table data on independent refresh failures', () => {
    h.items = query([item({ name: 'Rotation retained', interval_miles: 10000, due_mileage: 50000 })], {
      isError: true, error: new Error('Items refresh failed'),
    });
    h.records = query([record({ description: 'History retained', cost: 0 })], {
      isError: true, error: new Error('History refresh failed'),
    });
    mount(<MaintenancePage />);
    expect(screen.getByRole('heading', { level: 4, name: 'Rotation retained' })).toBeInTheDocument();
    expect(screen.getByText('History retained')).toBeInTheDocument();
    expect(screen.getAllByText('€0.00').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Showing retained measurements').length).toBeGreaterThan(1);
    for (const title of ['Maintenance items', 'Service projections', 'Estimated annual cost', 'Maintenance by category', 'Service records']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByTestId('maintenance-ai-scope')).toHaveAttribute('data-vehicle-id', '7');
    expect(h.request).not.toHaveBeenCalled();
  });

  it('keeps successful records when the independent item source fails initially', () => {
    h.items = query(undefined, { isError: true, error: new Error('Items unavailable') });
    h.records = query([record({ description: 'Independent history', cost: 25 })]);
    mount(<MaintenancePage />);
    expect(screen.getByText('Independent history')).toBeInTheDocument();
    expect(screen.getAllByText('€25.00').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('heading', { name: 'Maintenance items' })).toBeInTheDocument();
  });

  it('has source-local loading/empty/unavailable states without hiding other shells', () => {
    h.items = query(undefined, { isLoading: true, isFetching: true });
    h.records = query([]);
    const { container } = mount(<MaintenancePage />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(10);
    expect(screen.getByText('No service records logged yet.')).toBeInTheDocument();
    expect(screen.queryByText('Total items')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Maintenance by category' })).toBeInTheDocument();
  });

  it('retains paused data and does not pretend disabled/no-source values are zero', () => {
    h.vehicleId = null;
    h.items = query(undefined);
    h.records = query(undefined);
    const { unmount } = mount(<MaintenancePage />);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Service records' })).toBeInTheDocument();
    unmount();
    h.vehicleId = 7;
    h.items = query([item({ name: 'Paused rotation' })], { fetchStatus: 'paused' });
    mount(<MaintenancePage />);
    expect(screen.getByRole('heading', { name: 'Paused rotation' })).toBeInTheDocument();
    expect(screen.getAllByText('Refresh is paused. Retained data remains available.').length).toBeGreaterThan(0);
  });

  it('shows all interval metadata with precision and null/zero distinction without writes', () => {
    const source = item({
      due_mileage: 0, last_service_mileage: null, interval_miles: 12345.6789,
      interval_months: 0, current_mileage: 25000,
    });
    const formatter = vi.fn((meters: number | null | undefined) => meters == null ? '—'
      : `${((meters ?? 0) / 1000).toFixed(h.precision)} km`);
    const { container, rerender } = mount(<MaintenanceItemCard item={source} formatDistance={formatter} />);
    const itemElement = container.querySelector('[data-maintenance-item="1"]');
    expect(itemElement).not.toBeNull();
    const trigger = screen.getByRole('button', { name: 'Service interval and metadata' });
    const disclosureId = trigger.getAttribute('aria-controls');
    expect(disclosureId).not.toBeNull();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const disclosure = within(screen.getByRole('region', { name: 'Service interval and metadata' }));
    expect(disclosure.getByText('0.00 km')).toBeInTheDocument();
    expect(disclosure.getByText('12.35 km')).toBeInTheDocument();
    expect(disclosure.getByText('0.00')).toBeInTheDocument();
    expect(disclosure.getAllByText('—').length).toBeGreaterThanOrEqual(1);
    h.precision = 3;
    rerender(<MaintenanceItemCard item={source} formatDistance={formatter} />);
    expect(container.querySelector('[data-maintenance-item="1"]')).toBe(itemElement);
    expect(screen.getByRole('button', { name: 'Service interval and metadata' })).toBe(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger.getAttribute('aria-controls')).toBe(disclosureId);
    expect(within(screen.getByRole('region', { name: 'Service interval and metadata' }))
      .getByText('12.346 km')).toBeInTheDocument();
    expect(source.interval_miles).toBe(12345.6789);
    expect(source.last_service_mileage).toBeNull();
    expect(h.request).not.toHaveBeenCalled();
  });

  it('updates SI distance and specialist currency precision without changing raw records', () => {
    const raw = record({ cost: 123.456, mileage: 23456.789 });
    h.records = query([raw]);
    const { rerender } = mount(<MaintenancePage />);
    expect(screen.getByText('23.46 km')).toBeInTheDocument();
    expect(screen.getAllByText('€123.46').length).toBeGreaterThanOrEqual(2);
    h.precision = 3;
    h.distance = 'mi';
    rerender(<MaintenancePage />);
    expect(screen.getByText('14.575 mi')).toBeInTheDocument();
    expect(screen.getAllByText('€123.456').length).toBeGreaterThanOrEqual(2);
    expect(raw.mileage).toBe(23456.789);
    expect(raw.cost).toBe(123.456);
  });

  it('keeps preview callback identity, all business-day evidence links and dismissal', () => {
    h.records = query([record()]);
    mount(<MaintenancePage />);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect service record' }));
    const dialog = screen.getByRole('dialog', { name: 'Annual inspection' });
    const drawer = within(dialog);
    expect(drawer.getByText('Evidence note remains verbatim')).toBeInTheDocument();
    expect(drawer.getByRole('link', { name: 'Vehicle' })).toHaveAttribute('href', '/vehicles/7');
    for (const [label, path] of [
      ['Drive history', '/drives'], ['Charging sessions', '/charging'],
      ['Visited locations', '/locations'], ['Alerts', '/notifications/inbox'],
      ['Telemetry evidence', '/signals'],
    ]) expect(drawer.getByRole('link', { name: label })).toHaveAttribute('href', `${path}?from=2024-03-01&to=2024-03-01`);
    expect(drawer.getByRole('link', { name: 'Build service evidence pack' }))
      .toHaveAttribute('href', '/diagnostics/service-evidence');
    expect(drawer.getAllByRole('button', { name: 'Close' })).toHaveLength(2);
    const footer = dialog.querySelector<HTMLElement>('[data-drawer-footer]');
    if (!footer) throw new Error('Service evidence drawer footer is missing');
    fireEvent.click(within(footer).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(h.request).not.toHaveBeenCalled();
  });

  it('calls the row preview with the actual record, not a stripped DTO or mutation', () => {
    const raw = record();
    const onPreview = vi.fn();
    const columns = buildServiceColumns((_key, fallback) => fallback, String, onPreview);
    const action = columns.find(column => column.key === 'actions');
    expect(action).toBeDefined();
    mount(<>{action?.render(raw)}</>);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect service record' }));
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenCalledWith(raw);
    expect(raw.notes).toBe('Evidence note remains verbatim');
    expect(h.request).not.toHaveBeenCalled();
  });

  it('keeps refresh retries and the inherited Schedule no-op without success/confirmation fiction', () => {
    const retryItems = vi.fn();
    const retryRecords = vi.fn();
    h.items = query(undefined, { isError: true, error: new Error('failed'), refetch: retryItems });
    h.records = query(undefined, { isError: true, error: new Error('failed'), refetch: retryRecords });
    mount(<MaintenancePage />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    expect(retryItems).toHaveBeenCalledTimes(1);
    expect(retryRecords).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh maintenance data' }));
    expect(retryItems).toHaveBeenCalledTimes(2);
    expect(retryRecords).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(h.request).not.toHaveBeenCalled();
  });

  it('keeps shared loaded-result CSV/JSON export and raw JSON measurements without API calls', async () => {
    h.records = query([record({ cost: 0 })]);
    mount(<MaintenancePage />);
    fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as JSON' }));
    await waitFor(() => expect(h.downloadJSON).toHaveBeenCalledTimes(1));
    expect(h.downloadJSON.mock.calls[0][1]).toEqual([
      expect.objectContaining({ date: '2024-03-01T10:00:00Z', mileage: 23456.789, cost: 0, provider: 'Original service provider' }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as CSV' }));
    await waitFor(() => expect(h.downloadCSV).toHaveBeenCalledTimes(1));
    expect(h.downloadCSV.mock.calls[0][1]).toContain('Original service provider');
    expect(h.request).not.toHaveBeenCalled();
  });

  it('uses a single canonical observer and provider spans for the seven cards', () => {
    const instances: {
      observe: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      callback: ResizeObserverCallback;
    }[] = [];
    class Observer {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      constructor(public callback: ResizeObserverCallback) { instances.push(this); }
    }
    vi.stubGlobal('ResizeObserver', Observer);
    const sizes = ['full', 'full', 'half', 'third', 'half', 'half', 'full'] as const;
    const { container, unmount } = mount(<CardGrid label="Maintenance" items={sizes.map((size, index) => ({
      id: String(index), size,
      content: <MaintenanceGridSlot><LayoutCard title={`Panel ${index}`}>Content {index}</LayoutCard></MaintenanceGridSlot>,
    }))} />);
    expect(instances).toHaveLength(1);
    expect(instances[0].observe).toHaveBeenCalledTimes(1);
    act(() => {
      instances[0].callback(
        [{ contentRect: { width: 1280 } } as unknown as ResizeObserverEntry],
        instances[0] as unknown as ResizeObserver,
      );
    });
    expect(Array.from(container.querySelectorAll('[data-card-resolved-span]'))
      .map(card => card.getAttribute('data-card-resolved-span'))).toEqual(['12', '12', '7', '5', '6', '6', '12']);
    unmount();
    expect(instances[0].disconnect).toHaveBeenCalledTimes(1);
  });
});
