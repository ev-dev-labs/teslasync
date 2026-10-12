import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { DataStateSource } from '@/api/dataState';
import type { ChargingForensicsItem, ChargingForensicsPage as ForensicsResponse } from '@/types/advancedIntelligence';
import { formatDateTime } from '@/lib/dateFormat';
import { downloadCSV, downloadJSON } from '@/lib/csvExport';
import ChargingForensicsPage from './ChargingForensicsPage';

const mocks = vi.hoisted(() => ({
  vehicleId: 4 as number | null,
  query: vi.fn(),
  refetch: vi.fn(),
  fetchAll: vi.fn(),
}));
vi.mock('@/api/hooks/useAdvancedIntelligence', () => ({
  useChargingForensics: mocks.query,
  fetchAllChargingForensics: mocks.fetchAll,
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: mocks.vehicleId }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDateTime: (value: string | null) => formatDateTime(value, { locale: 'en-GB', tz: 'Pacific/Auckland' }),
  }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { locale: 'en-US' },
    formatEnergy: (value: number | null) => value == null ? '—' : `${value / 1000} kWh`,
  }),
}));
vi.mock('@/lib/csvExport', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/csvExport')>(),
  downloadCSV: vi.fn(),
  downloadJSON: vi.fn(),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      const values = typeof fallbackOrOptions === 'string' ? options : fallbackOrOptions;
      const template = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : String(values?.defaultValue ?? key);
      return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ''));
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

function session(overrides: Partial<ChargingForensicsItem> = {}): ChargingForensicsItem {
  return {
    session_id: 44, started_at: '2026-06-01T12:30:00Z', ended_at: '2026-06-01T13:30:00Z',
    vehicle_energy_wh: 12000, meter_energy_wh: 15000,
    estimated_loss_wh: 3000, estimated_loss_low_wh: 2000, estimated_loss_high_wh: 4000,
    recorded_cost_minor: 450, expected_cost_minor: 420, cost_discrepancy_minor: 30,
    currency: 'USD', status: 'recorded_only',
    evidence: [{ source: 'test-ledger', summary: 'Test-only recorded energy, not a meter reading.',
      sample_count: 1, observed_at: '2026-06-01T12:30:00Z' }],
    limitations: ['Test-only tariff coverage is absent.'],
    ...overrides,
  };
}

function payload(overrides: Partial<ForensicsResponse> = {}): ForensicsResponse {
  return {
    items: [session()], total: 1, limit: 15, offset: 0,
    data_quality: { status: 'limited', sample_count: 1, coverage_pct: null,
      window_start: null, window_end: null, reasons: ['Test-only page-scoped evidence.'] },
    generated_at: '2026-06-01T14:00:00Z',
    ...overrides,
  };
}

function query(data?: ForensicsResponse, overrides: DataStateSource<ForensicsResponse> & { isPlaceholderData?: boolean } = {}) {
  return {
    data, isLoading: false, isFetching: false, isSuccess: data !== undefined, isError: false,
    isPlaceholderData: false, fetchStatus: 'idle', error: null,
    dataUpdatedAt: Date.UTC(2026, 5, 1, 14), refetch: mocks.refetch, ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<ChargingForensicsPage />, { wrapper: ({ children }) => (
    <MemoryRouter><QueryClientProvider client={client}>{children}</QueryClientProvider></MemoryRouter>
  ) });
}

const observers: { element: Element; callback: ResizeObserverCallback }[] = [];
function resize(width: number) {
  act(() => observers.forEach(({ element, callback }) => callback(
    [{ target: element, contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver,
  )));
}
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  observers.length = 0;
  mocks.vehicleId = 4;
  mocks.query.mockReturnValue(query(payload()));
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) { observers.push({ element, callback: this.callback }); }
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('ChargingForensicsPage', () => {
  it('preserves all nine reconciliation columns and source disclosures under a localized table name', () => {
    renderPage();
    const table = within(screen.getByRole('table', { name: 'Session reconciliation' }));
    for (const label of ['Session', 'Started', 'Vehicle energy', 'Meter energy', 'Estimated loss',
      'Recorded cost', 'Expected cost', 'Cost discrepancy', 'Status']) {
      expect(table.getByRole('columnheader', { name: label, exact: true })).toBeInTheDocument();
    }
    for (const value of ['#44', '2 Jun 2026, 00:30', '12 kWh', '15 kWh', '3 kWh (2 kWh–4 kWh)',
      '$4.50', '$4.20', '$0.30', 'recorded_only']) expect(table.getByText(value)).toBeInTheDocument();
    expect(screen.getByText('Null means unsupported, not zero')).toBeInTheDocument();
    expect(screen.getByText('test-ledger')).toBeInTheDocument();
    expect(screen.getByText(/Test-only page-scoped evidence/)).toBeInTheDocument();
    expect(screen.getByText(/Meter energy when no meter source is recorded/)).toBeInTheDocument();
    expect(screen.getByText(/Expected cost without supported tariff and currency data/)).toBeInTheDocument();
    expect(mocks.query).toHaveBeenCalledWith(4, 15, 0);
  });

  it('keeps every reconciliation value and session-associated evidence reachable in mobile details', async () => {
    renderPage();
    resize(375);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Quick view' }));
    const detail = within(await screen.findByRole('dialog', { name: 'Session #44' }));
    for (const value of ['#44', '12 kWh', '15 kWh', '3 kWh (2 kWh–4 kWh)', '$4.50', '$4.20',
      '$0.30', 'recorded_only', 'USD', '2 Jun 2026, 01:30', 'test-ledger',
      'Test-only recorded energy, not a meter reading.', 'Test-only tariff coverage is absent.']) {
      expect(detail.getByText(value)).toBeInTheDocument();
    }
    expect(detail.getByText('1 samples · 2 Jun 2026, 00:30')).toBeInTheDocument();
    fireEvent.click(detail.getByRole('button', { name: 'Close', exact: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    resize(1440);
    expect(screen.getByRole('table', { name: 'Session reconciliation' })).toBeInTheDocument();
  });

  it('keeps zero, signed loss and signed discrepancy distinct from unsupported fields', () => {
    mocks.query.mockReturnValue(query(payload({ items: [session({
      vehicle_energy_wh: 0, meter_energy_wh: null, estimated_loss_wh: -1000,
      estimated_loss_low_wh: -2000, estimated_loss_high_wh: 0,
      recorded_cost_minor: 0, expected_cost_minor: null, cost_discrepancy_minor: -30,
    })] })));
    renderPage();
    const table = within(screen.getByRole('table', { name: 'Session reconciliation' }));
    expect(table.getByText('0 kWh')).toBeInTheDocument();
    expect(table.getByText('-1 kWh (-2 kWh–0 kWh)')).toBeInTheDocument();
    expect(table.getByText('$0.00')).toBeInTheDocument();
    expect(table.getByText('-$0.30')).toBeInTheDocument();
    expect(table.getAllByText('Unsupported')).toHaveLength(2);
  });

  it('requests page one immediately on workspace vehicle change and return', () => {
    mocks.query.mockImplementation((_id: number, _limit: number, offset: number) => query(payload({ total: 65, offset })));
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(mocks.query).toHaveBeenLastCalledWith(4, 15, 15);
    mocks.vehicleId = 3;
    mocks.query.mockClear();
    view.rerender(<ChargingForensicsPage />);
    expect(mocks.query.mock.calls.every(([id, , offset]) => id === 3 && offset === 0)).toBe(true);
    mocks.vehicleId = 4;
    view.rerender(<ChargingForensicsPage />);
    expect(mocks.query).toHaveBeenLastCalledWith(4, 15, 0);
  });

  it('recovers page one from a successful out-of-range offset with an empty zero-total response', async () => {
    let shrunk = false;
    mocks.query.mockImplementation((_id: number, _limit: number, offset: number) =>
      query(payload({ total: shrunk && offset ? 0 : 65, offset, items: shrunk && offset ? [] : [session()] })));
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Last page' }));
    expect(mocks.query).toHaveBeenLastCalledWith(4, 15, 60);
    shrunk = true;
    view.rerender(<ChargingForensicsPage />);
    await waitFor(() => expect(mocks.query).toHaveBeenLastCalledWith(4, 15, 0));
    expect(screen.getByText('#44')).toBeInTheDocument();
  });

  it('retains navigation on a failed empty-page refresh rather than accepting its total as fresh', () => {
    mocks.query.mockImplementation((_id: number, _limit: number, offset: number) =>
      query(payload({ total: offset ? 0 : 65, offset, items: offset ? [] : [session()] }), offset
        ? { isSuccess: false, isError: true, error: new Error('Test-only refresh failure') } : {}));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('No charging sessions are available for reconciliation.')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(mocks.query).toHaveBeenLastCalledWith(4, 15, 0);
    expect(screen.getByText('#44')).toBeInTheDocument();
  });

  it.each([
    { case: 'refresh failure', state: { isError: true, isSuccess: false, error: new Error('Test-only refresh failure') },
      message: 'The refresh failed; the most recently loaded evidence remains visible.' },
    { case: 'paused refresh', state: { fetchStatus: 'paused' as const },
      message: 'Cached evidence remains visible while its refresh is paused.' },
  ])('retains reconciliation and evidence through $case', ({ state, message }) => {
    mocks.query.mockReturnValue(query(payload(), state));
    renderPage();
    expect(screen.getByText('#44')).toBeInTheDocument();
    expect(screen.getByText('test-ledger')).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh', exact: true }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it('keeps independent disclosure and evidence shells during initial loading and failure', () => {
    mocks.query.mockReturnValue(query(undefined, { isLoading: true, fetchStatus: 'fetching' }));
    const view = renderPage();
    expect(screen.getByRole('heading', { name: 'Session reconciliation' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Evidence, quality, and limitations' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    mocks.query.mockReturnValue(query(undefined, { isError: true, error: new Error('Test-only initial failure') }));
    view.rerender(<ChargingForensicsPage />);
    expect(screen.getByText('Intelligence evidence could not be loaded.')).toBeInTheDocument();
    expect(screen.getByText('Null means unsupported, not zero')).toBeInTheDocument();
    expect(screen.getByText('Explicitly unsupported')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it('distinguishes no selected vehicle, initial pause and resolved empty history', () => {
    mocks.vehicleId = null;
    mocks.query.mockReturnValue(query());
    const view = renderPage();
    expect(screen.getByText('Select a vehicle to load intelligence.')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
    mocks.vehicleId = 4;
    mocks.query.mockReturnValue(query(undefined, { fetchStatus: 'paused' }));
    view.rerender(<ChargingForensicsPage />);
    expect(screen.getByText('The initial evidence query is paused; no empty result is inferred.')).toBeInTheDocument();
    mocks.query.mockReturnValue(query(payload({ items: [], total: 0 })));
    view.rerender(<ChargingForensicsPage />);
    expect(screen.getByText('No charging sessions are available for reconciliation.')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
  });

  it.each(['json', 'csv'] as const)('preserves full-result raw SI and currency exports as %s independently of loaded rows', async format => {
    const offPage = session({ session_id: 99, estimated_loss_wh: -1000, cost_discrepancy_minor: -30 });
    mocks.fetchAll.mockResolvedValue([session(), offPage]);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
    fireEvent.click(screen.getByRole('menuitem', { name: format === 'json' ? 'Download as JSON' : 'Download as CSV' }));
    await waitFor(() => expect(format === 'json' ? downloadJSON : downloadCSV).toHaveBeenCalledOnce());
    expect(mocks.fetchAll).toHaveBeenCalledExactlyOnceWith(4);
    expect(screen.queryByText('#99')).not.toBeInTheDocument();
    if (format === 'json') {
      expect(downloadJSON).toHaveBeenCalledWith('charging-forensics', [
        expect.objectContaining({ session_id: 44, vehicle_energy_wh: 12000, meter_energy_wh: 15000,
          estimated_loss_low_wh: 2000, estimated_loss_high_wh: 4000, recorded_cost_minor: 450,
          expected_cost_minor: 420, currency: 'USD', status: 'recorded_only' }),
        expect.objectContaining({ session_id: 99, estimated_loss_wh: -1000, cost_discrepancy_minor: -30 }),
      ]);
    } else {
      expect(vi.mocked(downloadCSV).mock.calls[0]?.[1]).toContain('vehicle_energy_wh,meter_energy_wh,estimated_loss_wh');
      expect(vi.mocked(downloadCSV).mock.calls[0]?.[1]).toContain('12000,15000,-1000,2000,4000,450,420,-30,USD,recorded_only');
    }
  });
});
