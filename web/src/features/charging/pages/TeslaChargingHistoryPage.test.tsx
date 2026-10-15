import './__tests__/TeslaChargingHistoryPage.test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { request } from '@/api/client';
import type { TeslaChargingHistoryEntry, TeslaChargingHistoryResponse } from '@/api/hooks/useCharging';
import type { AppSettings } from '@/api/types';
import { formatDateTime } from '@/lib/dateFormat';
import { ToastProvider } from '@/components/feedback/Toast';
import { ApiError } from '@/lib/resilience';
import TeslaChargingHistoryPage from './TeslaChargingHistoryPage';

const vehicle = { id: 1, vehicle_id: 1, vin: 'QA_HISTORY_VEHICLE', display_name: 'History fixture', state: 'online' };
const clients: QueryClient[] = [];

function readExport(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result) : reject(new Error('Export did not contain text'));
    reader.onerror = () => reject(reader.error ?? new Error('Export could not be read'));
    reader.readAsText(blob);
  });
}

function billingEntry(overrides: Partial<TeslaChargingHistoryEntry> = {}): TeslaChargingHistoryEntry {
  return {
    id: 41, session_id: 41, vin: vehicle.vin,
    site_location_name: 'Synthetic charging location with a complete long billing label',
    charge_start_datetime: '2024-01-15T10:00:00Z',
    charge_stop_datetime: '2024-01-15T11:00:00Z',
    country: null, state: null, county: null, postal_code: null,
    billing_type: null, fee_type: null, currency_code: 'EUR', pricing_type: 'kWh',
    rate_base: 0.42, usage_wh: 50_000, total_due: 12.5,
    has_invoice: true, invoice_content_id: 'synthetic/invoice',
    fetched_at: '2024-01-16T00:00:00Z', created_at: '2024-01-16T00:00:00Z',
    ...overrides,
  };
}

function response(entries = [billingEntry()]): TeslaChargingHistoryResponse {
  return {
    entries,
    summary: { total_sessions: entries.length, total_wh: 50_000, total_spend: 12.5, avg_cost_per_kwh: 0.25 },
  };
}

function installTransport(payload: unknown, historyError?: Error, settings: Partial<AppSettings> = {}) {
  vi.mocked(request).mockImplementation((path) => {
    if (path === '/settings') return Promise.resolve(settings);
    if (path.startsWith('/vehicles')) return Promise.resolve([vehicle]);
    if (path.startsWith('/tesla/charging/history/sites')) return Promise.resolve({
      sites: [{ site: 'Independent synthetic price source', visits: 2, total_wh: 100_000, total_spend: 24, avg_per_kwh: 0.24, last_visit: '2024-01-15' }],
      unpriced_count: 1,
    });
    if (path.startsWith('/tesla/charging/history/refresh')) return Promise.resolve(payload);
    if (path.startsWith('/tesla/charging/history')) {
      return historyError ? Promise.reject(historyError) : Promise.resolve(payload);
    }
    return Promise.resolve({});
  });
}

function installVehiclePrerequisite(load: () => Promise<unknown>, payload = response()) {
  installTransport(payload);
  const transport = vi.mocked(request).getMockImplementation();
  if (!transport) throw new Error('Synthetic transport is missing');
  vi.mocked(request).mockImplementation((path, options) =>
    path.startsWith('/vehicles') ? load() : transport(path, options));
}

function billingReads() {
  return vi.mocked(request).mock.calls.filter(([path]) => path.startsWith('/tesla/charging/history'));
}

function mount(width = 1024, route = '/tesla-charging-history?from=2024-01-01&to=2024-01-31') {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, width, 600));
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(width);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const mounted = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <ToastProvider><TeslaChargingHistoryPage /></ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...mounted, client };
}

afterEach(() => {
  clients.splice(0).forEach(client => client.clear());
  onlineManager.setOnline(true);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Tesla charging history adoption', () => {
  it('blocks unresolved active vehicle loading and resumes only with a usable VIN', async () => {
    let resolveVehicles: ((value: unknown) => void) | undefined;
    installVehiclePrerequisite(() => new Promise(resolve => { resolveVehicles = resolve; }));
    mount();
    expect(screen.getByRole('button', { name: 'Refresh from Tesla' })).toBeDisabled();
    expect(screen.getByText('Loading')).toBeInTheDocument();
    expect(billingReads()).toHaveLength(0);
    expect(screen.queryByText('No priced Supercharger visits yet.')).not.toBeInTheDocument();
    await act(async () => { resolveVehicles?.([vehicle]); });
    await screen.findByText('€12.50');
    expect(billingReads().every(([path]) => path.includes(`vin=${vehicle.vin}`))).toBe(true);
  });

  it('does not interpret a paused vehicle prerequisite as an empty fleet', async () => {
    onlineManager.setOnline(false);
    installTransport(response());
    mount();
    expect(await screen.findAllByText('Refresh paused')).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Refresh from Tesla' })).toBeDisabled();
    expect(billingReads()).toHaveLength(0);
    expect(screen.queryByText('No charging sessions yet')).not.toBeInTheDocument();
    await act(async () => { onlineManager.setOnline(true); });
    await screen.findByText('€12.50');
    expect(screen.getByRole('button', { name: 'Refresh from Tesla' })).toBeEnabled();
  });

  it('keeps successful empty vehicles unresolved until fleet mode is deliberately selected', async () => {
    installVehiclePrerequisite(() => Promise.resolve([]), {
      entries: [], summary: { total_sessions: 0, total_wh: 0, total_spend: 0, avg_cost_per_kwh: 0 },
    });
    mount();
    await waitFor(() => expect(screen.queryByText('Loading')).not.toBeInTheDocument());
    expect(billingReads()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Refresh from Tesla' })).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Select vehicle' }), { target: { value: '*' } });
    await screen.findAllByText('No charging sessions yet');
    expect(billingReads().some(([path]) => path === '/tesla/charging/history')).toBe(true);
    expect(screen.getByText('Total sessions').closest('[data-operational-metric]')
      ?.querySelector('[data-operational-value]')).toHaveTextContent('0');
  });

  it('shows initial prerequisite failure, retries vehicles rather than unscoped billing, and recovers', async () => {
    installVehiclePrerequisite(() => Promise.reject(new ApiError('Synthetic vehicle failure', 500)));
    mount();
    await screen.findByText('Server error');
    expect(billingReads()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Refresh from Tesla' })).toBeDisabled();
    installTransport(response());
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    await screen.findByText('€12.50');
    expect(billingReads().every(([path]) => path.includes(`vin=${vehicle.vin}`))).toBe(true);
  });

  it('preserves usable vehicle scope and billing on retained vehicle refresh failure and recovery', async () => {
    installTransport(response());
    const { client } = mount(375);
    await screen.findByRole('button', { name: 'Quick view' });
    installVehiclePrerequisite(() => Promise.reject(new ApiError('Synthetic vehicle refresh failure', 500)));
    await act(async () => { await client.refetchQueries({ queryKey: ['vehicles'] }); });
    expect(await screen.findByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quick view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh from Tesla' })).toBeEnabled();
    expect(billingReads().every(([path]) => path.includes(`vin=${vehicle.vin}`))).toBe(true);
    installTransport(response());
    await act(async () => { await client.refetchQueries({ queryKey: ['vehicles'] }); });
    await waitFor(() => expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Quick view' })).toBeInTheDocument();
  });

  it('keeps deliberate fleet billing usable through a vehicle prerequisite failure', async () => {
    installVehiclePrerequisite(() => Promise.reject(new ApiError('Synthetic vehicle failure', 500)));
    mount(375, '/tesla-charging-history?vin=*&from=2024-01-01&to=2024-01-31');
    await screen.findByRole('button', { name: 'Quick view' });
    expect(await screen.findByText('Server error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh from Tesla' })).toBeEnabled();
    expect(billingReads().every(([path]) => !path.includes('vin='))).toBe(true);
  });

  it('retains billing through paused vehicle refresh without enabling sync or broadening scope', async () => {
    installTransport(response());
    const { client } = mount(375);
    await screen.findByRole('button', { name: 'Quick view' });
    onlineManager.setOnline(false);
    await act(async () => { await client.refetchQueries({ queryKey: ['vehicles'] }); });
    expect(await screen.findByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true');
    expect(screen.getByRole('button', { name: 'Quick view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh from Tesla' })).toBeDisabled();
    expect(billingReads().every(([path]) => path.includes(`vin=${vehicle.vin}`))).toBe(true);
    await act(async () => { onlineManager.setOnline(true); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh from Tesla' })).toBeEnabled());
  });

  it('recovers a range-empty view to all time without syncing or clearing search', async () => {
    installTransport(response());
    mount(375, '/tesla-charging-history?from=2024-02-01&to=2024-02-29&q=Synthetic');
    await screen.findByRole('button', { name: 'All time' });
    expect(screen.getAllByText('No sessions in this range')).toHaveLength(3);
    expect(screen.getByText('Charging sessions')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search by location…')).toHaveValue('Synthetic');
    fireEvent.click(screen.getByRole('button', { name: 'All time' }));
    await screen.findByRole('button', { name: 'Quick view' });
    expect(screen.getByPlaceholderText('Search by location…')).toHaveValue('Synthetic');
    expect(screen.queryByText('No sessions in this range')).not.toBeInTheDocument();
    expect(vi.mocked(request).mock.calls.some(([path]) => path.includes('/history/refresh'))).toBe(false);
  });

  it.each([
    { entries: [], summary: { ...response().summary, total_sessions: 1 } },
    { entries: null, summary: { ...response([]).summary, total_sessions: 0 } },
    { summary: { ...response([]).summary, total_sessions: 0 } },
    { entries: [] },
  ])('does not claim lifetime-empty for an incomplete or contradictory response %#', async (payload) => {
    installTransport(payload);
    mount();
    await screen.findAllByText('Tesla charging history has not loaded. Retry this source or reconnect to continue.');
    expect(screen.getByText('Charging sessions')).toBeInTheDocument();
    expect(screen.queryByText('No charging sessions yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'All time' })).not.toBeInTheDocument();
    const before = vi.mocked(request).mock.calls.filter(([path]) => path === '/tesla/charging/history?vin=QA_HISTORY_VEHICLE').length;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(vi.mocked(request).mock.calls.filter(([path]) => path === '/tesla/charging/history?vin=QA_HISTORY_VEHICLE').length).toBeGreaterThan(before));
    expect(vi.mocked(request).mock.calls.some(([path]) => path.includes('/history/refresh'))).toBe(false);
  });

  it('uses saved date preferences in mobile metadata and details without localizing exports', async () => {
    const row = billingEntry({
      charge_start_datetime: '2024-01-16T00:30:00Z',
      fetched_at: '2024-01-16T01:30:00Z',
    });
    const opts = { locale: 'de-DE', tz: 'America/Los_Angeles' };
    installTransport(response([row]), undefined, {
      locale: opts.locale, tz_display_default: 'user', timezone_user: opts.tz,
    });
    const create = vi.fn<(blob: Blob) => string>(() => 'blob:date-preferences');
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = vi.fn();
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    mount(375);
    await screen.findByText(`Last synced: ${formatDateTime(row.fetched_at, opts)}`);
    expect(screen.getAllByText(formatDateTime(row.charge_start_datetime, opts)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Quick view' }));
    expect(within(screen.getByRole('dialog')).getByText('Date', { selector: 'dt' }).nextElementSibling)
      .toHaveTextContent(formatDateTime(row.charge_start_datetime, opts));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /close/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /JSON/ }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(JSON.parse(await readExport(create.mock.calls[0][0]))[0].date).toBe(row.charge_start_datetime);
  });

  it.each(['garbage', ''])('handles source freshness date %s without inventing a date', async (fetchedAt) => {
    installTransport(response([billingEntry({ fetched_at: fetchedAt })]), undefined, {
      locale: 'de-DE', tz_display_default: 'user', timezone_user: 'Asia/Tokyo',
    });
    mount(375);
    await screen.findByRole('button', { name: 'Quick view' });
    if (fetchedAt) expect(screen.getByText('Last synced: —')).toBeInTheDocument();
    else expect(screen.queryByText(/Last synced:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
  });

  it.each([
    [null, 0, '0.00 · —'],
    ['', -2.25, '-2.25 · —'],
    ['   ', 0.125, '0.13 · —'],
    ['$', -0.125, '$ -0.13'],
    ['not-a-code', 1.125, 'not-a-code 1.13'],
    ['EUR', 0, '€0.00'],
    ['EUR', null, '—'],
    ['EUR', NaN, '—'],
    ['EUR', Infinity, '—'],
  ])('does not guess denomination for source %s and amount %s', async (currency, amount, display) => {
    installTransport(response([billingEntry({ currency_code: currency, total_due: amount })]));
    mount(375);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Quick view' }))[0]);
    const detail = within(screen.getByRole('dialog'));
    expect(detail.getByText('Cost', { selector: 'dt' }).nextElementSibling).toHaveTextContent(display);
    expect(screen.getByText('Total spend').closest('[data-operational-metric]')
      ?.querySelector('[data-operational-value]')).toHaveTextContent('12.50 · —');
  });

  it.each([
    ['cost', 'asc'], ['cost', 'desc'], ['energy', 'asc'], ['energy', 'desc'],
  ])('places missing and invalid %s last when sorting %s', async (sort, dir) => {
    installTransport(response([null, NaN, 0, -1.25, 0.5].map((value, id) => billingEntry({
      id, session_id: id, site_location_name: `Amount ${id}`,
      total_due: value, usage_wh: value,
    }))));
    mount(375, `/tesla-charging-history?from=2024-01-01&to=2024-01-31&sort=${sort}&dir=${dir}`);
    await screen.findAllByRole('button', { name: 'Quick view' });
    // The visible cards follow the externally controlled table sort.
    const table = screen.getByRole('group', { name: 'Charging sessions' });
    const order = () => within(table).getAllByText(/^Amount \d$/, { selector: '*' })
      .filter(element => element.children.length === 0).map(element => element.textContent);
    expect(order()).toEqual(dir === 'asc'
      ? ['Amount 3', 'Amount 2', 'Amount 4', 'Amount 0', 'Amount 1']
      : ['Amount 4', 'Amount 2', 'Amount 3', 'Amount 0', 'Amount 1']);
  });

  it('keeps invalid mobile billing unknown while exposing partial subtotals', async () => {
    installTransport(response([billingEntry({ usage_wh: NaN, total_due: Infinity, rate_base: NaN })]));
    mount(375);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Quick view' }))[0]);
    const detail = within(screen.getByRole('dialog'));
    for (const label of ['Energy', 'Cost', 'Rate']) {
      expect(detail.getByText(label, { selector: 'dt' }).nextElementSibling).toHaveTextContent('—');
    }
    expect(screen.getAllByText(/Recorded subtotal: — · 1 missing/).length).toBeGreaterThan(0);
  });

  it('preserves signed fractional billing and a measured zero duration in mobile details', async () => {
    installTransport(response([billingEntry({
      usage_wh: -1250.5, total_due: -2.25, rate_base: -0.125,
      charge_stop_datetime: '2024-01-15T10:00:00Z',
    })]));
    mount(375);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Quick view' }))[0]);
    const detail = within(screen.getByRole('dialog'));
    expect(detail.getByText('-1.25 kWh')).toBeInTheDocument();
    expect(detail.getByText('-€2.25')).toBeInTheDocument();
    expect(detail.getByText('-0.13/kWh')).toBeInTheDocument();
    expect(detail.getByText('0m')).toBeInTheDocument();
    expect(screen.getByText('Total duration').closest('[data-operational-metric]')
      ?.querySelector('[data-operational-value]')).toHaveTextContent('0m');
  });

  it.each([375, 1024])('localizes positive durations in the summary and session details at width %s', async width => {
    installTransport(response([billingEntry({
      charge_stop_datetime: '2024-01-15T11:05:08Z',
    })]), undefined, { locale: 'de-DE', decimal_precision: 0 });
    const { client } = mount(width);
    await screen.findAllByText('1h 5,13m');
    const metric = screen.getByText('Total duration').closest('[data-operational-metric]');
    expect(metric?.querySelector('[data-operational-value]')).toHaveTextContent('1h 5,13m');
    if (width === 375) {
      fireEvent.click(screen.getByRole('button', { name: 'Quick view' }));
      expect(within(screen.getByRole('dialog')).getByText('1h 5,13m')).toBeInTheDocument();
    } else {
      expect(screen.getAllByText('1h 5,13m').length).toBeGreaterThanOrEqual(2);
    }
    act(() => client.setQueryData(['settings'], { locale: 'en-US', decimal_precision: 3 }));
    await waitFor(() => expect(metric?.querySelector('[data-operational-value]')).toHaveTextContent('1h 5.13m'));
    expect(screen.queryByText('1h 5,13m')).not.toBeInTheDocument();
  });

  it('keeps all seven billing fields and the invoice action reachable in mobile details', async () => {
    const payload = response();
    installTransport(payload);
    mount(375);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Quick view' }))[0]);
    const detail = within(screen.getByRole('dialog'));
    for (const label of ['Date', 'Location', 'Duration', 'Energy', 'Cost', 'Rate', 'Invoice']) {
      expect(detail.getByText(label, { selector: 'dt' })).toBeInTheDocument();
    }
    expect(detail.getByText(payload.entries[0].site_location_name)).toBeInTheDocument();
    expect(detail.getByText('1h 0m')).toBeInTheDocument();
    expect(detail.getByText('50.00 kWh')).toBeInTheDocument();
    expect(detail.getByText('€12.50')).toBeInTheDocument();
    expect(detail.getByText('0.42/kWh')).toBeInTheDocument();
    expect(detail.getByRole('link', { name: 'Download invoice' }))
      .toHaveAttribute('href', '/api/v1/tesla/charging/invoice/synthetic%2Finvoice');
    expect(detail.getByRole('link', { name: 'Download invoice' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(detail.queryByText(vehicle.vin)).not.toBeInTheDocument();
    expect(payload.entries[0].usage_wh).toBe(50_000);
    expect(payload.entries[0].total_due).toBe(12.5);
  });

  it('distinguishes measured zero from unknown billing amounts and absent invoices on mobile', async () => {
    installTransport(response([billingEntry({
      usage_wh: 0, total_due: 0, rate_base: null,
      charge_stop_datetime: null, has_invoice: false, invoice_content_id: null,
    })]));
    mount(375);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Quick view' }))[0]);
    const dialog = screen.getByRole('dialog');
    const detail = within(dialog);
    expect(detail.getByText('0.00 kWh')).toBeInTheDocument();
    expect(detail.getByText('€0.00')).toBeInTheDocument();
    for (const label of ['Duration', 'Rate', 'Invoice']) {
      expect(detail.getByText(label, { selector: 'dt' }).nextElementSibling).toHaveTextContent('—');
    }
    expect(detail.queryByRole('link', { name: 'Download invoice' })).not.toBeInTheDocument();
  });

  it('keeps selection and selected CSV export available in the mobile presentation', async () => {
    const location = '  Synthetic, "quoted"\r\ncharging location  ';
    installTransport(response([billingEntry({ site_location_name: location })]));
    const create = vi.fn<(blob: Blob) => string>(() => 'blob:synthetic-charging-export');
    const revoke = vi.fn();
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    mount(375);
    await screen.findByRole('button', { name: 'Quick view' });
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Select Synthetic, "quoted"/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(create).toHaveBeenCalledOnce();
    const blob = create.mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    const csv = await readExport(blob);
    expect(csv).toContain('date,location,duration_minutes,energy_wh,cost,currency,rate_base,pricing_type,invoice_id');
    expect(csv).toContain('"  Synthetic, ""quoted""\r\ncharging location  "');
    expect(csv).toContain('"60","50000","12.5","EUR","0.42","kWh","synthetic/invoice"');
    expect(click).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('blob:synthetic-charging-export');
  });

  it.each(['csv', 'json'] as const)('exports the complete %s schema for matching and selected loaded scopes', async (format) => {
    const first = billingEntry({
      site_location_name: 'Match, "first"\r\nlocation',
      usage_wh: -1250.5, total_due: -2.255, currency_code: ' EUR ',
      rate_base: -0.1255, pricing_type: 'minute',
      charge_stop_datetime: '2024-01-15T10:00:30Z',
    });
    const second = billingEntry({ id: 42, session_id: 42, site_location_name: 'Match second',
      usage_wh: 0, total_due: 0, currency_code: null, rate_base: null, pricing_type: null,
      invoice_content_id: null, charge_stop_datetime: null });
    const payload = response([first, second,
      billingEntry({ id: 43, session_id: 43, site_location_name: 'Excluded by search' }),
      billingEntry({ id: 44, session_id: 44, site_location_name: 'Match outside range',
        charge_start_datetime: '2023-01-15T10:00:00Z' }),
    ]);
    const original = structuredClone(payload);
    installTransport(payload);
    const create = vi.fn<(blob: Blob) => string>(() => 'blob:history-schema');
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = vi.fn();
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    mount(375, '/tesla-charging-history?from=2024-01-01&to=2024-01-31&q=Match');
    await screen.findAllByRole('button', { name: 'Quick view' });
    fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
    fireEvent.click(screen.getByRole('menuitem', { name: format === 'csv' ? /CSV/ : /JSON/ }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const matching = await readExport(create.mock.calls[0][0]);
    const expected = {
      date: first.charge_start_datetime, location: first.site_location_name,
      duration_minutes: 0.5, energy_wh: -1250.5, cost: -2.255, currency: ' EUR ',
      rate_base: -0.1255, pricing_type: 'minute', invoice_id: 'synthetic/invoice',
    };
    if (format === 'json') {
      expect(JSON.parse(matching)).toEqual([expected, {
        date: second.charge_start_datetime, location: second.site_location_name,
        duration_minutes: null, energy_wh: 0, cost: 0, currency: '',
        rate_base: null, pricing_type: '', invoice_id: '',
      }]);
    } else {
      expect(matching.startsWith(Object.keys(expected).join(','))).toBe(true);
      expect(matching).toContain('"Match, ""first""\r\nlocation","0.5","-1250.5","-2.255"," EUR ","-0.1255","minute","synthetic/invoice"');
      expect(matching).toContain('"Match second","","0","0","","","",""');
    }
    expect(matching).not.toContain('Excluded');
    expect(matching).not.toContain('outside range');
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Select Match, "first"/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
    fireEvent.click(screen.getByRole('menuitem', { name: format === 'csv' ? /CSV/ : /JSON/ }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    const selected = await readExport(create.mock.calls[1][0]);
    if (format === 'json') expect(JSON.parse(selected)).toEqual([expected]);
    else {
      expect(selected).toContain('"Match, ""first""\r\nlocation"');
      expect(selected).not.toContain('Match second');
    }
    expect(payload).toEqual(original);
  });

  it('uses exact rolling boundaries without replacing the lifetime summary', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    installTransport(response([
      billingEntry({ id: 1, session_id: 1, site_location_name: 'Before rolling start', charge_start_datetime: '2024-01-14T11:59:59Z' }),
      billingEntry({ id: 2, session_id: 2, site_location_name: 'At rolling start', charge_start_datetime: '2024-01-14T12:00:00Z' }),
      billingEntry({ id: 3, session_id: 3, site_location_name: 'Inside rolling window', charge_start_datetime: '2024-01-15T11:59:59Z' }),
      billingEntry({ id: 4, session_id: 4, site_location_name: 'At exclusive rolling end', charge_start_datetime: '2024-01-15T12:00:00Z' }),
    ]));
    mount(375, '/tesla-charging-history?from=2024-01-14&to=2024-01-15&time_scope=24h');
    await screen.findAllByRole('button', { name: 'Quick view' });
    expect(screen.getAllByRole('button', { name: 'Quick view' })).toHaveLength(2);
    expect(screen.getByRole('progressbar', { name: 'At rolling start' })).toHaveAttribute('aria-valuenow', '12.5');
    expect(screen.getByRole('progressbar', { name: 'Inside rolling window' })).toHaveAttribute('aria-valuenow', '12.5');
    expect(screen.queryByText('Before rolling start')).not.toBeInTheDocument();
    expect(screen.queryByText('At exclusive rolling end')).not.toBeInTheDocument();
    expect(screen.getByText('Total sessions').closest('[data-operational-metric]')?.querySelector('[data-operational-value]')).toHaveTextContent('4');
  });

  it('retains mobile billing and independent price data through a history refresh failure', async () => {
    const payload = response();
    installTransport(payload);
    const { client } = mount(375);
    await screen.findByRole('button', { name: 'Quick view' });
    installTransport(payload, new ApiError('Synthetic history refresh failure', 500));
    await act(async () => {
      await client.refetchQueries({ queryKey: ['tesla-charging-history'] });
    });
    expect(await screen.findByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quick view' })).toBeInTheDocument();
    expect(screen.getByText(/Independent synthetic price source/)).toBeInTheDocument();
    expect(screen.queryByText('Server error')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Quick view' }));
    expect(within(screen.getByRole('dialog')).getByRole('link', { name: 'Download invoice' })).toBeInTheDocument();
  });

  it('keeps paused billing visible and blocks sync without claiming a failed source', async () => {
    installTransport(response());
    const { client } = mount(375);
    await screen.findByRole('button', { name: 'Quick view' });
    onlineManager.setOnline(false);
    await act(async () => {
      await client.refetchQueries({ queryKey: ['tesla-charging-history'] });
    });
    expect(await screen.findByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true');
    expect(screen.getByRole('button', { name: 'Refresh from Tesla' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Quick view' })).toBeInTheDocument();
    expect(screen.queryByText('Server error')).not.toBeInTheDocument();
  });

  it('reports sync as busy until the real mutation promise settles', async () => {
    const payload = response();
    installTransport(payload);
    mount();
    await screen.findByText('€12.50');
    let complete: (() => void) | undefined;
    vi.mocked(request).mockReturnValueOnce(new Promise(resolve => {
      complete = () => resolve(payload);
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh from Tesla' }));
    const syncing = await screen.findByRole('button', { name: 'Syncing...' });
    expect(syncing).toBeDisabled();
    expect(syncing).toHaveAttribute('aria-busy', 'true');
    if (!complete) throw new Error('Synthetic mutation completion is missing');
    await act(async () => { complete?.(); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh from Tesla' })).toBeEnabled());
  });
});
