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
    unitPrefs: {
      distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
      energy: 'kWh', duration: 'h', power: 'kW', locale: 'en-US', precision: 2,
    },
    formatDistance: (m: number) => `${m} m`,
    formatDuration: (s: number) => `${s} s`,
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
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
  route_factor: 1.05,
  route_trips: 3,
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
  it('shows all seven busy brief placeholders without presenting them as measurements', () => {
    mockReport.mockReturnValue(idle({ isLoading: true, isPending: true, fetchStatus: 'fetching' }));
    const { container } = renderPanel();
    expect(container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(7);
    expect(container.querySelector('[data-operational-value]')).toBeNull();
  });

  it('renders the card stats and evidence', () => {
    renderPanel();
    expect(screen.getByText('900000 m')).toBeInTheDocument();
    expect(screen.getByText('9000 s')).toBeInTheDocument();
    expect(screen.getByText('1.13×')).toBeInTheDocument();
    expect(screen.getByText('1.05× over 3 trips')).toBeInTheDocument();
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

  it('retains all seven detail rows and complete evidence when the report refresh fails', () => {
    mockReport.mockReturnValue(idle({
      data: report, error: new Error('report refresh failed'), isError: true, isFetching: true,
    }));
    const { container } = renderPanel();
    expect(screen.getByRole('heading', { name: 'Trip report' })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(7);
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(7);
    expect(screen.getByText('900000 m')).toBeInTheDocument();
    expect(screen.getByText('9000 s')).toBeInTheDocument();
    expect(screen.getByText('1.13×')).toBeInTheDocument();
    expect(screen.getByText('1.05× over 3 trips')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 plans')).toBeInTheDocument();
    expect(screen.getByText('4 of 5')).toBeInTheDocument();
    for (const line of report.evidence) expect(screen.getByText(`· ${line}`)).toBeInTheDocument();
    expect(screen.getByText(/Previously loaded data remains visible/)).toBeInTheDocument();
  });

  it('does not turn known zero distance, duration or detour into missing data', () => {
    mockReport.mockReturnValue(idle({
      data: { ...report, distance_m: 0, duration_s: 0, detour: 0 },
    }));
    renderPanel();
    expect(screen.getByText('0 m')).toBeInTheDocument();
    expect(screen.getByText('0 s')).toBeInTheDocument();
    expect(screen.getByText('0.00×')).toBeInTheDocument();
  });

  it('opens the real review drawer with all report denominators and route-history context', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(drawer).toHaveTextContent('900000 m');
    expect(drawer).toHaveTextContent('9000 s');
    expect(drawer).toHaveTextContent('1 of 2 plans');
    expect(drawer).toHaveTextContent('1.05× over 3 trips');
    expect(drawer).toHaveTextContent('4 of 5');
    expect(drawer).toHaveTextContent('route-history trips have a separate denominator');
  });
});
