/**
 * WaitOraclePanel — behaviour coverage.
 *
 * Data hooks (`useWaitOracleSites` / `useWaitOracleForecast`) are mocked
 * and driven per test; shared UI (GlassPanel, Select, ChartContainer,
 * Badge, QueryError, EmptyState) is REAL so the render-boundary wiring
 * is genuinely exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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
  useWaitOracleForecast: vi.fn(),
}));

import { useWaitOracleSites, useWaitOracleForecast } from '@/api/hooks/useCharging';
import { WaitOraclePanel } from './WaitOraclePanel';

const mockSites = useWaitOracleSites as unknown as ReturnType<typeof vi.fn>;
const mockForecast = useWaitOracleForecast as unknown as ReturnType<typeof vi.fn>;

const sites = [
  { name: 'Kettleman City', sessions: 200, lat: 35.99, lng: -119.96, last_session: '2026-09-10T18:00:00Z' },
  { name: 'Barstow', sessions: 40, lat: 34.9, lng: -117.02, last_session: '2026-09-09T12:00:00Z' },
];

const forecast = {
  site: 'Kettleman City',
  arrive_at: '2026-09-11T18:00:00Z',
  expected_wait_s: 2646,
  wait_probability_pct: 73.8,
  busyness: 100,
  verdict: 'packed',
  confidence: 'high',
  stalls_estimated: 4,
  best_hour_utc: 15,
  best_wait_s: 0,
  save_s: 2646,
  hours: [
    { hour: 15, expected_wait_s: 0, busyness: 14.3 },
    { hour: 18, expected_wait_s: 2646, busyness: 100 },
  ],
  evidence: ['1740 sessions over 10.0 weeks', 'median session 30 min'],
};

function idle(extra = {}) {
  return {
    data: undefined, isLoading: false, isFetching: false, error: null,
    isError: false, isPending: false, fetchStatus: 'idle', dataUpdatedAt: Date.now(),
    refetch: vi.fn(), ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSites.mockReturnValue(idle({ data: sites }));
  mockForecast.mockReturnValue(idle({ data: forecast }));
});

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <WaitOraclePanel />,
    { wrapper: ({ children }) => (
      <QueryClientProvider client={client}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    ) },
  );
}

describe('WaitOraclePanel', () => {
  it('defaults to the most-visited site with a live arrival', () => {
    renderPanel();
    expect(mockForecast).toHaveBeenCalledWith('Kettleman City', null);
  });

  it('renders the forecast with verdict, best hour, and evidence', () => {
    renderPanel();
    expect(screen.getByText('Supercharger Wait Oracle')).toBeInTheDocument();
    expect(screen.getByText('44.10 min expected wait')).toBeInTheDocument();
    expect(screen.getByText('packed')).toBeInTheDocument();
    expect(screen.getByText('Arrive 15:00 UTC instead to save ~44.10 min.')).toBeInTheDocument();
    expect(screen.getByText(/1740 sessions over 10.0 weeks/)).toBeInTheDocument();
  });

  it('reforecasts when the site changes', () => {
    renderPanel();
    fireEvent.change(screen.getByDisplayValue(/Kettleman City/), {
      target: { value: 'Barstow' },
    });
    expect(mockForecast).toHaveBeenLastCalledWith('Barstow', null);
  });

  it('passes an explicit arrival instant for offset presets', () => {
    renderPanel();
    fireEvent.click(screen.getByText('+2h'));
    const [, arriveAt] = mockForecast.mock.lastCall as [string, string | null];
    expect(arriveAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('shows a skeleton while sites load', () => {
    mockSites.mockReturnValue(idle({ data: undefined, isLoading: true }));
    mockForecast.mockReturnValue(idle());
    renderPanel();
    expect(screen.getByRole('status', { name: 'Loading sites…' })).toBeInTheDocument();
  });

  it('asks for data when no sites exist', () => {
    mockSites.mockReturnValue(idle({ data: [] }));
    mockForecast.mockReturnValue(idle());
    renderPanel();
    expect(screen.getByText(/No named sites yet/)).toBeInTheDocument();
    expect(mockForecast).toHaveBeenCalledWith(null, null);
  });

  it('surfaces forecast failures with a retry path', () => {
    const refetch = vi.fn();
    mockForecast.mockReturnValue(idle({ error: new Error('oracle down'), isError: true, refetch }));
    renderPanel();
    fireEvent.click(screen.getByText('Retry'));
    expect(refetch).toHaveBeenCalled();
  });

  it.each(['sites', 'forecast'] as const)('shows active %s loading without an empty or offline claim', (source) => {
    const query = idle({
      isLoading: true, isPending: true, isFetching: true, fetchStatus: 'fetching',
    });
    if (source === 'sites') {
      mockSites.mockReturnValue(query);
      mockForecast.mockReturnValue(idle());
    } else {
      mockForecast.mockReturnValue(query);
    }
    renderPanel();
    expect(screen.getByRole('status', {
      name: source === 'sites' ? 'Loading sites…' : 'Forecasting wait…',
    })).toBeInTheDocument();
    expect(screen.queryByText(/No named sites yet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
  });

  it.each(['sites', 'forecast'] as const)('explains paused %s without data and retries only that source', (source) => {
    const refetch = vi.fn();
    const query = idle({
      isPending: true, fetchStatus: 'paused', dataUpdatedAt: 0, refetch,
    });
    if (source === 'sites') {
      mockSites.mockReturnValue(query);
      mockForecast.mockReturnValue(idle());
    } else {
      mockForecast.mockReturnValue(query);
    }
    renderPanel();
    expect(screen.getByText('Refresh paused')).toBeInTheDocument();
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/No named sites yet/)).not.toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /Loading sites|Forecasting wait/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {
      name: `Retry unavailable sources: ${source === 'sites' ? 'Site' : 'Supercharger Wait Oracle'}`,
    }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders a successful zero-wait forecast with an empty curve as real data', () => {
    mockForecast.mockReturnValue(idle({
      data: { ...forecast, expected_wait_s: 0, wait_probability_pct: 0, save_s: 0, hours: [], evidence: [] },
      isSuccess: true,
    }));
    renderPanel();
    expect(screen.getByText('0.00 min expected wait')).toBeInTheDocument();
    expect(screen.getByText('0.00% chance of any wait · ~4 stalls')).toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
  });

  it.each(['sites', 'forecast'] as const)('retains %s payload and last success through refresh failure and recovery', (source) => {
    const refetch = vi.fn();
    const lastSuccess = Date.now() - 60_000;
    const data = source === 'sites' ? sites : forecast;
    const mock = source === 'sites' ? mockSites : mockForecast;
    const retained = idle({ data, dataUpdatedAt: lastSuccess, refetch });
    mock.mockReturnValue({ ...retained, error: new Error('refresh down'), isError: true });
    const { rerender } = renderPanel();
    const warning = screen.getByTestId('stale-refresh-warning');
    expect(warning).toHaveAttribute('role', 'status');
    expect(warning).toHaveAttribute('data-last-success-at', String(lastSuccess));
    expect(screen.getByText('44.10 min expected wait')).toBeInTheDocument();
    expect(screen.getByDisplayValue(/Kettleman City/)).toBeInTheDocument();
    expect(screen.queryByText('Retry')).not.toBeInTheDocument();
    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);

    mock.mockReturnValue({ ...retained, isFetching: true, fetchStatus: 'fetching' });
    rerender(<WaitOraclePanel />);
    expect(screen.getByText('44.10 min expected wait')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /Loading sites|Forecasting wait/ })).not.toBeInTheDocument();

    mock.mockReturnValue({ ...retained, dataUpdatedAt: lastSuccess + 60_000, isSuccess: true });
    rerender(<WaitOraclePanel />);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByText('44.10 min expected wait')).toBeInTheDocument();
  });

  it('keeps both retained paused sources visible with independent retries', () => {
    const sitesRefetch = vi.fn();
    const forecastRefetch = vi.fn();
    mockSites.mockReturnValue(idle({ data: sites, fetchStatus: 'paused', refetch: sitesRefetch }));
    mockForecast.mockReturnValue(idle({ data: forecast, fetchStatus: 'paused', refetch: forecastRefetch }));
    renderPanel();
    const warnings = screen.getAllByTestId('stale-refresh-warning');
    expect(warnings).toHaveLength(2);
    expect(screen.getByText('44.10 min expected wait')).toBeInTheDocument();
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
    for (const warning of warnings) expect(warning).toHaveAttribute('data-refresh-blocked', 'true');
    fireEvent.click(within(warnings[0]).getByRole('button', { name: 'Refresh' }));
    expect(sitesRefetch).toHaveBeenCalledTimes(1);
    expect(forecastRefetch).not.toHaveBeenCalled();
    fireEvent.click(within(warnings[1]).getByRole('button', { name: 'Refresh' }));
    expect(forecastRefetch).toHaveBeenCalledTimes(1);
  });

  it('retains an empty sites response during refresh failure instead of reclassifying it as an initial error', () => {
    mockSites.mockReturnValue(idle({ data: [], error: new Error('refresh down'), isError: true }));
    mockForecast.mockReturnValue(idle());
    renderPanel();
    expect(screen.getByText(/No named sites yet/)).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.queryByText('Retry')).not.toBeInTheDocument();
  });
});
