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
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS } from './designPacks/types';

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

beforeEach(() => {
  eventSeq = 0;
  vi.clearAllMocks();
  mockUseVehicles.mockReturnValue({ data: [{ id: 1 }] } as never);
  sleepRequest(makeData());
});

describe.each(PACK_IDS)('SleepEfficiencyWidget (%s)', packId => {
  function renderWidget(opts: { vehicleId?: number; cols?: number } = {}) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const props: WidgetProps = { vehicleId: opts.vehicleId, size: { cols: opts.cols ?? 2, rows: 2 } };
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <PackBoundary requestedPackId={packId}><SleepEfficiencyWidget {...props} /></PackBoundary>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  async function expectPresentation(container: HTMLElement) {
    if (packId === 'classic') {
      expect(container.querySelector('[data-instrument-family]')).toBeNull();
    } else {
      await waitFor(() => expect(container.querySelector('[data-instrument-family="ring"]'))
        .toHaveAttribute('data-instrument-appearance', PACK_APPEARANCES[packId]));
    }
  }

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
    const { container } = renderWidget({ vehicleId: 1 });
    await screen.findByText('92');
    await expectPresentation(container);
    expect(screen.getByText('92')).toBeInTheDocument();
    expect(screen.getByText('Time asleep when parked')).toBeInTheDocument();
    expect(screen.getByText('Wake events')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('Drain')).toBeInTheDocument();
    expect(screen.getByText('12.0')).toBeInTheDocument();
    expect(screen.getByText('%/day')).toBeInTheDocument();
  });

  it('uses whole-percent headline precision and one-decimal drain precision', async () => {
    sleepRequest(makeData({ sleep_efficiency_pct: 91.4, sentry_off_drain_rate: 0.43 }));
    const { container } = renderWidget({ vehicleId: 1 });
    await screen.findByText('91');
    await expectPresentation(container);
    expect(screen.getByText('91')).toBeInTheDocument();
    expect(screen.getByText('10.3')).toBeInTheDocument();
  });

  it('keeps compact layout focused on the headline', async () => {
    const { container } = renderWidget({ vehicleId: 1, cols: 1 });
    await screen.findByText('92');
    await expectPresentation(container);
    expect(screen.getByText('92')).toBeInTheDocument();
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
    const { container } = renderWidget({ vehicleId: 1 });
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    await expectPresentation(container);
    expect(await screen.findAllByText('—')).toHaveLength(3);
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'partial');
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText(/NaN|undefined/)).toBeNull();
  });

  it('retains measured zero efficiency, zero wake events and zero daily drain', async () => {
    sleepRequest(makeData({ sleep_efficiency_pct: 0, sentry_off_drain_rate: 0, recent_events: [] }));
    const { container } = renderWidget({ vehicleId: 1 });
    await screen.findByText('0.0');
    await expectPresentation(container);
    expect(screen.getAllByText('0')).toHaveLength(2);
    expect(screen.getByText('%')).toBeInTheDocument();
    expect(screen.getByText('%/day')).toBeInTheDocument();
    expect(screen.queryByText('—')).toBeNull();
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'ok');
  });

  it('treats nonfinite readings as unknown without inventing a zero instrument', async () => {
    sleepRequest(makeData({
      sleep_efficiency_pct: Number.NaN, sentry_off_drain_rate: Number.POSITIVE_INFINITY,
    }));
    const { container } = renderWidget({ vehicleId: 1 });
    await screen.findByText('4');
    await expectPresentation(container);
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText(/NaN|Infinity|undefined/)).toBeNull();
    expect(screen.queryByText('0')).toBeNull();
    expect(container.querySelector('[aria-valuenow]')).toBeNull();
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'partial');
  });

  it('keeps the loading shell until the sleep source resolves', async () => {
    let resolveSleep: ((data: SleepEfficiencyData) => void) | undefined;
    mockRequest.mockImplementation((path: string) => String(path).startsWith('/analytics/sleep')
      ? new Promise<SleepEfficiencyData>(resolve => { resolveSleep = resolve; })
      : Promise.resolve([]));
    const { container } = renderWidget({ vehicleId: 1 });
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'initial');
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText('No sleep efficiency data')).toBeNull();
    await act(async () => { resolveSleep?.(makeData()); });
    await screen.findByText('92');
    await expectPresentation(container);
    expect(screen.getByText('92')).toBeInTheDocument();
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'ok');
  });

  it('renders no-data and error states without replacing an error with empty copy', async () => {
    sleepRequest(null);
    const first = renderWidget({ vehicleId: 1 });
    await screen.findByText('No sleep efficiency data');
    await expectPresentation(first.container);
    expect(screen.getByText('No sleep efficiency data')).toBeInTheDocument();
    first.unmount();

    mockRequest.mockImplementation((path: string) =>
      String(path).startsWith('/analytics/sleep') ? Promise.reject(new Error('boom')) : Promise.resolve([]),
    );
    renderWidget({ vehicleId: 1 });
    expect(await screen.findByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('No sleep efficiency data')).toBeNull();
  });

  it('never queries an invalid explicit vehicle', async () => {
    const { container } = renderWidget({ vehicleId: 0 });
    await screen.findByText('No sleep efficiency data');
    await expectPresentation(container);
    expect(screen.getByText('No sleep efficiency data')).toBeInTheDocument();
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

  it('retains historical readings after a refresh failure and recovers on refresh', async () => {
    const { container } = renderWidget({ vehicleId: 1 });
    await screen.findByText('92');
    await expectPresentation(container);
    mockRequest.mockRejectedValue(new Error('refresh failed'));
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    await waitFor(() => expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'stale'));
    expect(screen.getByText('92')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('12.0')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).toBeNull();
    expect(screen.queryByText('No sleep efficiency data')).toBeNull();

    sleepRequest(makeData({ sleep_efficiency_pct: 88 }));
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(await screen.findByText('88')).toBeInTheDocument();
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'ok');
    expect(screen.queryByTestId('stale-refresh-warning')).toBeNull();
  });

  it('reacts to locale and precision without changing the source value', async () => {
    const data = makeData();
    sleepRequest(data);
    const { container } = renderWidget({ vehicleId: 1 });
    await screen.findByText('92');
    await expectPresentation(container);
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

it('keeps the selected historical source mounted while switching through every pack', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } } });
  const content = (packId: (typeof PACK_IDS)[number]) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={packId}>
          <SleepEfficiencyWidget vehicleId={42} size={{ cols: 2, rows: 2 }} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(content('classic'));
  await screen.findByText('92');
  for (const packId of PACK_IDS) {
    view.rerender(content(packId));
    if (packId !== 'classic') {
      await waitFor(() => expect(view.container.querySelector('[data-instrument-family="ring"]'))
        .toHaveAttribute('data-instrument-appearance', PACK_APPEARANCES[packId]));
    }
    expect(screen.getByText('92')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('12.0')).toBeInTheDocument();
    expect(sleepCalls()).toHaveLength(1);
    expect(sleepCalls()[0]?.[0]).toBe('/analytics/sleep?vehicle_id=42&days=30');
  }
});
