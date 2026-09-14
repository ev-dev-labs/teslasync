/**
 * DeparturePanel — behaviour coverage.
 *
 * The data hook (`useDeparture`) is mocked and driven per test; shared
 * UI (Badge, Button, ListSkeleton, QueryError) is REAL so the
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

// ── data hook, driven per test ──
vi.mock('@/api/hooks/useJourney', () => ({
  useDeparture: vi.fn(),
}));

import { useDeparture, type JourneySession } from '@/api/hooks/useJourney';
import { DeparturePanel } from './DeparturePanel';

const mockDeparture = useDeparture as unknown as ReturnType<typeof vi.fn>;

const session: JourneySession = {
  id: 1, vehicle_id: 7, name: 'Tahoe ski trip',
  origin_name: 'Home', origin_lat: 37.4, origin_lng: -122.1,
  dest_name: 'Tahoe', dest_lat: 39.1, dest_lng: -120.0,
  status: 'planned', plan_version: 0,
  created_at: '2026-09-10T10:00:00Z', updated_at: '2026-09-10T10:00:00Z',
  started_at: null, ended_at: null,
};

const advice = {
  session_id: 1,
  recommended_at: '2026-09-14T10:00:00Z',
  charge: { soc_pct: 82, limit_pct: 90 },
  evidence: ['6 slots scored, 2 warning, 1 watch'],
  slots: [
    { depart_at: '2026-09-14T10:00:00Z', level: 'none', score: 100 },
    { depart_at: '2026-09-14T11:00:00Z', level: 'warning', score: 0 },
    { depart_at: '2026-09-14T12:00:00Z', level: 'watch', score: 50 },
  ],
};

function idle(extra = {}) {
  return {
    data: undefined, isLoading: false, isFetching: false, isError: false,
    isPending: false, fetchStatus: 'idle', dataUpdatedAt: Date.now(),
    error: null, refetch: vi.fn(), ...extra,
  };
}

function renderPanel(s: JourneySession = session) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DeparturePanel session={s} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDeparture.mockReturnValue(idle({ data: advice }));
});

describe('DeparturePanel', () => {
  it('asks for an origin when the session has none', () => {
    renderPanel({ ...session, origin_lat: null });
    expect(screen.getByText(/Add an origin to advise/)).toBeInTheDocument();
    expect(mockDeparture.mock.calls[0][3]).toEqual({ enabled: false });
  });

  it('recommends the calm slot with charge context and evidence', () => {
    renderPanel();
    expect(screen.getByText(/Leave /)).toBeInTheDocument();
    expect(screen.getByText('Battery 82% now')).toBeInTheDocument();
    expect(screen.getByText('6 slots scored, 2 warning, 1 watch')).toBeInTheDocument();
  });

  it('re-queries when the window changes', () => {
    renderPanel();
    fireEvent.click(screen.getByText('24h'));
    const [, , from, to] = mockDeparture.mock.lastCall as [number, string, string, string];
    expect(new Date(to).getTime() - new Date(from).getTime()).toBe(24 * 3600_000);
  });

  it('warns when every hour warns', () => {
    mockDeparture.mockReturnValue(idle({
      data: { ...advice, recommended_at: null },
    }));
    renderPanel();
    expect(screen.getByText('Every hour warns — delay if you can')).toBeInTheDocument();
  });

  it('surfaces failures with a retry path', () => {
    const refetch = vi.fn();
    mockDeparture.mockReturnValue(idle({ error: new Error('meteo down'), isError: true, refetch }));
    renderPanel();
    fireEvent.click(screen.getByText('Retry'));
    expect(refetch).toHaveBeenCalled();
  });
});
