/**
 * StopScorePanel — behaviour coverage.
 *
 * Data hooks (`useWaitOracleSites` / `useScoreStops`) are mocked and
 * driven per test; shared UI (Checkbox, DataTable, Badge, UnitInput,
 * QueryError, EmptyState) is REAL so the render-boundary wiring is
 * genuinely exercised.
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
vi.mock('@/api/hooks/useCharging', () => ({
  useWaitOracleSites: vi.fn(),
}));
vi.mock('@/api/hooks/useJourney', () => ({
  useScoreStops: vi.fn(),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatDistance: (m: number) => `${m} m` }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    formatCurrency: (amount: number, decimals = 2) => `$${Number(amount ?? 0).toFixed(decimals)}`,
  }),
}));

import { useWaitOracleSites } from '@/api/hooks/useCharging';
import { useScoreStops, type JourneySession } from '@/api/hooks/useJourney';
import { StopScorePanel } from './StopScorePanel';

const mockSites = useWaitOracleSites as unknown as ReturnType<typeof vi.fn>;
const mockScore = useScoreStops as unknown as ReturnType<typeof vi.fn>;

const session: JourneySession = {
  id: 1, vehicle_id: 7, name: 'Tahoe ski trip',
  origin_name: 'Home', origin_lat: 37.4, origin_lng: -122.1,
  dest_name: 'Tahoe', dest_lat: 39.1, dest_lng: -120.0,
  status: 'planned', plan_version: 0,
  created_at: '2026-09-10T10:00:00Z', updated_at: '2026-09-10T10:00:00Z',
  started_at: null, ended_at: null,
};

const sites = [
  { name: 'Kettleman City', sessions: 200, lat: 35.99, lng: -119.96, last_session: '2026-09-10T18:00:00Z' },
  { name: 'Barstow', sessions: 40, lat: 34.9, lng: -117.02, last_session: '2026-09-09T12:00:00Z' },
];

const scores = {
  session_id: 1,
  energy_wh: 40000,
  winner: 'Kettleman City',
  plan_version: 1,
  stops: [
    {
      site: 'Kettleman City', score: 92.5, wait_s: 300, unit_price: 0.32,
      health: 88, corridor_m: 1200, evidence: ['expected wait 5 min'],
    },
    {
      site: 'Barstow', score: 41.0, wait_s: null, unit_price: null,
      health: null, corridor_m: 95000, evidence: ['no fleet data — ranked on corridor only'],
    },
  ],
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
        <StopScorePanel session={session} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSites.mockReturnValue(idle({ data: sites }));
  mockScore.mockReturnValue({ mutate: vi.fn(), isPending: false, data: undefined });
});

describe('StopScorePanel', () => {
  it('asks for coordinates when the session has none', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <StopScorePanel session={{ ...session, origin_lat: null }} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText(/Add origin and destination coordinates/)).toBeInTheDocument();
  });

  it('lists candidate sites with visit counts', () => {
    renderPanel();
    expect(screen.getByText('Score stops')).toBeInTheDocument();
    expect(screen.getByText(/Kettleman City \(200 visits\)/)).toBeInTheDocument();
    expect(screen.getByText(/Barstow \(40 visits\)/)).toBeInTheDocument();
  });

  it('submits selected sites with arrival and energy', () => {
    const mutate = vi.fn();
    mockScore.mockReturnValue({ mutate, isPending: false, data: undefined });
    renderPanel();
    fireEvent.click(screen.getByText(/Kettleman City \(200 visits\)/));
    fireEvent.click(screen.getByText('Score 1 stops'));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        energy_wh: 40000,
        candidates: [
          expect.objectContaining({ site: 'Kettleman City', lat: 35.99, lng: -119.96 }),
        ],
      }),
    );
    const [{ candidates }] = mutate.mock.calls[0] as [{ candidates: Array<{ arrive_at: string }> }];
    expect(candidates[0].arrive_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('renders the ranking with winner, signals, and evidence', () => {
    mockScore.mockReturnValue({ mutate: vi.fn(), isPending: false, data: scores });
    renderPanel();
    expect(screen.getByText('Kettleman City wins')).toBeInTheDocument();
    expect(screen.getByText('expected wait 5 min')).toBeInTheDocument();
    expect(screen.getByText('no fleet data — ranked on corridor only')).toBeInTheDocument();
    expect(screen.getByText('v1')).toBeInTheDocument();
  });

  it('surfaces site failures with a retry path', () => {
    const refetch = vi.fn();
    mockSites.mockReturnValue(idle({ error: new Error('sites down'), isError: true, refetch }));
    renderPanel();
    fireEvent.click(screen.getByText('Retry'));
    expect(refetch).toHaveBeenCalled();
  });
});
