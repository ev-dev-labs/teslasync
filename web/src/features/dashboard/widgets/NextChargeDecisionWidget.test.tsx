/**
 * NextChargeDecisionWidget — dashboard tile for the 12-hour energy verdict.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

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

vi.mock('@/api/hooks/useVehicles', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useVehicles')>();
  return { ...actual, useVehicles: vi.fn(), useVehicleState: vi.fn() };
});

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

import NextChargeDecisionWidget from './NextChargeDecisionWidget';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useNextChargeDecision } from '@/api/hooks/useCharging';
import type { WidgetSize } from './types';
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat';
import { act } from '@testing-library/react';

const mockVehicles = vi.mocked(useVehicles);
const mockState = vi.mocked(useVehicleState);
const mockDecision = vi.mocked(useNextChargeDecision);

const SIZE: WidgetSize = { cols: 2, rows: 2 };

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

function renderWidget({ vehicleId = 1, size = SIZE }: { vehicleId?: number; size?: WidgetSize } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NextChargeDecisionWidget vehicleId={vehicleId} size={size} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockVehicles.mockReturnValue(qr({ data: [{ id: 1 }] }));
  mockState.mockReturnValue(
    qr({ data: { state: { battery_level: 42 }, live: true } }),
  );
  mockDecision.mockReturnValue(qr());
});

afterEach(() => {
  cleanup();
});

describe('NextChargeDecisionWidget', () => {
  it.each([{ cols: 1, rows: 1 }, SIZE, { cols: 4, rows: 3 }])('preserves its verdict and explanation at %j', (size) => {
    mockDecision.mockReturnValue(qr({ data: {
      verdict: 'wait', reason: 'Preserved explanation', current_soc: 42, target_soc: 80, kwh_needed: 28.5,
    } }));
    renderWidget({ size });
    expect(screen.getByText('wait')).toBeInTheDocument();
    expect(screen.getByText('Preserved explanation')).toBeInTheDocument();
    expect(screen.getByText(/28.50 kWh needed/)).toBeInTheDocument();
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('disables invalid vehicle %s', (vehicleId) => {
    renderWidget({ vehicleId });
    expect(mockState).toHaveBeenLastCalledWith(0);
    expect(mockDecision).toHaveBeenLastCalledWith(undefined, 42);
  });

  it('updates battery and energy formatting reactively', () => {
    mockDecision.mockReturnValue(qr({ data: {
      verdict: 'wait', reason: 'Plan', current_soc: 42, target_soc: 80, kwh_needed: 28.5,
    } }));
    renderWidget();
    try {
      act(() => { setGlobalPrecision(3); setGlobalLocale('de-DE'); });
      expect(screen.getByText(/42,000% → 80,000% · 28,500 kWh needed/)).toBeInTheDocument();
    } finally {
      act(() => { setGlobalPrecision(2); setGlobalLocale('en-US'); });
    }
  });

  it.each(['enough', 'wait', 'charge_home_now', 'supercharger', 'skip_dc'])(
    'preserves the %s verdict, reason, battery estimates and cost', (verdict) => {
      mockDecision.mockReturnValue(qr({ data: {
        verdict, reason: 'Measured plan reason', current_soc: 42, target_soc: 80,
        kwh_needed: 28.5, home_now_cost: 6.4,
      } }));
      renderWidget();
      expect(screen.getByText(verdict)).toBeInTheDocument();
      expect(screen.getByText('Measured plan reason')).toBeInTheDocument();
      expect(screen.getByText(/28.50 kWh needed/)).toBeInTheDocument();
      expect(screen.getByText('$6.40')).toBeInTheDocument();
    },
  );

  it('does not leave a disabled decision in permanent pending when SOC is missing', () => {
    mockState.mockReturnValue(qr({ data: { state: {} } }));
    mockDecision.mockReturnValue(qr({ isPending: true }));
    const view = renderWidget();
    expect(screen.getByText('Waiting for live battery level')).toBeInTheDocument();
    expect(view.container.querySelector('.animate-pulse')).toBeNull();
    expect(mockDecision).toHaveBeenLastCalledWith(1, undefined);
  });

  it('keeps the cached verdict when live SOC refresh fails and retries both sources', () => {
    const stateRetry = vi.fn();
    const decisionRetry = vi.fn();
    mockState.mockReturnValue(qr({ isError: true, error: new Error('state'), refetch: stateRetry }));
    mockDecision.mockReturnValue(qr({ data: { verdict: 'wait', reason: 'Retained verdict' }, refetch: decisionRetry }));
    renderWidget();
    expect(screen.getByText('Retained verdict')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(stateRetry).toHaveBeenCalledOnce();
    expect(decisionRetry).not.toHaveBeenCalled();
  });

  it('renders a fatal source failure with retry instead of waiting copy', () => {
    const retry = vi.fn();
    mockState.mockReturnValue(qr({ isError: true, error: new Error('state'), refetch: retry }));
    renderWidget();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Retry/ }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('shows waiting empty when battery level is missing', () => {
    mockState.mockReturnValue(qr({ data: { state: {}, live: true } }));
    renderWidget();
    expect(screen.getByText('Waiting for live battery level')).toBeInTheDocument();
  });

  it('renders skip_dc verdict from the decision hook', () => {
    mockDecision.mockReturnValue(
      qr({
        data: {
          verdict: 'skip_dc',
          reason_key: 'skip_dc',
          reason: 'Skip Everett — home is cheaper',
          current_soc: 42,
          target_soc: 80,
          kwh_needed: 28.5,
          horizon_hours: 12,
          home_now_cost: 6.4,
          ready_by: '2026-01-16T07:30:00Z',
          capped_by_health_guardrail: false,
        },
      }),
    );
    renderWidget();
    expect(screen.getByText('Skip Everett — home is cheaper')).toBeInTheDocument();
    expect(screen.getByText(/42.00% → 80.00%/)).toBeInTheDocument();
  });
});
