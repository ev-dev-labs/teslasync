/**
 * ChecklistPanel — behaviour coverage.
 *
 * Data hooks (`useChecklist` / `useRefreshChecklist`) are mocked and
 * driven per test; shared UI (Badge, Button, EmptyState, ListSkeleton,
 * QueryError) is REAL so the render-boundary wiring is genuinely
 * exercised.
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
  useChecklist: vi.fn(),
  useRefreshChecklist: vi.fn(),
}));

import { useChecklist, useRefreshChecklist, type JourneySession } from '@/api/hooks/useJourney';
import { ChecklistPanel } from './ChecklistPanel';

const mockRun = useChecklist as unknown as ReturnType<typeof vi.fn>;
const mockRefresh = useRefreshChecklist as unknown as ReturnType<typeof vi.fn>;

const session: JourneySession = {
  id: 1, vehicle_id: 7, name: 'Tahoe ski trip',
  origin_name: 'Home', origin_lat: 37.4, origin_lng: -122.1,
  dest_name: 'Tahoe', dest_lat: 39.1, dest_lng: -120.0,
  status: 'planned', plan_version: 0,
  created_at: '2026-09-10T10:00:00Z', updated_at: '2026-09-10T10:00:00Z',
  started_at: null, ended_at: null,
};

const run = {
  id: 3,
  session_id: 1,
  run_at: '2026-09-14T09:00:00Z',
  items: [
    { key: 'charge_level', status: 'ok', detail: '85% (trip-ready is 80%+)' },
    { key: 'charge_limit', status: 'attention', detail: 'limit 80% (raise to 85%+ for trips)' },
    { key: 'tire_pressure', status: 'action', detail: 'lowest FR at 2.6 bar (placard 2.9)' },
    { key: 'storm', status: 'ok', detail: 'no severe weather on record' },
    { key: 'software_update', status: 'unknown', detail: 'no update on record' },
  ],
};

function idle(extra = {}) {
  return {
    data: undefined, isLoading: false, isFetching: false, isError: false,
    isPending: false, fetchStatus: 'idle', dataUpdatedAt: Date.now(),
    error: null, refetch: vi.fn(), ...extra,
  };
}

class Api404 extends Error {
  status = 404;
  constructor() {
    super('HTTP 404');
    this.name = 'ApiError';
  }
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ChecklistPanel session={session} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRun.mockReturnValue(idle({ data: run }));
  mockRefresh.mockReturnValue({ mutate: vi.fn(), isPending: false });
});

describe('ChecklistPanel', () => {
  it('renders items with localized labels and statuses', () => {
    renderPanel();
    expect(screen.getByText('Charge level')).toBeInTheDocument();
    expect(screen.getByText('Tire pressure')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Fix now')).toBeInTheDocument();
    expect(screen.getByText('lowest FR at 2.6 bar (placard 2.9)')).toBeInTheDocument();
  });

  it('refreshes the run for the session', () => {
    const mutate = vi.fn();
    mockRefresh.mockReturnValue({ mutate, isPending: false });
    renderPanel();
    fireEvent.click(screen.getByText('Re-check'));
    expect(mutate).toHaveBeenCalledWith(1);
  });

  it('treats never-ran as an empty state with a run action', () => {
    mockRun.mockReturnValue(idle({ data: undefined, error: new Api404(), isError: true }));
    const mutate = vi.fn();
    mockRefresh.mockReturnValue({ mutate, isPending: false });
    renderPanel();
    expect(screen.getByText(/No checks yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Run checklist'));
    expect(mutate).toHaveBeenCalledWith(1);
  });

  it('surfaces non-404 failures with a retry path', () => {
    const refetch = vi.fn();
    mockRun.mockReturnValue(idle({ error: new Error('db down'), isError: true, refetch }));
    renderPanel();
    fireEvent.click(screen.getByText('Retry'));
    expect(refetch).toHaveBeenCalled();
  });
});
