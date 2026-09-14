/**
 * ReportPanel — behaviour coverage.
 *
 * The data hook (`useReport`) and `useUnits` are mocked and driven per
 * test; shared UI (ListSkeleton, QueryError) is REAL so the
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
  useReport: vi.fn(),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    formatDistance: (m: number) => `${m} m`,
    formatDuration: (s: number) => `${s} s`,
  }),
}));

import { useReport, type JourneySession } from '@/api/hooks/useJourney';
import { ReportPanel } from './ReportPanel';

const mockReport = useReport as unknown as ReturnType<typeof vi.fn>;

const session: JourneySession = {
  id: 1, vehicle_id: 7, name: 'Denver run',
  origin_name: 'Denver', origin_lat: 39.7392, origin_lng: -104.9903,
  dest_name: 'KC', dest_lat: 39.0997, dest_lng: -94.5786,
  status: 'completed', plan_version: 2,
  created_at: '2026-09-14T08:00:00Z', updated_at: '2026-09-14T11:30:00Z',
  started_at: '2026-09-14T09:00:00Z', ended_at: '2026-09-14T11:30:00Z',
};

const report = {
  session_id: 1,
  status: 'completed',
  started_at: '2026-09-14T09:00:00Z',
  ended_at: '2026-09-14T11:30:00Z',
  duration_s: 9000,
  distance_m: 900000,
  fixes: 12,
  plans: 2,
  replans: 1,
  detour: 1.13,
  checklist: { ready: 4, total: 5 },
  evidence: ['trip time 150 min', 'drove 900 km', '1 replan en route'],
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
        <ReportPanel session={session} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReport.mockReturnValue(idle({ data: report }));
});

describe('ReportPanel', () => {
  it('renders the card stats and evidence', () => {
    renderPanel();
    expect(screen.getByText('900000 m')).toBeInTheDocument();
    expect(screen.getByText('9000 s')).toBeInTheDocument();
    expect(screen.getByText(/×/)).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 plans/)).toBeInTheDocument();
    expect(screen.getByText(/4 of 5/)).toBeInTheDocument();
    expect(screen.getByText(/1 replan en route/)).toBeInTheDocument();
  });

  it('dashes missing stats without failing', () => {
    mockReport.mockReturnValue(
      idle({
        data: { ...report, distance_m: null, duration_s: null, detour: null, checklist: null },
      }),
    );
    renderPanel();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText(/1 of 2 plans/)).toBeInTheDocument();
  });

  it('surfaces failures with a retry path', () => {
    const refetch = vi.fn();
    mockReport.mockReturnValue(idle({ error: new Error('db down'), isError: true, refetch }));
    renderPanel();
    fireEvent.click(screen.getByText('Retry'));
    expect(refetch).toHaveBeenCalled();
  });
});
