import './__tests__/TeslaChargingHistoryPage.test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { request } from '@/api/client';
import type { TeslaChargingHistoryEntry, TeslaChargingHistoryResponse } from '@/api/hooks/useCharging';
import { ToastProvider } from '@/components/feedback/Toast';
import { ApiError } from '@/lib/resilience';
import TeslaChargingHistoryPage from './TeslaChargingHistoryPage';

const vehicle = { id: 1, vehicle_id: 1, vin: 'QA_HISTORY_VEHICLE', display_name: 'History fixture', state: 'online' };
const clients: QueryClient[] = [];

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

function installTransport(payload: TeslaChargingHistoryResponse, historyError?: Error) {
  vi.mocked(request).mockImplementation((path) => {
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
    installTransport(response());
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
    fireEvent.click(screen.getByRole('checkbox', { name: /Select Synthetic charging location/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(create).toHaveBeenCalledOnce();
    const blob = create.mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    const csv = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') resolve(reader.result);
        else reject(new Error('Synthetic export did not contain text'));
      };
      reader.onerror = () => reject(reader.error ?? new Error('Synthetic export could not be read'));
      reader.readAsText(blob);
    });
    expect(csv).toContain('date,location,duration_minutes,energy_wh,cost,currency,rate_base,pricing_type,invoice_id');
    expect(csv).toContain('"60","50000","12.5","EUR","0.42","kWh","synthetic/invoice"');
    expect(click).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('blob:synthetic-charging-export');
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
