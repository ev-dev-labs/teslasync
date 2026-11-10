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
import type { NextChargeDecision } from '@/types/charging';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS } from './designPacks/types';

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

describe.each(PACK_IDS)('NextChargeDecisionWidget (%s)', (packId) => {
  function renderWidget({ vehicleId = 1, size = SIZE }: { vehicleId?: number; size?: WidgetSize } = {}) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <PackBoundary requestedPackId={packId}>
            <NextChargeDecisionWidget vehicleId={vehicleId} size={size} />
          </PackBoundary>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it.each([{ cols: 1, rows: 1 }, SIZE, { cols: 4, rows: 3 }])('preserves its verdict and explanation at %j', (size) => {
    mockDecision.mockReturnValue(qr({ data: {
      verdict: 'wait', reason: 'Preserved explanation', current_soc: 42, target_soc: 80, kwh_needed: 28.5,
    } }));
    const view = renderWidget({ size });
    expect(screen.getByText('Wait for off-peak')).toBeInTheDocument();
    expect(screen.getByText('Preserved explanation')).toBeInTheDocument();
    expect(screen.getByText(/28.50 kWh needed/)).toBeInTheDocument();
    expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
    if (packId !== 'classic') {
      expect(view.container.querySelector('[data-timeline-appearance]'))
        .toHaveAttribute('data-timeline-appearance', PACK_APPEARANCES[packId]);
    }
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
      expect(screen.getByText(/42,000% → 80,000% · 28\.50 kWh needed/)).toBeInTheDocument();
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
      expect(screen.getByText(({
        enough: 'Enough energy',
        wait: 'Wait for off-peak',
        charge_home_now: 'Charge home now',
        supercharger: 'Use Supercharger',
        skip_dc: 'Skip DC-fast',
      } as Record<string, string>)[verdict])).toBeInTheDocument();
      expect(screen.getByText('Measured plan reason')).toBeInTheDocument();
      expect(screen.getByText(/28.50 kWh needed/)).toBeInTheDocument();
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

  it('shows initial loading rather than an empty decision while the request is pending', () => {
    mockDecision.mockReturnValue(qr({ isPending: true, isLoading: true, isFetching: true }));
    const view = renderWidget();
    expect(view.container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'initial');
    expect(view.container.querySelector('[data-data-state]')).toHaveAttribute('aria-busy', 'true');
    expect(view.container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByText('No charge decision yet')).not.toBeInTheDocument();
  });

  it('shows the empty decision without inventing a verdict when live SOC is available', () => {
    renderWidget();
    expect(screen.getByText('No charge decision yet')).toBeInTheDocument();
    expect(screen.queryByText('Enough energy')).not.toBeInTheDocument();
  });

  it.each([
    { current_soc: 0, target_soc: 0, kwh_needed: 0, expected: '0.00% → 0.00% · 0.00 kWh needed' },
    { current_soc: NaN, target_soc: Infinity, kwh_needed: -Infinity, expected: '—% → —% · — needed' },
  ])('keeps zero estimates distinct from unknown estimates: $expected', ({ expected, ...estimates }) => {
    const decision: NextChargeDecision = {
      verdict: 'enough', reason_key: 'enough', reason: 'Existing plan',
      horizon_hours: 12, ready_by: '2026-01-16T07:30:00Z',
      capped_by_health_guardrail: false, ...estimates,
    };
    mockDecision.mockReturnValue(qr({ data: decision }));
    renderWidget();
    expect(screen.getByText('Enough energy')).toBeInTheDocument();
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('keeps the cached verdict when live SOC refresh fails and retries both sources', () => {
    const stateRetry = vi.fn();
    const decisionRetry = vi.fn();
    mockState.mockReturnValue(qr({ isError: true, error: new Error('state'), refetch: stateRetry }));
    mockDecision.mockReturnValue(qr({ data: { verdict: 'wait', reason: 'Retained verdict' }, refetch: decisionRetry }));
    renderWidget();
    expect(screen.getByText('Retained verdict')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i })); // shell hides the warning retry; recovery is the freshness dot
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

it('keeps the existing verdict and refresh control mounted while switching every pack', () => {
  mockDecision.mockReturnValue(qr({ data: {
    verdict: 'wait', reason: 'Retained across pack changes', current_soc: 42, target_soc: 80, kwh_needed: 28.5,
  } }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (packId: (typeof PACK_IDS)[number]) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={packId}>
          <NextChargeDecisionWidget vehicleId={1} size={SIZE} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree('classic'));
  const verdict = screen.getByText('Retained across pack changes');
  const refresh = screen.getByRole('button', { name: /^Refresh data/i });
  for (const packId of PACK_IDS) {
    view.rerender(tree(packId));
    expect(screen.getByText('Retained across pack changes')).toBe(verdict);
    expect(screen.getByRole('button', { name: /^Refresh data/i })).toBe(refresh);
  }
});
