/**
 * JourneyPanel — behaviour coverage.
 *
 * Data hooks (`useJourneys` / `useJourney` / `useCreateJourney` /
 * `useTransitionJourney`) are mocked and driven per test; shared UI
 * (GlassPanel, DataTable, Badge, Select, Input, Button, QueryError,
 * EmptyState) is REAL so the render-boundary wiring is genuinely
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
  useJourneys: vi.fn(),
  useJourney: vi.fn(),
  useCreateJourney: vi.fn(),
  useTransitionJourney: vi.fn(),
}));

import {
  useJourneys,
  useJourney,
  useCreateJourney,
  useTransitionJourney,
} from '@/api/hooks/useJourney';
import { JourneyPanel } from './JourneyPanel';

const mockList = useJourneys as unknown as ReturnType<typeof vi.fn>;
const mockDetail = useJourney as unknown as ReturnType<typeof vi.fn>;
const mockCreate = useCreateJourney as unknown as ReturnType<typeof vi.fn>;
const mockTransition = useTransitionJourney as unknown as ReturnType<typeof vi.fn>;

const sessions = [
  {
    id: 1, vehicle_id: 7, name: 'Tahoe ski trip',
    origin_name: 'Home', origin_lat: null, origin_lng: null,
    dest_name: 'Tahoe', dest_lat: 39.1, dest_lng: -120.0,
    status: 'planned', plan_version: 1,
    created_at: '2026-09-10T10:00:00Z', updated_at: '2026-09-10T10:00:00Z',
    started_at: null, ended_at: null,
  },
  {
    id: 2, vehicle_id: 7, name: 'LA run',
    origin_name: '', origin_lat: null, origin_lng: null,
    dest_name: '', dest_lat: null, dest_lng: null,
    status: 'active', plan_version: 3,
    created_at: '2026-09-09T10:00:00Z', updated_at: '2026-09-11T08:00:00Z',
    started_at: '2026-09-11T08:00:00Z', ended_at: null,
  },
];

const detail = {
  session: sessions[0],
  plans: [
    { id: 11, session_id: 1, version: 1, plan: {}, note: 'initial', created_at: '2026-09-10T10:00:00Z' },
  ],
  next_statuses: ['active', 'aborted'],
};

function idle(extra = {}) {
  return {
    data: undefined, isLoading: false, isFetching: false, isError: false,
    isPending: false, fetchStatus: 'idle', dataUpdatedAt: Date.now(),
    error: null, refetch: vi.fn(), ...extra,
  };
}

function renderPanel(vehicleId: number | null = 7) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <JourneyPanel vehicleId={vehicleId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockList.mockReturnValue(idle({ data: sessions }));
  mockDetail.mockReturnValue(idle());
  mockCreate.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockTransition.mockReturnValue({ mutate: vi.fn(), isPending: false });
});

describe('JourneyPanel', () => {
  it('lists sessions with routes and statuses', () => {
    renderPanel();
    expect(mockList).toHaveBeenCalledWith(7, '');
    expect(screen.getByText('Tahoe ski trip')).toBeInTheDocument();
    expect(screen.getByText('Home → Tahoe')).toBeInTheDocument();
    expect(screen.getByText('planned')).toBeInTheDocument();
    expect(screen.getByText('v1')).toBeInTheDocument();
  });

  it('shows a skeleton while loading and an empty state without data', () => {
    mockList.mockReturnValue(idle({ data: undefined, isLoading: true }));
    const { unmount } = renderPanel();
    expect(screen.getByRole('status', { name: 'Loading journeys…' })).toBeInTheDocument();
    unmount();

    mockList.mockReturnValue(idle({ data: [] }));
    renderPanel();
    expect(screen.getByText(/No journeys yet/)).toBeInTheDocument();
  });

  it('creates a journey from the form', () => {
    const mutate = vi.fn();
    mockCreate.mockReturnValue({ mutate, isPending: false });
    renderPanel();
    fireEvent.click(screen.getByText('Plan journey'));
    fireEvent.change(screen.getByLabelText('Journey name'), {
      target: { value: 'Vegas weekend' },
    });
    fireEvent.change(screen.getByLabelText('Destination'), {
      target: { value: 'Las Vegas' },
    });
    fireEvent.click(screen.getByText('Create journey'));
    expect(mutate).toHaveBeenCalledWith(
      { vehicle_id: 7, name: 'Vegas weekend', origin_name: undefined, dest_name: 'Las Vegas' },
      expect.anything(),
    );
  });

  it('opens a session and offers only server-provided transitions', () => {
    mockDetail.mockReturnValue(idle({ data: detail }));
    renderPanel();
    fireEvent.click(screen.getAllByText('Open')[0]);
    expect(mockDetail).toHaveBeenCalledWith(1);
    expect(screen.getByText('Start')).toBeInTheDocument();
    expect(screen.getByText('Abort')).toBeInTheDocument();
    expect(screen.queryByText('Pause')).not.toBeInTheDocument();
    expect(screen.getByText(/v1 · initial/)).toBeInTheDocument();
  });

  it('fires the transition mutation with the session id and action', () => {
    const mutate = vi.fn();
    mockTransition.mockReturnValue({ mutate, isPending: false });
    mockDetail.mockReturnValue(idle({ data: detail }));
    renderPanel();
    fireEvent.click(screen.getAllByText('Open')[0]);
    fireEvent.click(screen.getByText('Start'));
    expect(mutate).toHaveBeenCalledWith({ id: 1, action: 'start' });
  });

  it('surfaces list failures with a retry path', () => {
    const refetch = vi.fn();
    mockList.mockReturnValue(idle({ error: new Error('list down'), isError: true, refetch }));
    renderPanel();
    fireEvent.click(screen.getByText('Retry'));
    expect(refetch).toHaveBeenCalled();
  });
});
