import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createInstance, type i18n } from 'i18next';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { DataStateSource } from '@/api/dataState';
import type { ChargingForensicsItem, ChargingForensicsPage as ForensicsResponse } from '@/types/advancedIntelligence';
import { formatDateTime, formatTime } from '@/lib/dateFormat';
import { downloadCSV, downloadJSON } from '@/lib/csvExport';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import englishCatalog from '@/i18n/en.json';
import ChargingForensicsPage from './ChargingForensicsPage';

const mocks = vi.hoisted(() => ({
  vehicleId: 4 as number | null,
  query: vi.fn(),
  refetch: vi.fn(),
  fetchAll: vi.fn(),
  request: vi.fn(),
  realI18n: null as i18n | null,
}));
vi.mock('@/api/hooks/useAdvancedIntelligence', () => ({
  useChargingForensics: mocks.query,
  fetchAllChargingForensics: mocks.fetchAll,
}));
vi.mock('@/api/client', () => ({ request: mocks.request }));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: mocks.vehicleId }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDateTime: (value: string | null) => formatDateTime(value, { locale: 'en-GB', tz: 'Pacific/Auckland' }),
    formatTime: (value: string | Date | null | undefined) => formatTime(value, { locale: 'en-GB', tz: 'Pacific/Auckland' }),
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
      if (mocks.realI18n) return mocks.realI18n.t(key, { ...values, defaultValue: template });
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

const clients: QueryClient[] = [];
function renderPage(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  clients.push(client);
  return render(<ChargingForensicsPage />, { wrapper: ({ children }) => (
    <MemoryRouter><QueryClientProvider client={client}>{children}</QueryClientProvider></MemoryRouter>
  ) });
}

const observers: { element: Element; callback: ResizeObserverCallback }[] = [];
let savedNumberPreferences = getFormatterPreferences();
function resize(width: number) {
  act(() => observers.forEach(({ element, callback }) => callback(
    [{ target: element, contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver,
  )));
}
beforeEach(() => {
  savedNumberPreferences = getFormatterPreferences();
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  localStorage.clear();
  vi.clearAllMocks();
  mocks.request.mockReset();
  observers.length = 0;
  mocks.vehicleId = 4;
  mocks.realI18n = null;
  mocks.query.mockReturnValue(query(payload()));
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) { observers.push({ element, callback: this.callback }); }
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => {
  cleanup();
  setGlobalLocale(savedNumberPreferences.locale);
  setGlobalPrecision(savedNumberPreferences.precision);
  clients.forEach(client => client.clear());
  clients.length = 0;
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
});

describe('ChargingForensicsPage', () => {
  it('preserves all nine reconciliation columns and source disclosures under a localized table name', () => {
    renderPage();
    const table = within(screen.getByRole('table', { name: 'Session reconciliation' }));
    for (const label of ['Session', 'Started', 'Vehicle energy', 'Meter energy', 'Estimated loss',
      'Recorded cost', 'Expected cost', 'Cost discrepancy', 'Status']) {
      expect(table.getByRole('columnheader', { name: label })).toBeInTheDocument();
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
    const dialog = await screen.findByRole('dialog', { name: 'Session #44' });
    const detail = within(dialog);
    for (const value of ['#44', '12 kWh', '15 kWh', '3 kWh (2 kWh–4 kWh)', '$4.50', '$4.20',
      '$0.30', 'recorded_only', 'USD', '2 Jun 2026, 01:30', 'test-ledger',
      'Test-only recorded energy, not a meter reading.', 'Test-only tariff coverage is absent.']) {
      expect(detail.getByText(value)).toBeInTheDocument();
    }
    expect(detail.getByText('1 samples · 2 Jun 2026, 00:30')).toBeInTheDocument();
    const footer = dialog.querySelector<HTMLElement>('[data-modal-footer="true"]');
    expect(footer).not.toBeNull();
    fireEvent.click(within(footer!).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    resize(1440);
    expect(screen.getByRole('table', { name: 'Session reconciliation' })).toBeInTheDocument();
  });

  it('expands desktop records by keyboard with the same full fields as mobile quick view', async () => {
    const user = userEvent.setup();
    renderPage();
    const table = screen.getByRole('table', { name: 'Session reconciliation' });
    const expand = within(table).getByRole('button', { name: 'Expand row: Session #44' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    expand.focus();
    await user.keyboard('{Enter}');
    expect(expand).toHaveAttribute('aria-expanded', 'true');
    const expanded = table.querySelector('dl');
    expect(expanded).not.toBeNull();
    const detail = within(expanded!);
    for (const label of ['Session', 'Started', 'Vehicle energy', 'Meter energy', 'Estimated loss',
      'Recorded cost', 'Expected cost', 'Cost discrepancy', 'Status', 'Ended', 'Currency',
      'Evidence sources', 'Limitations']) {
      expect(detail.getByText(label)).toBeInTheDocument();
    }
    for (const value of ['#44', '12 kWh', '15 kWh', '3 kWh (2 kWh–4 kWh)', '$4.50', '$4.20',
      '$0.30', 'recorded_only', 'USD', '2 Jun 2026, 01:30', 'test-ledger',
      'Test-only recorded energy, not a meter reading.', 'Test-only tariff coverage is absent.']) {
      expect(detail.getByText(value)).toBeInTheDocument();
    }
    resize(375);
    const collapse = screen.getByRole('button', { name: 'Collapse row' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    collapse.focus();
    await user.keyboard(' ');
    expect(screen.getByRole('button', { name: 'Expand row' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('group', { name: 'Session reconciliation' }).querySelector('dl')).toBeNull();
    const quickView = screen.getByRole('button', { name: 'Quick view' });
    quickView.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Session #44' });
    expect(within(dialog).getByText('Test-only tariff coverage is absent.')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(quickView).toHaveFocus();
  });

  it('clears expanded records when the selected vehicle changes', async () => {
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Expand row: Session #44' }));
    expect(screen.getByRole('button', { name: 'Collapse row: Session #44' })).toBeInTheDocument();
    mocks.vehicleId = 5;
    view.rerender(<ChargingForensicsPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Expand row: Session #44' }))
      .toHaveAttribute('aria-expanded', 'false'));
  });

  describe('real-i18next mobile evidence sample counts', () => {
    beforeEach(async () => {
      mocks.realI18n = createInstance();
      await mocks.realI18n.init({
        lng: 'en',
        fallbackLng: false,
        interpolation: { escapeValue: false },
        resources: { en: { translation: englishCatalog } },
      });
    });

    async function mobileDetails(item: ChargingForensicsItem) {
      mocks.query.mockReturnValue(query(payload({ items: [item] })));
      renderPage();
      resize(375);
      fireEvent.click(screen.getByRole('button', { name: 'Quick view' }));
      return within(await screen.findByRole('dialog', { name: 'Session #44' }));
    }

    it('renders canonical mobile plurals from raw counts and reacts to number preferences without refetching', async () => {
      const counts = [1, 0, 2, 12345, 1.25];
      const evidence = counts.map((sample_count, index) => Object.freeze({
        source: `000001_012345-${index}`,
        summary: `Test-only observation ${index}.`,
        sample_count,
        observed_at: '2026-06-01T12:30:00Z',
      }));
      const item = session({ evidence });
      const detail = await mobileDetails(item);
      for (const label of ['1 sample', '0 samples', '2 samples', '12,345 samples', '1 samples']) {
        expect(detail.getByText(`${label} · 2 Jun 2026, 00:30`)).toBeInTheDocument();
      }
      expect(detail.queryByText(/\{\{formattedCount\}\}/)).not.toBeInTheDocument();
      act(() => { setGlobalLocale('de-DE'); });
      expect(detail.getByText('12.345 samples · 2 Jun 2026, 00:30')).toBeInTheDocument();
      act(() => { setGlobalLocale('fr-FR'); setGlobalPrecision(4); });
      expect(detail.getByText('12\u202f345 samples · 2 Jun 2026, 00:30', {
        normalizer: text => text,
      })).toBeInTheDocument();
      expect(detail.getByText('1 sample · 2 Jun 2026, 00:30')).toBeInTheDocument();
      expect(detail.getByText('1 samples · 2 Jun 2026, 00:30')).toBeInTheDocument();
      expect(evidence.map(observation => observation.sample_count)).toEqual(counts);
      for (const observation of evidence) {
        expect(detail.getByText(observation.source)).toBeInTheDocument();
        expect(detail.getByText(observation.summary)).toBeInTheDocument();
        expect(observation.observed_at).toBe('2026-06-01T12:30:00Z');
      }
      expect(mocks.refetch).not.toHaveBeenCalled();
      expect(mocks.request).not.toHaveBeenCalled();
      expect(item.evidence).toBe(evidence);
    });

    it.each([
      { kind: 'null', count: null },
      { kind: 'NaN', count: Number.NaN },
      { kind: 'positive infinity', count: Number.POSITIVE_INFINITY },
      { kind: 'negative infinity', count: Number.NEGATIVE_INFINITY },
    ])('keeps mobile $kind sample counts date-only rather than fabricating zero or a measurement', async ({ count }) => {
      const observation = Object.freeze({
        source: '000001_012345',
        summary: 'Test-only evidence with no known count.',
        sample_count: count,
        observed_at: '2026-06-01T12:30:00Z',
      });
      const detail = await mobileDetails(session({ evidence: [observation] }));
      expect(detail.getByText('000001_012345')).toBeInTheDocument();
      expect(detail.getByText(observation.summary)).toBeInTheDocument();
      expect(detail.getAllByText('2 Jun 2026, 00:30')).toHaveLength(2);
      expect(detail.queryByText(/samples? ·|\{\{formattedCount\}\}|NaN|Infinity/)).not.toBeInTheDocument();
      expect(Object.is(observation.sample_count, count)).toBe(true);
      expect(mocks.refetch).not.toHaveBeenCalled();
    });

    it('preserves unknown mobile observation dates and unsupported source capabilities independently of counted zero', async () => {
      const evidence = [
        { source: 'unknown-count-source', summary: 'Test-only unknown count and date.',
          sample_count: null, observed_at: null },
        { source: 'zero-count-source', summary: 'Test-only measured zero with no observation date.',
          sample_count: 0, observed_at: null },
        { source: 'invalid-date-source', summary: 'Test-only counted observation with invalid date.',
          sample_count: 1, observed_at: 'not-an-iso-instant' },
      ];
      const item = session({ meter_energy_wh: null, expected_cost_minor: null, evidence });
      const detail = await mobileDetails(item);
      expect(detail.getByText('0 samples · —')).toBeInTheDocument();
      expect(detail.getByText('1 sample · —')).toBeInTheDocument();
      expect(detail.getByText('—')).toBeInTheDocument();
      expect(detail.getAllByText('Unsupported')).toHaveLength(2);
      for (const observation of evidence) {
        expect(detail.getByText(observation.source)).toBeInTheDocument();
        expect(detail.getByText(observation.summary)).toBeInTheDocument();
      }
      expect(detail.getByText('Test-only tariff coverage is absent.')).toBeInTheDocument();
      expect(evidence.map(observation => observation.sample_count)).toEqual([null, 0, 1]);
      expect(evidence.map(observation => observation.observed_at)).toEqual([null, null, 'not-an-iso-instant']);
      expect(item.meter_energy_wh).toBeNull();
      expect(item.expected_cost_minor).toBeNull();
    });
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
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
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

  it.each(['json', 'csv'] as const)('exports nulls, zeroes, and complete record disclosures appropriately as %s', async format => {
    const unsupported = session({
      ended_at: null, vehicle_energy_wh: null, meter_energy_wh: null,
      estimated_loss_wh: null, estimated_loss_low_wh: null, estimated_loss_high_wh: null,
      recorded_cost_minor: null, expected_cost_minor: null, cost_discrepancy_minor: null,
      currency: null, evidence: [], limitations: [],
    });
    const recorded = session({
      session_id: 99, vehicle_energy_wh: 0, meter_energy_wh: 0,
      estimated_loss_wh: -1000, estimated_loss_low_wh: 0, estimated_loss_high_wh: 0,
      recorded_cost_minor: 0, expected_cost_minor: 0, cost_discrepancy_minor: -30,
      evidence: [{ source: 'meter,"A"', summary: 'Recorded reading\nnot an estimate.',
        sample_count: 0, observed_at: null }],
      limitations: ['Tariff, "unverified"\nNo inference.'],
    });
    mocks.fetchAll.mockResolvedValue([unsupported, recorded]);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
    fireEvent.click(screen.getByRole('menuitem', { name: format === 'json' ? 'Download as JSON' : 'Download as CSV' }));
    await waitFor(() => expect(format === 'json' ? downloadJSON : downloadCSV).toHaveBeenCalledOnce());
    if (format === 'json') {
      expect(downloadJSON).toHaveBeenCalledWith('charging-forensics', [unsupported, recorded]);
    } else {
      const csv = vi.mocked(downloadCSV).mock.calls[0]?.[1];
      expect(csv).toBe([
        'session_id,started_at,vehicle_energy_wh,meter_energy_wh,estimated_loss_wh,estimated_loss_low_wh,estimated_loss_high_wh,recorded_cost_minor,expected_cost_minor,cost_discrepancy_minor,currency,status,ended_at,evidence,limitations',
        '44,2026-06-01T12:30:00Z,,,,,,,,,,recorded_only,,[],[]',
        '99,2026-06-01T12:30:00Z,0,0,-1000,0,0,0,0,-30,USD,recorded_only,2026-06-01T13:30:00Z,' +
          '"[{""source"":""meter,\\""A\\"""",""summary"":""Recorded reading\\nnot an estimate."",""sample_count"":0,""observed_at"":null}]",' +
          '"[""Tariff, \\""unverified\\""\\nNo inference.""]"',
      ].join('\r\n'));
    }
  });

  describe('actual charging-forensics query evidence source', () => {
    async function useActualHook() {
      const actual = await vi.importActual<typeof import('@/api/hooks/useAdvancedIntelligence')>(
        '@/api/hooks/useAdvancedIntelligence',
      );
      mocks.query.mockImplementation(actual.useChargingForensics);
      return actual.advancedIntelligenceKeys;
    }

    function evidenceSource() {
      const source = screen.getByRole('region', { name: 'Data quality' }).parentElement;
      expect(source).not.toBeNull();
      return source!;
    }

    async function expectUnknownEvidence(status: 'initial' | 'initialFailure') {
      await waitFor(() => {
        expect(evidenceSource()).toHaveAttribute('data-source-status', status);
        expect(evidenceSource()).toHaveAttribute('data-source-provenance', 'unknown');
        for (const label of ['Data quality', 'Evidence sources', 'Limitations']) {
          expect(within(screen.getByRole('region', { name: label })).getByText('Unknown')).toBeVisible();
        }
        expect(screen.queryByText('Quality metadata is unsupported.')).not.toBeInTheDocument();
        expect(screen.queryByText('No supporting evidence was returned.')).not.toBeInTheDocument();
        expect(screen.queryByText('No additional limitations were returned.')).not.toBeInTheDocument();
        expect(screen.getByText('Explicitly unsupported')).toBeVisible();
        expect(screen.getByText(/Meter energy when no meter source is recorded/)).toBeVisible();
        expect(screen.getByText(/Expected cost without supported tariff and currency data/)).toBeVisible();
      });
    }

    it('uses only the actual current-page metadata, evidence and limitations when pagination changes', async () => {
      await useActualHook();
      const secondPage = payload({
        items: [session({
          session_id: 99,
          evidence: [{ source: 'second-page-ledger', summary: 'Test-only second-page observation.',
            sample_count: 0, observed_at: null }],
          limitations: ['Test-only second-page uncertainty.'],
        })],
        total: 30, offset: 15,
        data_quality: { status: 'insufficient', sample_count: 0, coverage_pct: 0,
          window_start: null, window_end: null, reasons: ['Test-only second-page quality.'] },
      });
      mocks.request.mockImplementation(async (path: string) =>
        path.endsWith('offset=15') ? secondPage : payload({ total: 30 }));
      renderPage();
      await screen.findByText('test-ledger');
      expect(evidenceSource()).toHaveAttribute('data-source-status', 'ok');
      expect(evidenceSource()).toHaveAttribute('data-source-provenance', 'cached');
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
      await screen.findByText('second-page-ledger');
      expect(mocks.request.mock.calls.map(([path]) => path)).toEqual([
        '/advanced-intelligence/charging-forensics?vehicle_id=4&limit=15&offset=0',
        '/advanced-intelligence/charging-forensics?vehicle_id=4&limit=15&offset=15',
      ]);
      const quality = within(screen.getByRole('region', { name: 'Data quality' }));
      expect(quality.getByText('Insufficient evidence')).toBeVisible();
      expect(quality.getByText('0')).toBeVisible();
      expect(quality.getByText('0.00%')).toBeVisible();
      expect(quality.getByText(/Test-only second-page quality/)).toBeVisible();
      expect(screen.getByText(/Test-only second-page uncertainty/)).toBeVisible();
      expect(screen.queryByText('test-ledger')).not.toBeInTheDocument();
      expect(screen.queryByText(/Test-only page-scoped evidence/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Test-only tariff coverage is absent/)).not.toBeInTheDocument();
      expect(screen.getByText('#99')).toBeVisible();
    });

    it('shows loading shells without returned-empty claims until the real request resolves', async () => {
      await useActualHook();
      let resolve!: (value: ForensicsResponse) => void;
      mocks.request.mockImplementation(() => new Promise<ForensicsResponse>(done => { resolve = done; }));
      renderPage();
      await waitFor(() => {
        for (const label of ['Data quality', 'Evidence sources', 'Limitations']) {
          expect(screen.getByRole('status', { name: `Loading ${label}` })).toBeVisible();
        }
      });
      expect(evidenceSource()).toHaveAttribute('data-source-status', 'initial');
      expect(evidenceSource()).toHaveAttribute('data-source-provenance', 'unknown');
      expect(evidenceSource()).toHaveAttribute('aria-busy', 'true');
      expect(screen.queryByText('No supporting evidence was returned.')).not.toBeInTheDocument();
      expect(screen.getByText('Explicitly unsupported')).toBeVisible();
      await act(async () => resolve(payload()));
      await screen.findByText('test-ledger');
      expect(evidenceSource()).toHaveAttribute('data-source-status', 'ok');
      expect(evidenceSource()).toHaveAttribute('aria-busy', 'false');
    });

    it('keeps a real cold-paused request unknown rather than claiming unsupported or empty readings', async () => {
      await useActualHook();
      onlineManager.setOnline(false);
      mocks.request.mockResolvedValue(payload());
      renderPage();
      await waitFor(() => expect(screen.getByText('The initial evidence query is paused; no empty result is inferred.')).toBeVisible());
      await expectUnknownEvidence('initial');
      expect(mocks.request).not.toHaveBeenCalled();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
    });

    it('leaves a genuinely disabled no-vehicle query unknown and performs no reading', async () => {
      await useActualHook();
      mocks.vehicleId = null;
      renderPage();
      await waitFor(() => expect(screen.getByText('Select a vehicle to load intelligence.')).toBeVisible());
      await expectUnknownEvidence('initial');
      expect(mocks.request).not.toHaveBeenCalled();
      expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
    });

    it('retries a real initial rejection and retains the actual response through refresh failure and recovery', async () => {
      const keys = await useActualHook();
      const retained = payload();
      const recovered = payload({ items: [session({ session_id: 45 })] });
      mocks.request.mockRejectedValueOnce(new Error('Test-only initial read failure'))
        .mockResolvedValueOnce(retained)
        .mockRejectedValueOnce(new Error('Test-only retained refresh failure'))
        .mockResolvedValueOnce(recovered);
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      renderPage(client);
      await screen.findByText('Intelligence evidence could not be loaded.');
      await expectUnknownEvidence('initialFailure');
      const retry = screen.getAllByRole('button', { name: 'Retry' });
      expect(retry).toHaveLength(1);
      fireEvent.click(retry[0]);
      await screen.findByText('test-ledger');
      expect(screen.getByText('#44')).toBeVisible();
      const key = keys.chargingForensics(4, 15, 0);
      const successfulAt = client.getQueryState(key)?.dataUpdatedAt;
      await act(async () => { await client.refetchQueries({ queryKey: key }); });
      await screen.findByText('The refresh failed; the most recently loaded evidence remains visible.');
      expect(client.getQueryData(key)).toBe(retained);
      expect(client.getQueryState(key)?.dataUpdatedAt).toBe(successfulAt);
      expect(evidenceSource()).toHaveAttribute('data-source-status', 'stale');
      expect(evidenceSource()).toHaveAttribute('data-source-provenance', 'cached');
      expect(screen.getByText('test-ledger')).toBeVisible();
      expect(screen.getByText('#44')).toBeVisible();
      expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(1);
      const refresh = screen.getAllByRole('button', { name: 'Refresh' });
      expect(refresh).toHaveLength(1);
      fireEvent.click(refresh[0]);
      await screen.findByText('#45');
      await waitFor(() => expect(evidenceSource()).toHaveAttribute('data-source-status', 'ok'));
      expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
      expect(mocks.request).toHaveBeenCalledTimes(4);
      expect(client.getQueryData(key)).not.toBe(retained);
      expect(client.getQueryData(key)).toStrictEqual(recovered);
    });

    it('retains real page evidence when an offline refresh is paused with one caller-owned recovery action', async () => {
      const keys = await useActualHook();
      mocks.request.mockResolvedValue(payload());
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      renderPage(client);
      await screen.findByText('test-ledger');
      onlineManager.setOnline(false);
      act(() => { void client.refetchQueries({ queryKey: keys.chargingForensics(4, 15, 0) }); });
      await screen.findByText('Cached evidence remains visible while its refresh is paused.');
      expect(evidenceSource()).toHaveAttribute('data-source-status', 'stale');
      expect(evidenceSource()).toHaveAttribute('data-source-provenance', 'cached');
      expect(screen.getByText('#44')).toBeVisible();
      expect(screen.getByText('test-ledger')).toBeVisible();
      expect(screen.getByText(/Test-only page-scoped evidence/)).toBeVisible();
      expect(screen.getByText(/Test-only tariff coverage is absent/)).toBeVisible();
      expect(screen.getAllByRole('button', { name: 'Refresh' })).toHaveLength(1);
      expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(1);
      expect(mocks.request).toHaveBeenCalledOnce();
    });

    it('claims returned-empty evidence only after a real empty response and retains its metadata on error', async () => {
      const keys = await useActualHook();
      const empty = payload({ items: [], total: 0,
        data_quality: { status: 'insufficient', sample_count: 0, coverage_pct: null,
          window_start: null, window_end: null, reasons: ['Test-only authoritative empty page.'] } });
      mocks.request.mockResolvedValueOnce(empty).mockRejectedValueOnce(new Error('Test-only empty refresh failure'));
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      renderPage(client);
      await screen.findByText('No supporting evidence was returned.');
      await waitFor(() => {
        expect(screen.getByText('No charging sessions are available for reconciliation.')).toBeVisible();
        expect(screen.getByText('No additional limitations were returned.')).toBeVisible();
        expect(screen.getByText('Insufficient evidence')).toBeVisible();
        expect(within(screen.getByRole('region', { name: 'Data quality' })).getByText('0')).toBeVisible();
      });
      expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
      expect(evidenceSource()).toHaveAttribute('data-source-status', 'ok');
      await act(async () => {
        await client.refetchQueries({ queryKey: keys.chargingForensics(4, 15, 0) });
      });
      await screen.findByText('The refresh failed; the most recently loaded evidence remains visible.');
      expect(evidenceSource()).toHaveAttribute('data-source-status', 'stale');
      expect(screen.getByText('No supporting evidence was returned.')).toBeVisible();
      expect(screen.getByText(/Test-only authoritative empty page/)).toBeVisible();
      expect(screen.getByText('No additional limitations were returned.')).toBeVisible();
      expect(screen.getAllByRole('button', { name: 'Refresh' })).toHaveLength(2);
      expect(within(evidenceSource()).queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
      expect(client.getQueryData(keys.chargingForensics(4, 15, 0))).toBe(empty);
    });
  });
});
