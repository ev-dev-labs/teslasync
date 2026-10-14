/**
 * NextChargeDecisionStrip — vehicle-page 12-hour energy verdict.
 *
 * The strip is presentational orchestration around useNextChargeDecision:
 * loading skeleton, paused initial read, query error, waiting-for-SOC empty, no-data empty, and
 * the wait verdict with cost cards. The hook is mocked; i18n echoes fallbacks.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fb?: unknown, opts?: unknown) => {
      const options = (opts && typeof opts === 'object' ? opts : undefined) as
        | Record<string, unknown>
        | undefined;
      let base = typeof fb === 'string' ? fb : key;
      if (options) {
        base = base.replace(/{{\s*(\w+)\s*}}/g, (_m, n: string) =>
          n in options && options[n] != null ? String(options[n]) : `{{${n}}}`,
        );
      }
      return base;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: unknown }) => <>{children as never}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/api/hooks/useCharging', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useCharging')>();
  return { ...actual, useNextChargeDecision: vi.fn() };
});

vi.mock('@/components/layout', async (importActual) => {
  const actual = await importActual<typeof import('@/components/layout')>();
  return { ...actual, ChartCard: vi.fn(() => null) };
});

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

import { NextChargeDecisionStrip } from './NextChargeDecisionStrip';
import { useNextChargeDecision } from '@/api/hooks/useCharging';
import type { NextChargeDecision } from '@/types/charging';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { ChartCard } from '@/components/layout';
import { VehicleDriveChart } from './modernization/VehicleDriveChart';
import type { Drive } from '@/api/types';

const mockDecision = vi.mocked(useNextChargeDecision);

function qr(over: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  } as never;
}

const WAIT: NextChargeDecision = {
  verdict: 'wait',
  reason_key: 'wait_offpeak',
  reason: 'Wait for off-peak',
  current_soc: 50,
  target_soc: 80,
  kwh_needed: 22.5,
  horizon_hours: 12,
  home_now_cost: 8.2,
  home_wait_cost: 6.1,
  home_wait_start: '2026-01-16T00:00:00Z',
  home_savings: 2.1,
  ready_by: '2026-01-16T07:30:00Z',
  capped_by_health_guardrail: false,
};

function renderStrip(soc?: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NextChargeDecisionStrip vehicleId={1} currentSoc={soc} />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const view = render(tree());
  return { ...view, rerenderStrip: () => view.rerender(tree()) };
}

function LocationProbe() {
  return <output data-testid="next-charge-location">{useLocation().pathname}</output>;
}
beforeEach(() => {
  mockDecision.mockReturnValue(qr());
});

describe('VehicleDriveChart numeric boundaries', () => {
  it('keeps signed fractional chart operands and series keys while table formatting follows preferences', () => {
    const preferences = getFormatterPreferences();
    const source: Drive = {
      id: 1, vehicle_id: 1, start_ts: '2026-01-16T12:00:00Z', end_ts: null,
      distance_m: -1234567.8, duration_s: 123.456,
      start_address: null, end_address: null, start_lat: null, start_lon: null,
      end_lat: null, end_lon: null, start_soc_pct: 50, end_soc_pct: null,
      energy_used_wh: null, regen_energy_wh: null, avg_speed_mps: null,
      max_speed_mps: null, avg_power_w: null, outside_temp_avg_c: null,
      inside_temp_avg_c: null, score: null, ended_status: null,
      created_at: '2026-01-16T12:00:00Z', updated_at: '2026-01-16T12:00:00Z',
    };
    const drives: Drive[] = [
      source,
      { ...source, id: 2, start_ts: '2026-01-15T12:00:00Z', distance_m: 12.34, duration_s: 0.75 },
    ];
    const original = JSON.stringify(drives);
    try {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={client}>
          <VehicleDriveChart drives={drives} />
        </QueryClientProvider>,
      );
      const initial = vi.mocked(ChartCard).mock.calls.at(-1)?.[0];
      expect(initial?.chartKey).toBe('battery-drive-trend');
      expect(initial?.data).toEqual([
        { date: expect.any(String), distance: 0.01234, duration: 0.0125 },
        { date: expect.any(String), distance: -1234.5678, duration: 2.0576 },
      ]);
      act(() => {
        setGlobalLocale('de-DE');
        setGlobalPrecision(3);
      });
      const localized = vi.mocked(ChartCard).mock.calls.at(-1)?.[0];
      expect(localized?.data).toBe(initial?.data);
      expect(localized?.dataColumns?.map((column) => column.key)).toEqual(['date', 'distance', 'duration']);
      expect(localized?.dataColumns?.[1].format?.(-1234.5678)).toBe('-1.234,568');
      expect(localized?.dataColumns?.[2].format?.(2.0576)).toBe('2,058');
      expect(JSON.stringify(drives)).toBe(original);
    } finally {
      cleanup();
      setGlobalLocale(preferences.locale);
      setGlobalPrecision(preferences.precision);
    }
  });
});

afterEach(() => {
  cleanup();
});

describe('NextChargeDecisionStrip', () => {
  it.each([undefined, 0, 50])('waits for a paused initial decision without inferring empty or exposing actions (SOC=%s)', (soc) => {
    mockDecision.mockReturnValue(qr({ isPending: true, fetchStatus: 'paused' }));
    renderStrip(soc);
    expect(screen.getByRole('status')).toHaveTextContent('Refresh paused');
    expect(screen.queryByText('No charge decision yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Waiting for live battery level')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Autopilot' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Autopilot' })).not.toBeInTheDocument();
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
    expect(document.querySelector('[data-operational-brief]')).toBeNull();
  });

  it('recovers a paused initial request to a real zero verdict, retaining it through refresh failure and recovery', () => {
    const decision = { ...WAIT, current_soc: 0, target_soc: 0, kwh_needed: 0,
      home_now_cost: 0, home_wait_cost: 0 };
    mockDecision.mockReturnValue(qr({ isPending: true, fetchStatus: 'paused' }));
    const { rerenderStrip } = renderStrip(0);
    const update = (query: ReturnType<typeof qr>) => {
      mockDecision.mockReturnValue(query);
      rerenderStrip();
    };
    update(qr({ data: decision, isSuccess: true, fetchStatus: 'idle' }));
    expect(screen.getByText('0.00% → 0.00% · 0.00 kWh needed')).toBeVisible();
    expect(screen.getByText('Home now').closest('[data-operational-metric]')).toHaveTextContent('$0.00');
    const control = screen.getByRole('button', { name: 'Open Autopilot' });
    control.focus();
    update(qr({ data: decision, isError: true, error: new Error('Refresh failed') }));
    expect(screen.getByTestId('stale-refresh-warning')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open Autopilot' })).toBe(control);
    update(qr({ data: decision, fetchStatus: 'paused' }));
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true');
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
    update(qr({ data: decision, isSuccess: true, fetchStatus: 'idle' }));
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Autopilot' })).toBe(control);
    expect(control).toHaveFocus();
  });

  it('shows the empty decision only after the paused request successfully resolves without a verdict', () => {
    mockDecision.mockReturnValue(qr({ isPending: true, fetchStatus: 'paused' }));
    const { rerenderStrip } = renderStrip(0);
    expect(screen.queryByText('No charge decision yet')).not.toBeInTheDocument();
    mockDecision.mockReturnValue(qr({ isSuccess: true, fetchStatus: 'idle' }));
    rerenderStrip();
    expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument();
    expect(screen.getByText('No charge decision yet')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open Autopilot' })).toHaveAttribute('href', '/smart-charge');
  });

  it('shows a waiting empty state when SOC is unknown', () => {
    renderStrip();
    expect(screen.getByText('Waiting for live battery level')).toBeInTheDocument();
  });

  it('renders the wait verdict, costs, and Autopilot CTA', () => {
    mockDecision.mockReturnValue(qr({ data: WAIT }));
    renderStrip(50);
    expect(screen.getAllByText('Wait for off-peak').length).toBeGreaterThan(0);
    expect(screen.getByText('Home now')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Autopilot' })).toBeInTheDocument();
    expect(screen.getByText(/50.00% → 80.00%/)).toBeInTheDocument();
    const band = document.querySelector('[data-testid="vehicle-next-charge-summary"][data-operational-brief]');
    expect(band).not.toBeNull();
    expect(band?.querySelectorAll('[data-operational-metric]')).toHaveLength(3);
    expect(screen.getByText('Home now').closest('[data-operational-metric]')).toHaveTextContent('$8.20');
    expect(screen.getByText('Wait window').closest('[data-operational-metric]')).toHaveTextContent('$6.10');
    expect(screen.getByText('Supercharger').closest('[data-operational-metric]')).toHaveAttribute('data-value-state', 'missing');
    expect(screen.getByText(/22.50 kWh needed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Autopilot' }));
    expect(screen.getByTestId('next-charge-location')).toHaveTextContent('/smart-charge');
  });

  it('shows no-data empty with Autopilot navigation', () => {
    mockDecision.mockReturnValue(qr({ data: undefined }));
    renderStrip(40);
    expect(screen.getByText('No charge decision yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Autopilot' })).toHaveAttribute('href', '/smart-charge');
  });

  it('updates SOC and energy narratives with numeric preferences without changing source operands', () => {
    const preferences = getFormatterPreferences();
    const decision: NextChargeDecision = {
      ...WAIT,
      current_soc: 50.125,
      target_soc: 80.375,
      kwh_needed: -1234.5678,
      reason: 'Observed {{soc}}% toward {{target}}%',
    };
    const original = JSON.stringify(decision);
    try {
      mockDecision.mockReturnValue(qr({ data: decision }));
      renderStrip(50.125);
      act(() => {
        setGlobalLocale('de-DE');
        setGlobalPrecision(3);
      });
      expect(screen.getByText('50,125% → 80,375% · -1.234,568 kWh needed')).toBeInTheDocument();
      expect(screen.getByTestId('vehicle-next-charge-summary')).toHaveTextContent('Observed 50,125% toward 80,375%');
      act(() => {
        setGlobalLocale('en-US');
        setGlobalPrecision(1);
      });
      expect(screen.getByText('50.1% → 80.4% · -1,234.6 kWh needed')).toBeInTheDocument();
      expect(JSON.stringify(decision)).toBe(original);
      expect(mockDecision).toHaveBeenLastCalledWith(1, 50.125);
    } finally {
      cleanup();
      setGlobalLocale(preferences.locale);
      setGlobalPrecision(preferences.precision);
    }
  });

  it('keeps a valid cached verdict, all costs and source context during a refresh failure or missing current SOC', () => {
    const retry = vi.fn();
    const decision = { ...WAIT, supercharger_cost: 12.34, supercharger_site: 'Recorded site' };
    const original = JSON.stringify(decision);
    mockDecision.mockReturnValue(qr({ data: decision, isError: true,
      error: new Error('Refresh failed'), refetch: retry }));
    renderStrip();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.queryByText('Waiting for live battery level')).not.toBeInTheDocument();
    expect(screen.getByText('Recorded site')).toBeInTheDocument();
    expect(screen.getByText('Supercharger').closest('[data-operational-metric]')).toHaveTextContent('$12.34');
    expect(within(screen.getByTestId('vehicle-next-charge-summary')).getByText('Retained source snapshot')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-operational-metric]')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Open Autopilot' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(JSON.stringify(decision)).toBe(original);
  });

  it('keeps fatal retry distinct from retained data and keeps initial loading source-standard', () => {
    const retry = vi.fn();
    mockDecision.mockReturnValue(qr({ isError: true, error: new Error('Decision unavailable'), refetch: retry }));
    renderStrip(50);
    expect(document.querySelector('[data-operational-brief]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
    cleanup();
    mockDecision.mockReturnValue(qr({ isLoading: true, isPending: true }));
    renderStrip(50);
    expect(document.querySelector('[data-operational-brief]')).toBeNull();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });
});
