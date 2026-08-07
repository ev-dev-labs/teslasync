/**
 * SleepEfficiencyWidget — behaviour, hardening & a11y contract.
 *
 * The widget resolves a vehicle (explicit prop → first vehicle → none), reads a
 * single `useQuery('/analytics/sleep?vehicle_id=…&days=30')` result and renders
 * a gauge + three derived stats (avg drain/day, total sleep hours, wake
 * events) — or the loading / empty / error states. This suite drives the whole
 * component through its accessible surface:
 *
 *   - vehicle resolution (prop wins over the vehicle list; the list supplies the
 *     fallback; no vehicle keeps the query DISABLED so `/analytics/sleep` is
 *     never hit and an empty state renders instead of a blank panel);
 *   - the loading / empty / error paths — most importantly that a FAILED request
 *     surfaces a `QueryError` (role="alert"), NOT the misleading "No sleep
 *     efficiency data" empty state. This is the regression guard for the bug
 *     this elevation fixed: the widget previously dropped the hook's `error` and
 *     never forwarded it to `<WidgetShell>`, so failures looked like "no data";
 *   - the populated gauge (value + "Efficiency" label) and the three stat tiles
 *     with their formatted values + units;
 *   - the `total sleep` derivation only counting `asleep`/`offline` minutes
 *     (online/driving states are excluded) and being null-safe per entry;
 *   - the gauge colour thresholds (green >95, amber >85, red otherwise);
 *   - null-safety: a data object whose numeric/array fields are null renders
 *     "0"/"0.00" placeholders instead of NaN / "undefined";
 *   - the compact (title-less, stats-hidden) layout variant;
 *   - the freshness refresh interaction re-issuing the read;
 *   - the help tooltip's accessible label in the standard layout.
 *
 * The network boundary (`request` from `@/api/client`) is mocked; TanStack Query
 * runs for real against it (so the request URL contract and `enabled` gating are
 * exercised end to end). `useVehicles` is mocked at the hook boundary.
 * `react-i18next` is stubbed to echo the English fallback.
 * `@testing-library/user-event` is not installed in this repo (see the sibling
 * RouteEfficiencyWidget / RecentDrivesWidget suites), so interactions go through
 * `fireEvent`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// i18n stub: echo the fallback string, interpolating {{var}} tokens from the
// options bag so any interpolated copy renders as real text.
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

// Replace only the network primitive; keep the real `isApiError` etc. so
// <QueryError> classifies failures correctly.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

// The vehicle list is a controllable vi.fn.
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: vi.fn(),
}));

import SleepEfficiencyWidget from './SleepEfficiencyWidget';
import { request } from '@/api/client';
import { useVehicles } from '@/api/hooks/useVehicles';
import type { SleepEfficiencyData, SleepDrainEvent } from '@/types/energy';
import type { WidgetProps } from './types';
import { hasGaugeColor } from '@/test/gaugeTestUtils';

const mockRequest = vi.mocked(request);
const mockUseVehicles = vi.mocked(useVehicles);

// jsdom lacks matchMedia; framer-motion / useMotionPreference (via
// <DataFreshness> inside <WidgetShell>) reads it.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

let eventSeq = 0;
function makeEvent(over: Partial<SleepDrainEvent> = {}): SleepDrainEvent {
  eventSeq += 1;
  return {
    id: eventSeq,
    start_date: '2026-01-01T00:00:00Z',
    duration_hours: 8,
    battery_lost: 2,
    drain_rate: 0.25,
    sentry_mode: false,
    outside_temp: 15,
    ...over,
  };
}

function makeData(over: Partial<SleepEfficiencyData> = {}): SleepEfficiencyData {
  return {
    sleep_efficiency_pct: 92,
    time_to_sleep_avg_min: 15,
    sentry_on_drain_rate: 1,
    sentry_off_drain_rate: 0.5, // × 24 → 12.00 %/day
    sentry_monthly_cost: 5,
    sentry_monthly_kwh: 10,
    sentry_extra_drain_rate: 0.5,
    sentry_extra_monthly_kwh: 5,
    sentry_extra_monthly_cost: 2,
    state_distribution: [
      { state: 'asleep', total_minutes: 3000 },
      { state: 'offline', total_minutes: 600 },
      { state: 'online', total_minutes: 99999 }, // excluded from sleep total
    ],
    sentry_comparison: [],
    recent_events: [makeEvent(), makeEvent(), makeEvent(), makeEvent()], // 4 wake events
    ...over,
  };
}

/** Route `/analytics/sleep` reads to the supplied payload. */
function sleepRequest(data: SleepEfficiencyData | null) {
  mockRequest.mockImplementation((path: string) =>
    String(path).startsWith('/analytics/sleep')
      ? Promise.resolve(data)
      : Promise.resolve([]),
  );
}

const sleepCalls = () =>
  mockRequest.mock.calls.filter((c) => String(c[0]).startsWith('/analytics/sleep'));

function renderWidget(opts: { vehicleId?: number; cols?: number } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const props = {
    vehicleId: opts.vehicleId,
    size: { cols: opts.cols ?? 2, rows: 2 },
  } as WidgetProps;
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SleepEfficiencyWidget {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  eventSeq = 0;
  vi.clearAllMocks();
  mockUseVehicles.mockReturnValue({ data: [{ id: 1 }] } as never);
  sleepRequest(makeData());
});

// ── Vehicle resolution ──────────────────────────────────────────────────────

describe('SleepEfficiencyWidget vehicle resolution', () => {
  it('prefers the explicit vehicleId prop over the vehicle list', async () => {
    mockUseVehicles.mockReturnValue({ data: [{ id: 7 }] } as never);
    renderWidget({ vehicleId: 42 });

    await waitFor(() =>
      expect(sleepCalls()[0]?.[0]).toBe('/analytics/sleep?vehicle_id=42&days=30'),
    );
    expect(sleepCalls().some((c) => String(c[0]).includes('vehicle_id=7'))).toBe(false);
  });

  it('falls back to the first vehicle when no prop is given', async () => {
    mockUseVehicles.mockReturnValue({ data: [{ id: 7 }, { id: 9 }] } as never);
    renderWidget();

    await waitFor(() =>
      expect(sleepCalls()[0]?.[0]).toBe('/analytics/sleep?vehicle_id=7&days=30'),
    );
    expect(sleepCalls().some((c) => String(c[0]).includes('vehicle_id=9'))).toBe(false);
  });

  it('never queries when no vehicle resolves and shows an empty state (never a blank panel)', async () => {
    mockUseVehicles.mockReturnValue({ data: [] } as never);
    renderWidget();

    expect(await screen.findByText('No sleep efficiency data')).toBeInTheDocument();
    expect(sleepCalls()).toHaveLength(0);
  });
});

// ── States: loading / empty / error ─────────────────────────────────────────

describe('SleepEfficiencyWidget states', () => {
  it('renders a loading skeleton (no title, no empty copy) while fetching', () => {
    mockRequest.mockImplementation(() => new Promise(() => {})); // hang
    const { container } = renderWidget({ vehicleId: 1 });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Sleep Efficiency')).toBeNull();
    expect(screen.queryByText('No sleep efficiency data')).toBeNull();
  });

  it('shows an empty state with role=status when the response has no data', async () => {
    sleepRequest(null);
    renderWidget({ vehicleId: 1 });

    const empty = await screen.findByText('No sleep efficiency data');
    expect(empty).toBeInTheDocument();
    expect(empty.closest('[role="status"]')).not.toBeNull();
  });

  it('surfaces a QueryError — not the empty state — when the request fails', async () => {
    mockRequest.mockImplementation((path: string) =>
      String(path).startsWith('/analytics/sleep')
        ? Promise.reject(new Error('boom'))
        : Promise.resolve([]),
    );
    renderWidget({ vehicleId: 1 });

    expect(await screen.findByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // Regression guard: the failure must NOT masquerade as an empty state or
    // silently render the populated widget.
    expect(screen.queryByText('No sleep efficiency data')).toBeNull();
    expect(screen.queryByText('Sleep Efficiency')).toBeNull();
  });
});

// ── Populated gauge + stats ─────────────────────────────────────────────────

describe('SleepEfficiencyWidget populated', () => {
  it('renders the title, gauge value/label and the three derived stat tiles', async () => {
    renderWidget({ vehicleId: 1 });

    expect(await screen.findByText('Sleep Efficiency')).toBeInTheDocument();
    // Gauge: integer efficiency renders without decimals; "Efficiency" label.
    expect(screen.getByText('92')).toBeInTheDocument();
    expect(screen.getByText('Efficiency')).toBeInTheDocument();

    // Avg Drain/Day = sentry_off_drain_rate (0.5 %/hr) × 24 → "12.00".
    expect(screen.getByText('Avg Drain/Day')).toBeInTheDocument();
    expect(screen.getByText('12.00')).toBeInTheDocument();

    // Total Sleep = (3000 asleep + 600 offline) / 60 → "60".
    expect(screen.getByText('Total Sleep')).toBeInTheDocument();
    expect(screen.getByText('60')).toBeInTheDocument();

    // Wake Events = recent_events.length → 4.
    expect(screen.getByText('Wake Events')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('counts only asleep/offline minutes toward total sleep (excludes online/driving)', async () => {
    sleepRequest(
      makeData({
        state_distribution: [
          { state: 'asleep', total_minutes: 1200 },
          { state: 'offline', total_minutes: 600 },
          { state: 'online', total_minutes: 5000 }, // excluded
          { state: 'driving', total_minutes: 4000 }, // excluded
          { state: 'asleep', total_minutes: null as unknown as number }, // null-safe → 0
        ],
      }),
    );
    renderWidget({ vehicleId: 1 });

    // (1200 + 600) / 60 = 30 — NOT (1200+600+5000+4000)/60 = 180.
    expect(await screen.findByText('30')).toBeInTheDocument();
    expect(screen.queryByText('180')).toBeNull();
  });

  const colorCases = [
    { pct: 98, color: '#10b981', name: 'green above 95%' },
    { pct: 90, color: '#f59e0b', name: 'amber between 85% and 95%' },
    { pct: 50, color: '#ef4444', name: 'red at or below 85%' },
  ];
  colorCases.forEach(({ pct, color, name }) => {
    it(`paints the gauge ${name}`, async () => {
      sleepRequest(makeData({ sleep_efficiency_pct: pct }));
      const { container } = renderWidget({ vehicleId: 1 });

      await screen.findByText(String(pct));
      expect(hasGaugeColor(container, color)).toBe(true);
    });
  });

  it('is null-safe: null numeric/array fields render 0 placeholders, never NaN/undefined', async () => {
    sleepRequest(
      makeData({
        sleep_efficiency_pct: null as unknown as number,
        sentry_off_drain_rate: null as unknown as number,
        state_distribution: null as unknown as SleepEfficiencyData['state_distribution'],
        recent_events: null as unknown as SleepDrainEvent[],
      }),
    );
    renderWidget({ vehicleId: 1 });

    // Avg Drain/Day = (null ?? 0) × 24 → "0.00".
    expect(await screen.findByText('0.00')).toBeInTheDocument();
    // Gauge value + Total Sleep + Wake Events all collapse to "0".
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/NaN|undefined/)).toBeNull();
  });
});

// ── Layout variants ─────────────────────────────────────────────────────────

describe('SleepEfficiencyWidget layout variants', () => {
  it('renders the compact (title-less, stats-hidden) layout for a 1-column widget', async () => {
    renderWidget({ vehicleId: 1, cols: 1 });

    // Gauge value still renders in compact mode.
    expect(await screen.findByText('92')).toBeInTheDocument();
    // Compact widgets drop the header title and the stat tiles.
    expect(screen.queryByText('Sleep Efficiency')).toBeNull();
    expect(screen.queryByText('Avg Drain/Day')).toBeNull();
    expect(screen.queryByText('Efficiency')).toBeNull();
  });

  it('exposes an accessible help tooltip trigger in the standard layout', async () => {
    renderWidget({ vehicleId: 1 });

    await screen.findByText('Sleep Efficiency');
    expect(
      screen.getByRole('button', { name: 'More info about Sleep Efficiency' }),
    ).toBeInTheDocument();
  });
});

// ── Refresh interaction ─────────────────────────────────────────────────────

describe('SleepEfficiencyWidget refresh', () => {
  it('re-issues the read when the freshness refresh control is activated', async () => {
    renderWidget({ vehicleId: 1 });

    const refresh = await screen.findByRole('button', { name: 'Refresh' });
    const before = sleepCalls().length;
    expect(before).toBeGreaterThanOrEqual(1);

    fireEvent.click(refresh);

    await waitFor(() => expect(sleepCalls().length).toBe(before + 1));
  });
});
