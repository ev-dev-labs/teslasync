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
import userEvent from '@testing-library/user-event';
import { createElement, type ComponentProps, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import english from '@/i18n/en.json';

const translations = vi.hoisted(() => new Map<string, string>());

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
    if (translations.has(key)) {
      return interpolate(translations.get(key)!, (typeof second === 'string' ? third : second) as Record<string, unknown> | undefined);
    }
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

// The real chart disables annotation reads when no annotation scope is supplied.
vi.unmock('@/api/hooks/useAnnotations');

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  return {
    ...actual,
    BarChart: vi.fn((props: ComponentProps<typeof actual.BarChart>) => createElement(actual.BarChart, props)),
  };
});

import { BarChart } from '@/components/charts';
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
  translations.clear();
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

function expectChartShell() {
  expect(screen.getByText('Wait across the arrival day (UTC)')).toBeInTheDocument();
  expect(screen.getByRole('figure', {
    name: 'Wait across the arrival day (UTC)',
  })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Arrival' })).toBeInTheDocument();
  expect(screen.getByLabelText('Custom arrival')).toBeEnabled();
}

describe('WaitOraclePanel', () => {
  it.each([
    ['quiet', 'Quiet'],
    ['steady', 'Steady'],
    ['busy', 'Busy'],
    ['packed', 'Packed'],
  ] as const)('localizes known verdict %s without changing the payload or chart thresholds', (verdict, label) => {
    const payload = { ...forecast, verdict };
    translations.set(`wait_oracle.verdict.${verdict}`, `Translated ${label}`);
    mockForecast.mockReturnValue(idle({ data: payload }));
    renderPanel();
    expect(english.wait_oracle.verdict[verdict]).toBe(label);
    expect(screen.getByText(`Translated ${label}`)).toBeInTheDocument();
    expect(screen.queryByText(verdict)).not.toBeInTheDocument();
    expect(payload.verdict).toBe(verdict);
    expect(vi.mocked(BarChart).mock.lastCall?.[0].data).toEqual([
      { hour: 15, label: '15:00', wait: 0, busyness: 14.3 },
      { hour: 18, label: '18:00', wait: 44.1, busyness: 100 },
    ]);
  });

  it.each([
    ['high', 'High'],
    ['medium', 'Medium'],
    ['low', 'Low'],
  ] as const)('localizes known confidence %s inside the confidence copy', (confidence, label) => {
    const payload = { ...forecast, confidence };
    translations.set(`wait_oracle.confidenceLevels.${confidence}`, `Translated ${label}`);
    translations.set('wait_oracle.confidence', 'Confidence: {{level}}');
    mockForecast.mockReturnValue(idle({ data: payload }));
    renderPanel();
    expect(english.wait_oracle.confidenceLevels[confidence]).toBe(label);
    expect(screen.getByText(`Confidence: Translated ${label}`)).toBeInTheDocument();
    expect(payload.confidence).toBe(confidence);
  });

  it('preserves unrecognized enum values verbatim instead of inventing translation keys', () => {
    const payload = { ...forecast, verdict: 'future_verdict', confidence: 'future_confidence' };
    translations.set('wait_oracle.verdict.future_verdict', 'Should not be used');
    translations.set('wait_oracle.confidenceLevels.future_confidence', 'Should not be used');
    mockForecast.mockReturnValue(idle({ data: payload }));
    renderPanel();
    expect(screen.getByText('future_verdict')).toBeInTheDocument();
    expect(screen.getByText('future_confidence confidence')).toBeInTheDocument();
    expect(screen.queryByText(/Should not be used/)).not.toBeInTheDocument();
    expect(payload.verdict).toBe('future_verdict');
    expect(payload.confidence).toBe('future_confidence');
  });

  it('keeps mobile targets local and explicitly restores desktop control sizing', () => {
    renderPanel();
    const group = screen.getByRole('group', { name: 'Arrival' });
    expect(group).toHaveClass('min-w-0', 'flex-wrap');
    for (const button of within(group).getAllByRole('button')) {
      expect(button).toHaveClass('min-h-11', 'min-w-11', 'md:min-h-9', 'md:min-w-0');
      expect(button).toHaveClass('focus-visible:outline-2', 'focus-visible:outline-offset-2');
    }
    expect(screen.getByLabelText('Custom arrival')).toHaveClass('min-h-11', 'md:min-h-10');
    expect(screen.getByLabelText('Site')).toHaveClass('min-h-11', 'md:min-h-10');
  });

  it('preserves keyboard focus, preset selection and custom arrival reset', async () => {
    const user = userEvent.setup();
    renderPanel();
    const now = screen.getByRole('button', { name: 'Now' });
    const oneHour = screen.getByRole('button', { name: '+1h' });
    const twoHours = screen.getByRole('button', { name: '+2h' });
    expect(now).toHaveAttribute('aria-pressed', 'true');
    await user.tab();
    expect(screen.getByLabelText('Site')).toHaveFocus();
    await user.tab();
    expect(now).toHaveFocus();
    await user.tab();
    expect(oneHour).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(oneHour).toHaveFocus();
    expect(oneHour).toHaveAttribute('aria-pressed', 'true');
    expect(now).toHaveAttribute('aria-pressed', 'false');
    expect(mockForecast.mock.lastCall?.[1]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    await user.tab();
    expect(twoHours).toHaveFocus();
    await user.keyboard(' ');
    expect(twoHours).toHaveAttribute('aria-pressed', 'true');
    await user.tab();
    await user.tab();
    const custom = screen.getByLabelText('Custom arrival');
    expect(custom).toHaveFocus();
    fireEvent.change(custom, { target: { value: '2026-10-15T12:30' } });
    expect(mockForecast).toHaveBeenLastCalledWith('Kettleman City', new Date('2026-10-15T12:30').toISOString());
    for (const button of within(screen.getByRole('group', { name: 'Arrival' })).getAllByRole('button')) {
      expect(button).toHaveAttribute('aria-pressed', 'false');
    }
    now.focus();
    await user.keyboard('{Enter}');
    expect(now).toHaveFocus();
    expect(now).toHaveAttribute('aria-pressed', 'true');
    expect(custom).toHaveValue('');
    expect(mockForecast).toHaveBeenLastCalledWith('Kettleman City', null);
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['NaN', NaN],
    ['positive infinity', Infinity],
    ['negative infinity', -Infinity],
    ['numeric string', '60'],
    ['empty string', ''],
    ['boolean', false],
  ])('keeps %s wait unknown in the summary, chart and table', (_label, seconds) => {
    mockForecast.mockReturnValue(idle({
      data: {
        ...forecast,
        expected_wait_s: seconds,
        save_s: seconds,
        hours: [
          { hour: 15, expected_wait_s: seconds, busyness: 14.3 },
          { hour: 18, expected_wait_s: 0, busyness: 100 },
        ],
      },
    }));
    renderPanel();
    expect(screen.getAllByText('Unknown')).toHaveLength(2);
    expect(screen.queryByText(/min expected wait/)).not.toBeInTheDocument();
    expect(screen.queryByText(/instead to save/)).not.toBeInTheDocument();
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(within(rows[1]).getByRole('cell', { name: 'Unknown' })).toBeInTheDocument();
    expect(within(rows[2]).getByRole('cell', { name: '0.00' })).toBeInTheDocument();
    expect(vi.mocked(BarChart).mock.lastCall?.[0].data).toEqual([
      { hour: 15, label: '15:00', wait: null, busyness: 14.3 },
      { hour: 18, label: '18:00', wait: 0, busyness: 100 },
    ]);
  });

  it.each([
    [0, 0, '0.00'],
    [120, 2, '2.00'],
    [-120, -2, '-2.00'],
    [90.6, 1.51, '1.51'],
    [-90.6, -1.51, '-1.51'],
  ])('converts valid %s SI seconds only for display', (seconds, minutes, formatted) => {
    const payload = {
      ...forecast,
      expected_wait_s: seconds,
      save_s: seconds,
      hours: [{ hour: 15, expected_wait_s: seconds, busyness: 14.3 }],
    };
    mockForecast.mockReturnValue(idle({ data: payload }));
    renderPanel();
    expect(screen.getByText(`${formatted} min expected wait`)).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByRole('cell', { name: formatted })).toBeInTheDocument();
    expect(vi.mocked(BarChart).mock.lastCall?.[0].data?.[0].wait).toBeCloseTo(minutes);
    expect(payload.expected_wait_s).toBe(seconds);
    expect(payload.hours[0].expected_wait_s).toBe(seconds);
    if (seconds >= 60) {
      expect(screen.getByText(`Arrive 15:00 UTC instead to save ~${formatted} min.`)).toBeInTheDocument();
    } else {
      expect(screen.queryByText(/instead to save/)).not.toBeInTheDocument();
    }
  });

  it('defaults to the most-visited site with a live arrival', () => {
    renderPanel();
    expect(mockForecast).toHaveBeenCalledWith('Kettleman City', null);
  });

  it('renders the forecast with verdict, best hour, and evidence', () => {
    renderPanel();
    expect(screen.getByText('Supercharger Wait Oracle')).toBeInTheDocument();
    expect(screen.getByText('44.10 min expected wait')).toBeInTheDocument();
    expect(screen.getByText('Packed')).toBeInTheDocument();
    expect(screen.getByText('High confidence')).toBeInTheDocument();
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
    expectChartShell();
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
    expect(screen.getAllByText('Refresh paused').length).toBeGreaterThan(0);
    expectChartShell();
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
    expectChartShell();
    expect(screen.getByText('No data available')).toBeInTheDocument();
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
    expectChartShell();
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

  it.each(['sites', 'forecast'] as const)('keeps unresolved %s unknown rather than claiming empty or zero', (source) => {
    if (source === 'sites') mockSites.mockReturnValue(idle({ isPending: true }));
    mockForecast.mockReturnValue(idle({ isPending: true }));
    renderPanel();
    expectChartShell();
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
    expect(screen.queryByText(/No named sites yet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/min expected wait/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+1h' }));
    expect(mockForecast.mock.lastCall?.[1]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('keeps the chart shell and arrival controls for authoritative empty sites', () => {
    mockSites.mockReturnValue(idle({ data: [], isSuccess: true }));
    mockForecast.mockReturnValue(idle());
    renderPanel();
    expectChartShell();
    expect(screen.getByText(/No named sites yet/)).toBeInTheDocument();
    expect(screen.getByLabelText('Site')).toBeDisabled();
    expect(screen.queryByText(/min expected wait/)).not.toBeInTheDocument();
  });

  it('keeps controls usable through a failed forecast and recovers the same shell', () => {
    mockForecast.mockReturnValue(idle({ error: new Error('oracle down'), isError: true }));
    const { rerender } = renderPanel();
    expectChartShell();
    expect(screen.getByText('Service unavailable')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue(/Kettleman City/), { target: { value: 'Barstow' } });
    fireEvent.change(screen.getByLabelText('Custom arrival'), { target: { value: '2026-10-15T12:30' } });
    expect(mockForecast).toHaveBeenLastCalledWith('Barstow', new Date('2026-10-15T12:30').toISOString());

    mockForecast.mockReturnValue(idle({ data: { ...forecast, site: 'Barstow' }, isSuccess: true }));
    rerender(<WaitOraclePanel />);
    expectChartShell();
    expect(screen.getByText('44.10 min expected wait')).toBeInTheDocument();
    expect(screen.queryByText('Service unavailable')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue(/Barstow/)).toBeInTheDocument();
    expect(screen.getByLabelText('Custom arrival')).toHaveValue('2026-10-15T12:30');
  });
});
