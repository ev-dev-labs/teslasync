/**
 * WaitOraclePanel — behaviour coverage.
 *
 * Data hooks (`useWaitOracleSites` / `useWaitOracleForecast`) are mocked
 * and driven per test; shared UI (GlassPanel, Select, ChartContainer,
 * Badge, QueryError, EmptyState) is REAL so the render-boundary wiring
 * is genuinely exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

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
  expected_wait_min: 44.1,
  wait_probability_pct: 73.8,
  busyness: 100,
  verdict: 'packed',
  confidence: 'high',
  stalls_estimated: 4,
  best_hour_utc: 15,
  best_wait_min: 0,
  save_min: 44.1,
  hours: [
    { hour: 15, expected_wait_min: 0, busyness: 14.3 },
    { hour: 18, expected_wait_min: 44.1, busyness: 100 },
  ],
  evidence: ['1740 sessions over 10.0 weeks', 'median session 30 min'],
};

function idle(extra = {}) {
  return {
    data: undefined, isLoading: false, isFetching: false, error: null,
    refetch: vi.fn(), ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSites.mockReturnValue(idle({ data: sites }));
  mockForecast.mockReturnValue(idle({ data: forecast }));
});

describe('WaitOraclePanel', () => {
  it('defaults to the most-visited site with a live arrival', () => {
    render(<WaitOraclePanel />);
    expect(mockForecast).toHaveBeenCalledWith('Kettleman City', null);
  });

  it('renders the forecast with verdict, best hour, and evidence', () => {
    render(<WaitOraclePanel />);
    expect(screen.getByText('Supercharger Wait Oracle')).toBeInTheDocument();
    expect(screen.getByText('44 min expected wait')).toBeInTheDocument();
    expect(screen.getByText('packed')).toBeInTheDocument();
    expect(screen.getByText('Arrive 15:00 UTC instead to save ~44 min.')).toBeInTheDocument();
    expect(screen.getByText(/1740 sessions over 10.0 weeks/)).toBeInTheDocument();
  });

  it('reforecasts when the site changes', () => {
    render(<WaitOraclePanel />);
    fireEvent.change(screen.getByDisplayValue(/Kettleman City/), {
      target: { value: 'Barstow' },
    });
    expect(mockForecast).toHaveBeenLastCalledWith('Barstow', null);
  });

  it('passes an explicit arrival instant for offset presets', () => {
    render(<WaitOraclePanel />);
    fireEvent.click(screen.getByText('+2h'));
    const [, arriveAt] = mockForecast.mock.lastCall as [string, string | null];
    expect(arriveAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('shows a skeleton while sites load', () => {
    mockSites.mockReturnValue(idle({ data: undefined, isLoading: true }));
    mockForecast.mockReturnValue(idle());
    render(<WaitOraclePanel />);
    expect(screen.getByText('Loading sites…')).toBeInTheDocument();
  });

  it('asks for data when no sites exist', () => {
    mockSites.mockReturnValue(idle({ data: [] }));
    mockForecast.mockReturnValue(idle());
    render(<WaitOraclePanel />);
    expect(screen.getByText(/No named sites yet/)).toBeInTheDocument();
    expect(mockForecast).toHaveBeenCalledWith(null, null);
  });

  it('surfaces forecast failures with a retry path', () => {
    const refetch = vi.fn();
    mockForecast.mockReturnValue(idle({ error: new Error('oracle down'), refetch }));
    render(<WaitOraclePanel />);
    fireEvent.click(screen.getByText('Retry'));
    expect(refetch).toHaveBeenCalled();
  });
});
