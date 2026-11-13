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
import { formatTime } from '@/lib/dateFormat';
import { getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { matchesAppDesignCss } from '@/components/feedback/appDesignCss.test-utils';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';

const datePreferences = vi.hoisted(() => ({ locale: 'en-US', tz: 'UTC' }));
vi.mock('@/hooks/useSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useSettings')>();
  return { ...actual, useSettings: () => ({ ...actual.useSettings(), locale: datePreferences.locale }) };
});
vi.mock('@/lib/timezone', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/timezone')>();
  return { ...actual, useTimezone: () => datePreferences.tz };
});

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
  route_factor: 1.05,
  route_trips: 2,
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
  Object.assign(datePreferences, { locale: 'en-US', tz: 'UTC' });
  vi.clearAllMocks();
  mockArrival.mockReturnValue(idle({ data: arrival }));
});

describe('ArrivalPanel', () => {
  it('activates the deliberate inline readout consumers without adding a gauge or changing ETA context', () => {
    const { container } = renderPanel();
    const readout = screen.getByText('ETA').closest('[data-app-metric="inline"]')!;
    const reading = readout.querySelector('[data-app-part~="metric-reading"]')!;
    const label = readout.querySelector('[data-app-part~="metric-label"]')!;
    const context = readout.querySelector('[data-app-part~="metric-context"]')!;
    const contents = readout.textContent;
    expect(readout).not.toHaveAttribute('data-app-design-owner');
    container.setAttribute('data-app-design-preview', '');
    for (const pack of PACK_IDS) {
      for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) container.setAttribute(name, value);
      const release = observeAppDesignScopes(container);
      try {
        expect(matchesAppDesignCss(readout, '[data-app-metric="inline"]')
          .some(rule => rule.declarations['flex-wrap'] === 'wrap'), pack).toBe(true);
        expect(matchesAppDesignCss(reading, '[data-app-part~="metric-reading"]')
          .some(rule => rule.declarations['font-variant-numeric'] === 'tabular-nums lining-nums'), pack).toBe(true);
        for (const node of [label, context]) {
          expect(matchesAppDesignCss(node).some(rule => rule.declarations['overflow-wrap'] === 'anywhere'), pack).toBe(true);
        }
        expect(readout).toHaveAttribute('data-app-design-owner', expect.stringContaining(`pack-${pack}`));
        expect(readout.textContent).toBe(contents);
        expect(readout.querySelector('[role="meter"], [role="progressbar"], [data-app-part~="card"]')).toBeNull();
      } finally {
        release();
      }
    }
    expect(readout).not.toHaveAttribute('data-app-design-owner');
  });

  it('formats ETA in the selected locale and timezone', () => {
    Object.assign(datePreferences, { locale: 'de-DE', tz: 'America/Los_Angeles' });
    renderPanel();
    expect(screen.getByText(formatTime(arrival.eta_at, datePreferences))).toBeInTheDocument();
  });

  it('renders ETA, pace, distance, advice, and evidence', () => {
    renderPanel();
    expect(screen.getByText('ETA')).toBeInTheDocument();
    expect(screen.getByText(/\d{1,2}:\d{2}/)).toBeInTheDocument();
    expect(screen.getByText(/moving\s+·/)).toBeInTheDocument();
    expect(screen.getByText(/25 m\/s/)).toBeInTheDocument();
    expect(screen.getByText(/450000 m/)).toBeInTheDocument();
    expect(screen.getByText('Top up en route')).toBeInTheDocument();
    expect(screen.getByText(/top up ≈ 15700 Wh en route/)).toBeInTheDocument();
    expect(screen.getByText('adjusted 1.05× from 2 trips')).toBeInTheDocument();
    expect(screen.getByText(/hold the buffer/)).toBeInTheDocument();
    const readout = screen.getByText('ETA').closest('[data-app-metric="inline"]')!;
    expect(readout).toHaveClass('flex', 'flex-wrap', 'items-baseline');
    expect(readout.querySelector('[data-app-part~="metric-reading"]')).toHaveTextContent(formatTime(arrival.eta_at, datePreferences));
    expect(readout.querySelector('[data-app-part="metric-context"]')).toHaveTextContent('moving · 25 m/s · 450000 m');
    expect(readout.querySelector('[data-app-part="metric-label"]')).toHaveTextContent('ETA');
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
    expect(screen.queryByText(/top up ≈ 15700 Wh en route$/)).not.toBeInTheDocument();
  });

  it('surfaces failures with a retry path', () => {
    const refetch = vi.fn();
    mockArrival.mockReturnValue(idle({ error: new Error('db down'), isError: true, refetch }));
    renderPanel();
    fireEvent.click(screen.getByText('Retry'));
    expect(refetch).toHaveBeenCalled();
  });

  it('retains ETA, route context and every evidence line across an arrival refresh failure', () => {
    mockArrival.mockReturnValue(idle({
      data: arrival, error: new Error('arrival refresh failed'), isError: true, isFetching: true,
    }));
    renderPanel();
    expect(screen.getByRole('heading', { name: 'Arrival' })).toBeInTheDocument();
    expect(screen.getByText('KC')).toBeInTheDocument();
    expect(screen.getByText('Top up en route')).toBeInTheDocument();
    expect(screen.getByText('adjusted 1.05× from 2 trips')).toBeInTheDocument();
    for (const line of arrival.evidence) expect(screen.getByText(`· ${line}`)).toBeInTheDocument();
    expect(screen.getByText(/Previously loaded data remains visible/)).toBeInTheDocument();
  });

  it('shows measured zero pace, remaining distance and shortfall instead of unavailable placeholders', () => {
    mockArrival.mockReturnValue(idle({
      data: { ...arrival, pace_ms: 0, left_m: 0, shortfall_wh: 0, eta_at: null },
    }));
    renderPanel();
    expect(screen.getByText(/0 m\/s · 0 m/)).toBeInTheDocument();
    expect(screen.getByText('top up ≈ 0 Wh en route')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('ETA').closest('[data-app-metric="inline"]')?.querySelector('[data-app-part~="metric-reading"]'))
      .toHaveTextContent('—');
  });

  it('keeps unavailable ETA and absent pace distinct from a resolved empty or loading source', () => {
    mockArrival.mockReturnValue(idle({
      data: { ...arrival, eta_at: null, pace_ms: null, left_m: null, verdict: 'unknown', shortfall_wh: null },
    }));
    const { unmount } = renderPanel();
    const readout = screen.getByText('ETA').closest('[data-app-metric="inline"]')!;
    expect(readout.querySelector('[data-app-part~="metric-reading"]')).toHaveTextContent('—');
    expect(readout.querySelector('[data-app-part~="metric-context"]')).toHaveTextContent(/^moving$/);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    unmount();
    mockArrival.mockReturnValue(idle({ isLoading: true, isPending: true, isFetching: true, fetchStatus: 'fetching' }));
    const loading = renderPanel();
    expect(screen.getByRole('heading', { name: 'Arrival' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Preparing arrival…' })).toBeInTheDocument();
    expect(screen.queryByText('ETA')).not.toBeInTheDocument();
    loading.unmount();
    mockArrival.mockReturnValue(idle({ data: null, isSuccess: true }));
    renderPanel();
    expect(screen.getByText('No arrival reading yet.')).toBeInTheDocument();
    expect(screen.queryByText('ETA')).not.toBeInTheDocument();
  });
});
