/**
 * NudgePanel — behaviour coverage.
 *
 * The data hook (`useNudge`) is mocked and driven per test; shared UI
 * (Badge, ListSkeleton, QueryError) is REAL so the render-boundary
 * wiring is genuinely exercised.
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
  useNudge: vi.fn(),
}));

import { useNudge, type JourneySession } from '@/api/hooks/useJourney';
import { NudgePanel } from './NudgePanel';

const mockNudge = useNudge as unknown as ReturnType<typeof vi.fn>;

const session: JourneySession = {
  id: 1, vehicle_id: 7, name: 'Tahoe ski trip',
  origin_name: 'Home', origin_lat: 37.4, origin_lng: -122.1,
  dest_name: 'Tahoe', dest_lat: 39.1, dest_lng: -120.0,
  status: 'planned', plan_version: 0,
  created_at: '2026-09-10T10:00:00Z', updated_at: '2026-09-10T10:00:00Z',
  started_at: null, ended_at: null,
};

const nudge = {
  session_id: 1,
  verdict: 'wait',
  slot_at: '2026-09-14T14:00:00Z',
  blockers: [{ key: 'tire_pressure', status: 'action', detail: 'FR at 2.6 bar' }],
  evidence: ['1 blocker: FR at 2.6 bar', 'window opens Mon 14:00'],
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
        <NudgePanel session={session} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockNudge.mockReturnValue(idle({ data: nudge }));
});

describe('NudgePanel', () => {
  it('renders the verdict, slot, blockers, and evidence', () => {
    renderPanel();
    expect(screen.getByText('Wait')).toBeInTheDocument();
    expect(screen.getByText(/calm /)).toBeInTheDocument();
    expect(screen.getByText('FR at 2.6 bar')).toBeInTheDocument();
    expect(screen.getByText('Blocker')).toBeInTheDocument();
    expect(screen.getByText(/window opens/)).toBeInTheDocument();
  });

  it('celebrates a clean leave-now without blockers', () => {
    mockNudge.mockReturnValue(
      idle({ data: { ...nudge, verdict: 'leave_now', blockers: [] } }),
    );
    renderPanel();
    expect(screen.getByText('Leave now')).toBeInTheDocument();
    expect(screen.queryByText('Blocker')).not.toBeInTheDocument();
  });

  it('surfaces failures with a retry path', () => {
    const refetch = vi.fn();
    mockNudge.mockReturnValue(idle({ error: new Error('meteo down'), isError: true, refetch }));
    renderPanel();
    fireEvent.click(screen.getByText('Retry'));
    expect(refetch).toHaveBeenCalled();
  });
});
