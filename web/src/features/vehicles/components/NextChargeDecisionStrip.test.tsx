/**
 * NextChargeDecisionStrip — vehicle-page 12-hour energy verdict.
 *
 * The strip is presentational orchestration around useNextChargeDecision:
 * loading skeleton, query error, waiting-for-SOC empty, no-data empty, and
 * the wait verdict with cost cards. The hook is mocked; i18n echoes fallbacks.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
      </MemoryRouter>
    </QueryClientProvider>,
  );
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
  });

  it('shows no-data empty with Autopilot navigation', () => {
    mockDecision.mockReturnValue(qr({ data: undefined }));
    renderStrip(40);
    expect(screen.getByText('No charge decision yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Autopilot' })).toHaveAttribute('href', '/smart-charge');
  });
});
