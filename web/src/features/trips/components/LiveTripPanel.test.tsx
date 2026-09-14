/**
 * LiveTripPanel — behaviour coverage.
 *
 * Data hooks (`useJourneyLive` / `useQueuedCheckIn`) and `useUnits` are
 * mocked and driven per test; shared UI (Badge, Button, EmptyState,
 * ListSkeleton, QueryError) is REAL so the render-boundary wiring is
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
vi.mock('@/api/hooks/useJourney', () => ({
  useJourneyLive: vi.fn(),
}));

vi.mock('../hooks/useQueuedCheckIn', () => ({
  useQueuedCheckIn: vi.fn(),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    formatDistance: (m: number) => `${m} m`,
    formatEnergy: (wh: number) => `${wh} Wh`,
    formatDuration: (s: number) => `${s} s`,
  }),
}));

import { useJourneyLive, type JourneySession } from '@/api/hooks/useJourney';
import { useQueuedCheckIn } from '../hooks/useQueuedCheckIn';
import { LiveTripPanel } from './LiveTripPanel';

const mockLive = useJourneyLive as unknown as ReturnType<typeof vi.fn>;
const mockQueuedCheckIn = useQueuedCheckIn as unknown as ReturnType<typeof vi.fn>;

const session: JourneySession = {
  id: 1, vehicle_id: 7, name: 'Denver run',
  origin_name: 'Denver', origin_lat: 39.7392, origin_lng: -104.9903,
  dest_name: 'KC', dest_lat: 39.0997, dest_lng: -94.5786,
  status: 'active', plan_version: 1,
  created_at: '2026-09-14T08:00:00Z', updated_at: '2026-09-14T10:00:00Z',
  started_at: '2026-09-14T08:05:00Z', ended_at: null,
};

const view = {
  session,
  latest: {
    id: 2, session_id: 1, recorded_at: '2026-09-14T10:00:00Z',
    lat: 39.5, lng: -100.0, soc_pct: 71, odometer_m: null,
  },
  trail: [
    {
      id: 1, session_id: 1, recorded_at: '2026-09-14T09:00:00Z',
      lat: 39.7392, lng: -104.9903, soc_pct: null, odometer_m: null,
    },
    {
      id: 2, session_id: 1, recorded_at: '2026-09-14T10:00:00Z',
      lat: 39.5, lng: -100.0, soc_pct: 71, odometer_m: null,
    },
  ],
  progress: { total_m: 900000, done_m: 450000, left_m: 450000 },
  range: { have_wh: 60000, need_wh: 81000, eff_wh_km: 180, verdict: 'action' },
  next: { site: 'Flagler SC', wait_s: 300 },
  evidence: ['last fix 10:00:00', 'energy short of the remainder — charge soon'],
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
        <LiveTripPanel session={session} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLive.mockReturnValue(idle({ data: view }));
  mockQueuedCheckIn.mockReturnValue({ checkIn: vi.fn(), queued: 0, flushing: false, isPending: false });
});

describe('LiveTripPanel', () => {
  it('renders progress, range verdict, next stop, and evidence', () => {
    renderPanel();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText('Charge soon')).toBeInTheDocument();
    expect(screen.getByText(/Flagler SC/)).toBeInTheDocument();
    expect(screen.getByText(/energy short of the remainder/)).toBeInTheDocument();
    expect(screen.getByText(/2 fixes/)).toBeInTheDocument();
  });

  it('checks in for the session', () => {
    const checkIn = vi.fn();
    mockQueuedCheckIn.mockReturnValue({ checkIn, queued: 0, flushing: false, isPending: false });
    renderPanel();
    fireEvent.click(screen.getByText('Check in'));
    expect(checkIn).toHaveBeenCalledTimes(1);
  });

  it('shows the queued count while offline entries wait', () => {
    mockQueuedCheckIn.mockReturnValue({
      checkIn: vi.fn(),
      queued: 2,
      flushing: false,
      isPending: false,
    });
    renderPanel();
    expect(screen.getByText('2 queued')).toBeInTheDocument();
  });

  it('treats no-fixes as an empty state with a check-in action', () => {
    mockLive.mockReturnValue(idle({ data: { ...view, latest: null, trail: [] } }));
    const checkIn = vi.fn();
    mockQueuedCheckIn.mockReturnValue({ checkIn, queued: 0, flushing: false, isPending: false });
    renderPanel();
    expect(screen.getByText(/No fixes yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Check in'));
    expect(checkIn).toHaveBeenCalledTimes(1);
  });

  it('omits progress and range numbers when the snapshot degrades', () => {
    mockLive.mockReturnValue(
      idle({
        data: {
          ...view,
          progress: null,
          range: { have_wh: null, need_wh: null, eff_wh_km: null, verdict: 'unknown' },
          next: null,
        },
      }),
    );
    renderPanel();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText('No scored stop yet')).toBeInTheDocument();
  });

  it('surfaces failures with a retry path', () => {
    const refetch = vi.fn();
    mockLive.mockReturnValue(idle({ error: new Error('db down'), isError: true, refetch }));
    renderPanel();
    fireEvent.click(screen.getByText('Retry'));
    expect(refetch).toHaveBeenCalled();
  });
});
