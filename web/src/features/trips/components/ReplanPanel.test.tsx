/**
 * ReplanPanel — behaviour coverage.
 *
 * Data hooks (`useReplanAssessment` / `useRequestReplan`), `useUnits`,
 * and `useFormatting` are mocked and driven per test; shared UI (Badge,
 * Button, ListSkeleton, QueryError, StopScoreTable) is REAL so the
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
  useReplanAssessment: vi.fn(),
  useRequestReplan: vi.fn(),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    formatDistance: (m: number) => `${m} m`,
  }),
}));

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    formatCurrency: (amount: number, decimals = 2) => `$${Number(amount ?? 0).toFixed(decimals)}`,
  }),
}));

import {
  useReplanAssessment,
  useRequestReplan,
  type JourneySession,
} from '@/api/hooks/useJourney';
import { ReplanPanel } from './ReplanPanel';

const mockAssess = useReplanAssessment as unknown as ReturnType<typeof vi.fn>;
const mockReplan = useRequestReplan as unknown as ReturnType<typeof vi.fn>;

const session: JourneySession = {
  id: 1, vehicle_id: 7, name: 'Denver run',
  origin_name: 'Denver', origin_lat: 39.7392, origin_lng: -104.9903,
  dest_name: 'KC', dest_lat: 39.0997, dest_lng: -94.5786,
  status: 'active', plan_version: 1,
  created_at: '2026-09-14T08:00:00Z', updated_at: '2026-09-14T10:00:00Z',
  started_at: '2026-09-14T08:05:00Z', ended_at: null,
};

const assessment = {
  session_id: 1,
  deviation: { deviation_m: 12500, verdict: 'off_route' },
  latest: {
    id: 2, session_id: 1, recorded_at: '2026-09-14T10:00:00Z',
    lat: 39.5, lng: -100.0, soc_pct: 71, odometer_m: null,
  },
  evidence: ['off the straight-line corridor by 13 km', 'off route — rescore from the current position'],
};

const scores = {
  session_id: 1,
  energy_wh: 40000,
  winner: 'Flagler SC',
  plan_version: 2,
  stops: [
    {
      site: 'Flagler SC', score: 92.5, wait_s: 300, unit_price: 0.32,
      health: 88, corridor_m: 1200, evidence: ['expected wait 5 min'],
    },
    {
      site: 'Nowhere', score: 41.0, wait_s: null, unit_price: null,
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
        <ReplanPanel session={session} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAssess.mockReturnValue(idle({ data: assessment }));
  mockReplan.mockReturnValue({ mutate: vi.fn(), isPending: false, data: undefined });
});

describe('ReplanPanel', () => {
  it('renders the verdict, distance, and evidence', () => {
    renderPanel();
    expect(screen.getByText('Off route')).toBeInTheDocument();
    expect(screen.getByText('12500 m off corridor')).toBeInTheDocument();
    expect(screen.getByText(/rescore from the current position/)).toBeInTheDocument();
  });

  it('rescores from the session without extra input', () => {
    const mutate = vi.fn();
    mockReplan.mockReturnValue({ mutate, isPending: false, data: undefined });
    renderPanel();
    fireEvent.click(screen.getByText('Rescore from here'));
    expect(mutate).toHaveBeenCalledWith({ id: 1 });
  });

  it('disables rescoring until a fix exists', () => {
    mockAssess.mockReturnValue(idle({ data: { ...assessment, latest: null } }));
    renderPanel();
    expect(screen.getByText('Rescore from here')).toBeDisabled();
  });

  it('renders the replan ranking with winner and version', () => {
    mockReplan.mockReturnValue({ mutate: vi.fn(), isPending: false, data: scores });
    renderPanel();
    expect(screen.getByText('Flagler SC wins')).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(screen.getByText('Nowhere')).toBeInTheDocument();
  });

  it('surfaces failures with a retry path', () => {
    const refetch = vi.fn();
    mockAssess.mockReturnValue(idle({ error: new Error('db down'), isError: true, refetch }));
    renderPanel();
    fireEvent.click(screen.getByText('Retry'));
    expect(refetch).toHaveBeenCalled();
  });
});
