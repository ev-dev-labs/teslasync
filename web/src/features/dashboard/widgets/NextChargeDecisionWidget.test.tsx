/**
 * NextChargeDecisionWidget — dashboard tile for the 12-hour energy verdict.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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

function renderWidget() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NextChargeDecisionWidget vehicleId={1} size={SIZE} />
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
    expect(screen.getByText(/42% → 80%/)).toBeInTheDocument();
  });
});
