import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/feedback';
import type { RedisSignalsResponse } from '@/api/devtools';

vi.mock('react-i18next', async () => {
  const { testTranslation } = await import('../components/continuation-admin-3/testTranslation');
  return {
    ...await vi.importActual<typeof import('react-i18next')>('react-i18next'),
    useTranslation: () => ({ t: testTranslation, i18n: { language: 'en', changeLanguage: vi.fn() } }),
  };
});

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({
    data: [
      { id: 1, display_name: 'First vehicle', vin: '' },
      { id: 2, display_name: 'Second vehicle', vin: '' },
    ],
    isLoading: false,
  }),
}));

vi.mock('@/api/devtools', async () => ({
  ...await vi.importActual<typeof import('@/api/devtools')>('@/api/devtools'),
  getRedisSignals: vi.fn(),
  getRedisSignalKeys: vi.fn().mockResolvedValue({ keys: [], total: 0 }),
  purgeRedisSignals: vi.fn(),
  purgeAllRedisSignals: vi.fn(),
}));

import { getRedisSignals, purgeRedisSignals, purgeAllRedisSignals } from '@/api/devtools';
import RedisSignalViewerPage from './RedisSignalViewerPage';

const snapshot: RedisSignalsResponse = {
  vehicle_id: 1,
  signal_count: 3,
  signals: {
    BatteryLevel: { value: 72, type: 'number' },
    Latitude: { value: 12.345, type: 'number' },
    HvacPower: { value: true, type: 'boolean' },
  },
  meta: {
    live_signal_store_mode: 'hybrid',
    redis_key: 'vehicle:1:signals',
    redis_field_count: 3,
    l1_signal_count: 4,
    l1_last_seen_at: '2026-10-01T12:00:00Z',
    l2_last_seen_at: '2026-10-01T12:01:00Z',
    vehicle_vin: '',
  },
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(
    <MemoryRouter initialEntries={['/redis-signals']}>
      <QueryClientProvider client={client}>
        <ToastProvider><RedisSignalViewerPage /></ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByRole('combobox', { name: 'Select vehicle' }), { target: { value: '1' } });
  return view;
}

function refreshButton() {
  const button = screen.getAllByRole('button', { name: 'Refresh' }).find(element => element.tagName === 'BUTTON');
  if (!button) throw new Error('Refresh button is missing');
  return button;
}

beforeEach(() => {
  // jsdom needs viewport dimensions for the real virtualized signal table.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1024);
  vi.mocked(getRedisSignals).mockReset().mockResolvedValue(snapshot);
  vi.mocked(purgeRedisSignals).mockReset().mockResolvedValue({ vehicle_id: 1, purged: true });
  vi.mocked(purgeAllRedisSignals).mockReset().mockResolvedValue({ purged: 1000, scanned: 1000, limit: 1000, has_more: true });
});

afterEach(() => { vi.restoreAllMocks(); });

describe('RedisSignalViewerPage continuation preservation', () => {
  it('opens real operational details with independent L1/L2 freshness without purging or revealing coordinates', async () => {
    renderPage();
    await screen.findByText('BatteryLevel');
    fireEvent.click(within(screen.getByTestId('redis-signals-operational-brief'))
      .getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Cache metrics details' });
    expect(within(drawer).getByText(/In-process store · L1 last seen:/)).toBeInTheDocument();
    expect(within(drawer).getByText(/Redis HSET · L2 last seen:/)).toBeInTheDocument();
    expect(screen.queryByText('12.345')).not.toBeInTheDocument();
    expect(purgeRedisSignals).not.toHaveBeenCalled();
    expect(purgeAllRedisSignals).not.toHaveBeenCalled();
    const close = within(drawer).getAllByRole('button', { name: 'Close' });
    fireEvent.click(close[close.length - 1]);
    expect(screen.getByRole('textbox', { name: 'Filter signals by name' })).toBeInTheDocument();
  });

  it('uses shared OperationalBrief numeric cache counts, distinct source freshness and preserves counts while filtering', async () => {
    renderPage();
    await screen.findByText('BatteryLevel');
    const strip = screen.getByTestId('redis-signals-operational-brief');
    expect(strip).toHaveAttribute('data-operational-brief');
    expect(strip).toHaveTextContent('Cached signals');
    const values = () => Array.from(strip.querySelectorAll('[data-operational-value]')).map(value => value.textContent);
    expect(values()).toEqual(['3', '2', '0', '1', '4', '3']);
    expect(strip.querySelector('[data-operational-metric="l1"]')).toHaveTextContent('In-process store · L1 last seen:');
    expect(strip.querySelector('[data-operational-metric="l2"]')).toHaveTextContent('Redis HSET · L2 last seen:');
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter signals by name' }), { target: { value: 'Battery' } });
    expect(values()).toEqual(['3', '2', '0', '1', '4', '3']);
    expect(screen.getByText('Cache diagnostics')).toBeInTheDocument();
    expect(screen.getByText('Signal categories')).toBeInTheDocument();
    expect(screen.getByText('Cache actions')).toBeInTheDocument();
    expect(purgeRedisSignals).not.toHaveBeenCalled();
    expect(purgeAllRedisSignals).not.toHaveBeenCalled();
  });

  it('retains full diagnostics, counts, categories and masked values after refresh fails', async () => {
    renderPage();
    await screen.findByText('BatteryLevel');
    expect(screen.queryByText('12.345')).not.toBeInTheDocument();
    vi.mocked(getRedisSignals).mockRejectedValue(new Error('refresh failed'));
    fireEvent.click(refreshButton());
    await waitFor(() => expect(screen.getByText('Data may be stale')).toBeInTheDocument());
    expect(screen.getByTestId('redis-signals-summary')).toHaveAttribute('data-retained', 'true');

    expect(screen.getByText('BatteryLevel')).toBeInTheDocument();
    expect(screen.getByText('hybrid')).toBeInTheDocument();
    expect(screen.getByText('vehicle:1:signals')).toBeInTheDocument();
    expect(screen.getByText('L1 last seen')).toBeInTheDocument();
    expect(screen.getByText('L2 last seen')).toBeInTheDocument();
    expect(screen.getByText('Signal categories')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry', exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('12.345')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter signals by name' }), { target: { value: 'Battery' } });
    expect(screen.getByText('BatteryLevel')).toBeInTheDocument();
    expect(screen.queryByText('HvacPower')).not.toBeInTheDocument();
  });

  it('preserves the pinned single-vehicle target despite a selector change during confirmation', async () => {
    renderPage();
    await screen.findByText('BatteryLevel');
    fireEvent.click(screen.getByRole('button', { name: 'Purge Redis (L2)' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/First vehicle/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Select vehicle' }), { target: { value: '2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Purge Redis (L2)' }));
    await waitFor(() => expect(purgeRedisSignals).toHaveBeenCalledWith(1));
    expect(purgeAllRedisSignals).not.toHaveBeenCalled();
  });

  it('keeps typed cluster confirmation and bounded partial-result feedback', async () => {
    renderPage();
    await screen.findByText('BatteryLevel');
    fireEvent.click(screen.getByRole('button', { name: 'Purge all Redis' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Purge all vehicles' });
    expect(confirm).toBeDisabled();
    expect(purgeAllRedisSignals).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Type PURGE ALL to confirm' }), { target: { value: 'PURGE ALL' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(purgeAllRedisSignals).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Redis L2 cache partially purged')).toBeInTheDocument();
    expect(screen.getByText(/More keys remain/)).toBeInTheDocument();
    expect(purgeRedisSignals).not.toHaveBeenCalled();
  });
});
