/**
 * ArrivalPanel — behaviour coverage.
 *
 * The data hook (`useArrival`) and `useUnits` are mocked and driven
 * per test; shared UI (Badge, ListSkeleton, QueryError) is REAL so the
 * render-boundary wiring is genuinely exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// ── i18n stub ──
vi.mock('react-i18next', () => {
  const interpolate = (str: string, vars?: Record<string, unknown> | null): string => {
    if (!vars) return str;
    let s = str;
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
    }
    return s;
  };
  const t = (key: string, second?: unknown, third?: unknown): string => {
    if (typeof second === 'string') return interpolate(second, third as Record<string, unknown> | undefined);
    if (second && typeof second === 'object') {
      const bag = second as Record<string, unknown>;
      const tpl = typeof bag.defaultValue === 'string' ? bag.defaultValue : key;
      return interpolate(tpl, bag);
    }
    return key;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

// ── data hooks, driven per test ──
vi.mock('@/api/hooks/useJourney', () => ({
  useArrival: vi.fn(),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    formatDistance: (m: number) => `${m} m`,
    formatSpeed: (mps: number) => `${mps} m/s`,
    formatEnergy: (wh: number) => `${wh} Wh`,
  }),
}));

import { useArrival, type JourneySession } from '@/api/hooks/useJourney';
import { ArrivalPanel } from './ArrivalPanel';

const mockArrival = useArrival as unknown as ReturnType<typeof vi.fn>;

const session: JourneySession = {
  id: 1, vehicle_id: 7, name: 'Denver run',
  origin_name: 'Denver', origin_lat: 39.7392, origin_lng: -104.9903,
  dest_name: 'KC', dest_lat: 39.0997, dest_lng: -94.5786,
  status: 'active', plan_version: 1,
  created_at: '2026-09-14T08:00:00Z', updated_at: '2026-09-14T10:00:00Z',
  started_at: '2026-09-14T08:05:00Z', ended_at: null,
};

const arrival = {
  session_id: 1,
  dest_name: 'KC',
  left_m: 450000,
  pace_ms: 25,
  eta_at: '2026-09-14T15:00:00Z',
  moving: true,
  verdict: 'action',
  shortfall_wh: 15700,
  evidence: ['450 km to KC', 'moving at pace', 'top up ≈ 15.7 kWh en route to hold the buffer'],
};

function idle(extra = {}) {
  return {
    data: undefined, isLoading: false, isFetching: false, isError: false,
    isPending: false, fetchStatus: 'idle', dataUpdatedAt: Date.now(),
    error: null, refetch: vi.fn(), ...extra,
  };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ArrivalPanel session={session} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockArrival.mockReturnValue(idle({ data: arrival }));
});

describe('ArrivalPanel', () => {
  it('renders ETA, pace, distance, advice, and evidence', () => {
    renderPanel();
    expect(screen.getByText('ETA')).toBeInTheDocument();
    expect(screen.getByText(/\d{1,2}:\d{2}/)).toBeInTheDocument();
    expect(screen.getByText(/moving/)).toBeInTheDocument();
    expect(screen.getByText(/25 m\/s/)).toBeInTheDocument();
    expect(screen.getByText(/450000 m/)).toBeInTheDocument();
    expect(screen.getByText('Top up en route')).toBeInTheDocument();
    expect(screen.getByText(/top up ≈ 15700 Wh en route/)).toBeInTheDocument();
    expect(screen.getByText(/hold the buffer/)).toBeInTheDocument();
  });

  it('reads parked without an ETA and omits the shortfall when covered', () => {
    mockArrival.mockReturnValue(
      idle({
        data: {
          ...arrival,
          pace_ms: 0,
          eta_at: null,
          moving: false,
          verdict: 'ok',
          shortfall_wh: null,
        },
      }),
    );
    renderPanel();
    expect(screen.getByText(/parked/)).toBeInTheDocument();
    expect(screen.getByText('Arrive with buffer')).toBeInTheDocument();
    expect(screen.queryByText(/top up ≈/)).not.toBeInTheDocument();
  });

  it('surfaces failures with a retry path', () => {
    const refetch = vi.fn();
    mockArrival.mockReturnValue(idle({ error: new Error('db down'), isError: true, refetch }));
    renderPanel();
    fireEvent.click(screen.getByText('Retry'));
    expect(refetch).toHaveBeenCalled();
  });
});
