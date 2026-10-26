import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) => {
      const base = typeof fallback === 'string' ? fallback : key;
      if (opts && typeof opts === 'object') {
        return base.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in opts ? String(opts[name]) : `{{${name}}}`,
        );
      }
      return base;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: vi.fn() }));

import SleepEfficiencyWidget from './SleepEfficiencyWidget';
import { request } from '@/api/client';
import { useVehicles } from '@/api/hooks/useVehicles';
import type { SleepEfficiencyData, SleepDrainEvent } from '@/types/energy';
import type { WidgetProps } from './types';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';

const mockRequest = vi.mocked(request);
const mockUseVehicles = vi.mocked(useVehicles);

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

let eventSeq = 0;
function makeEvent(over: Partial<SleepDrainEvent> = {}): SleepDrainEvent {
  eventSeq += 1;
  return {
    id: eventSeq, start_date: '2026-01-01T00:00:00Z',
    duration_hours: 8, battery_lost: 2, drain_rate: 0.25,
    sentry_mode: false, outside_temp: 15, ...over,
  };
}

function makeData(over: Partial<SleepEfficiencyData> = {}): SleepEfficiencyData {
  return {
    sleep_efficiency_pct: 92, time_to_sleep_avg_min: 15,
    sentry_on_drain_rate: 1, sentry_off_drain_rate: 0.5,
    sentry_monthly_cost: 5, sentry_monthly_kwh: 10,
    sentry_extra_drain_rate: 0.5, sentry_extra_monthly_kwh: 5,
    sentry_extra_monthly_cost: 2,
    state_distribution: [
      { state: 'asleep', total_minutes: 3000 },
      { state: 'offline', total_minutes: 600 },
      { state: 'online', total_minutes: 99999 },
    ],
    sentry_comparison: [],
    recent_events: [makeEvent(), makeEvent(), makeEvent(), makeEvent()],
    ...over,
  };
}

function sleepRequest(data: SleepEfficiencyData | null) {
  mockRequest.mockImplementation((path: string) =>
    String(path).startsWith('/analytics/sleep') ? Promise.resolve(data) : Promise.resolve([]),
  );
}

const sleepCalls = () =>
  mockRequest.mock.calls.filter((call) => String(call[0]).startsWith('/analytics/sleep'));

function renderWidget(opts: { vehicleId?: number; cols?: number } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const props = { vehicleId: opts.vehicleId, size: { cols: opts.cols ?? 2, rows: 2 } } as WidgetProps;
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><SleepEfficiencyWidget {...props} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  eventSeq = 0;
  vi.clearAllMocks();
  mockUseVehicles.mockReturnValue({ data: [{ id: 1 }] } as never);
  sleepRequest(makeData());
});

describe('SleepEfficiencyWidget', () => {
  it('prefers the explicit vehicle and preserves the historical read URL', async () => {
    mockUseVehicles.mockReturnValue({ data: [{ id: 7 }] } as never);
    renderWidget({ vehicleId: 42 });
    await waitFor(() => expect(sleepCalls()[0]?.[0]).toBe('/analytics/sleep?vehicle_id=42&days=30'));
  });

  it('falls back to the first vehicle', async () => {
    mockUseVehicles.mockReturnValue({ data: [{ id: 7 }, { id: 9 }] } as never);
    renderWidget();
    await waitFor(() => expect(sleepCalls()[0]?.[0]).toBe('/analytics/sleep?vehicle_id=7&days=30'));
  });

  it('renders the After hierarchy: one percent headline, wake events and drain', async () => {
    renderWidget({ vehicleId: 1 });
    expect(await screen.findByText('92')).toBeInTheDocument();
    expect(screen.getByText('Time asleep when parked')).toBeInTheDocument();
    expect(screen.getByText('Wake events')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('Drain')).toBeInTheDocument();
    expect(screen.getByText('12.0')).toBeInTheDocument();
    expect(screen.getByText('%/day')).toBeInTheDocument();
  });

  it('uses whole-percent headline precision and one-decimal drain precision', async () => {
    sleepRequest(makeData({ sleep_efficiency_pct: 91.4, sentry_off_drain_rate: 0.43 }));
    renderWidget({ vehicleId: 1 });
    expect(await screen.findByText('91')).toBeInTheDocument();
    expect(screen.getByText('10.3')).toBeInTheDocument();
  });

  it('keeps compact layout focused on the headline', async () => {
    renderWidget({ vehicleId: 1, cols: 1 });
    expect(await screen.findByText('92')).toBeInTheDocument();
    expect(screen.queryByText('Wake events')).toBeNull();
    expect(screen.queryByText('Drain')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Sleep efficiency', level: 3 })).toBeVisible();
  });

  it('shows real unknown values as unknown instead of zero', async () => {
    sleepRequest(makeData({
      sleep_efficiency_pct: null as unknown as number,
      sentry_off_drain_rate: null as unknown as number,
      recent_events: null as unknown as SleepDrainEvent[],
    }));
    renderWidget({ vehicleId: 1 });
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    expect(await screen.findAllByText('—')).toHaveLength(3);
    expect(screen.queryByText(/NaN|undefined/)).toBeNull();
  });

  it('renders no-data and error states without replacing an error with empty copy', async () => {
    sleepRequest(null);
    const first = renderWidget({ vehicleId: 1 });
    expect(await screen.findByText('No sleep efficiency data')).toBeInTheDocument();
    first.unmount();

    mockRequest.mockImplementation((path: string) =>
      String(path).startsWith('/analytics/sleep') ? Promise.reject(new Error('boom')) : Promise.resolve([]),
    );
    renderWidget({ vehicleId: 1 });
    expect(await screen.findByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('No sleep efficiency data')).toBeNull();
  });

  it('never queries an invalid explicit vehicle', async () => {
    renderWidget({ vehicleId: 0 });
    expect(await screen.findByText('No sleep efficiency data')).toBeInTheDocument();
    expect(sleepCalls()).toHaveLength(0);
  });

  it('keeps no-vehicle discovery failure on retry and does not query', () => {
    const refetch = vi.fn();
    mockUseVehicles.mockReturnValue({ data: undefined, isError: true, error: new Error('vehicles'), refetch } as never);
    renderWidget();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Retry/ }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(sleepCalls()).toHaveLength(0);
  });

  it('refreshes the data read and exposes freshness refresh', async () => {
    renderWidget({ vehicleId: 1 });
    const refresh = await screen.findByRole('button', { name: /^Refresh/i });
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    const before = sleepCalls().length;
    fireEvent.click(refresh);
    await waitFor(() => expect(sleepCalls().length).toBe(before + 1));
  });

  it('reacts to locale and precision without changing the source value', async () => {
    const data = makeData();
    sleepRequest(data);
    renderWidget({ vehicleId: 1 });
    await screen.findByText('92');
    try {
      act(() => { setGlobalPrecision(1); setGlobalLocale('de-DE'); });
      expect(screen.getByText('92')).toBeInTheDocument();
      expect(screen.getByText('12,0')).toBeInTheDocument();
      expect(data.sleep_efficiency_pct).toBe(92);
    } finally {
      act(() => { setGlobalPrecision(2); setGlobalLocale('en-US'); });
    }
  });
});
