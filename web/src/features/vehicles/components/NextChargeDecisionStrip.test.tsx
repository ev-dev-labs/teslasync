/**
 * NextChargeDecisionStrip — vehicle-page 12-hour energy verdict.
 *
 * The strip is presentational orchestration around useNextChargeDecision:
 * loading skeleton, query error, waiting-for-SOC empty, no-data empty, and
 * the wait verdict with cost cards. The hook is mocked; i18n echoes fallbacks.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
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
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NextChargeDecisionStrip vehicleId={1} currentSoc={soc} />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function LocationProbe() {
  return <output data-testid="next-charge-location">{useLocation().pathname}</output>;
}
beforeEach(() => {
  mockDecision.mockReturnValue(qr());
});

afterEach(() => {
  cleanup();
});

describe('NextChargeDecisionStrip', () => {
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
    expect(screen.getByText(/50% → 80%/)).toBeInTheDocument();
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
