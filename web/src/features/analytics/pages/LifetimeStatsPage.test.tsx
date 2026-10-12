/**
 * LifetimeStatsPage — behaviour + hardening coverage.
 *
 * The page's existing feature adapters are exercised transitively through
 * its single default export.
 *
 * What is covered:
 *   1. READY  — hero, KPI band, fun facts, savings bar, environmental,
 *      personal records, activity summary, achievements gallery all
 *      render the deterministic SI→display values (km identity path).
 *   2. UNITS  — the mi/mph preference actually re-converts the SI values
 *      at the render boundary (proves lib/unitConversion wiring).
 *   3. LOADING — every panel shows a skeleton, no ready values leak.
 *   4. EMPTY  — each section shows its own EmptyState (never a blank
 *      panel) when the query resolves with no data.
 *   5. ERROR  — every panel surfaces QueryError and the Retry action is
 *      wired to the query's refetch (failure/interaction path).
 *   6. DEEP-LINK — `?achievement=<id>` scrolls the badge into view and
 *       applies the bounded static cue (user-journey + a11y).
 *
 * Network is never hit: the data hook is stubbed and the peripheral
 * vehicle picker / AI Q&A surfaces are isolated so the assertions focus
 * on this page's own rendering logic. i18n is stubbed so visible copy is
 * the English fallback with {{placeholder}} interpolation applied.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import english from '@/i18n/en.json';

import type { LifetimeStats, LifetimeAchievement } from '@/api/hooks/useAnalytics';

// ── Hoisted, per-test controllable state ─────────────────────────────
// `query` feeds the stubbed useLifetimeStats; `unit` feeds the stubbed
// useUnits so a single test can flip km→mi without touching global
// settings.
const h = vi.hoisted(() => ({
  query: undefined as unknown,
  unit: { distance: 'km', speed: 'km/h' } as { distance: string; speed: string },
  lifetimeHook: vi.fn(),
}));

const refetchMock = vi.fn();

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, arg2?: unknown, arg3?: unknown) => {
        let template = key;
        let options: Record<string, unknown> | undefined;
        if (typeof arg2 === 'string') {
          template = arg2;
          if (arg3 && typeof arg3 === 'object') options = arg3 as Record<string, unknown>;
        } else if (arg2 && typeof arg2 === 'object') {
          options = arg2 as Record<string, unknown>;
          if (typeof options.defaultValue === 'string') template = options.defaultValue;
        }
        if (options) {
          template = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) =>
            options && options[name] != null ? String(options[name]) : '',
          );
        }
        return template;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/api/hooks/useAnalytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useAnalytics')>();
  return { ...actual, useLifetimeStats: (vehicleId?: string) => {
    h.lifetimeHook(vehicleId);
    return h.query;
  } };
});

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: 7,
    vehicle: null,
    vehicles: [],
    setVehicleId: vi.fn(),
  }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: h.unit.distance,
      speed: h.unit.speed,
      temperature: '°C',
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
      precision: undefined,
    },
    formatDistance: (v: number | null | undefined) => String(v ?? 0),
    formatSpeed: (v: number | null | undefined) => String(v ?? 0),
    formatTemperature: (v: number | null | undefined) => String(v ?? 0),
    formatPressure: (v: number | null | undefined) => String(v ?? 0),
    formatEnergy: (v: number | null | undefined) => String(v ?? 0),
    formatDuration: (v: number | null | undefined) => String(v ?? 0),
    formatPower: (v: number | null | undefined) => String(v ?? 0),
  }),
}));

// The AI Q&A surface has its own suite and is gated by withAiFeature;
// stub it so this page's test stays deterministic and network-free.
vi.mock('@/components/ai/AILifetimeStatsQA', () => ({
  AILifetimeStatsQA: () => <div data-testid="ai-lifetime-qa" />,
}));

import LifetimeStatsPage from './LifetimeStatsPage';

it('offers keyboard-accessible lifetime aggregate help without source data', () => {
  h.query = makeQuery();
  renderPage();
  const help = screen.getByRole('button', { name: 'Lifetime stats' });
  help.focus();
  expect(help).toHaveFocus();
  expect(help).toHaveAccessibleDescription(english.lifetime.brief.description);
});

// jsdom lacks matchMedia (framer-motion's useReducedMotion) and
// scrollIntoView — polyfill/stub both so motion + deep-link paths run.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => {};
}

interface QueryStub {
  data: LifetimeStats | null | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

function makeQuery(overrides: Partial<QueryStub> = {}): QueryStub {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: refetchMock,
    ...overrides,
  };
}

function makeAchievements(): LifetimeAchievement[] {
  return [
    { id: 'ach-1', name: 'Road Warrior', description: 'Drive 10,000 km', icon: '🏆', unlocked: true, unlocked_at: '2024-01-01T00:00:00Z', progress: 1, target: 10000, current: 12345 },
    { id: 'ach-2', name: 'Night Owl', description: 'Drive at night', icon: '🦉', unlocked: true, unlocked_at: '2024-02-01T00:00:00Z', progress: 1, target: 10, current: 10 },
    { id: 'ach-3', name: 'Eco Hero', description: 'Save the planet', icon: '🌱', unlocked: false, unlocked_at: null, progress: 0.4, target: 1000, current: 400 },
  ];
}

function makeStats(overrides: Partial<LifetimeStats> = {}): LifetimeStats {
  return {
    total_drives: 1234,
    total_distance_km: 12345,
    total_driving_hours: 320.5,
    longest_drive_km: 456,
    highest_speed_kmh: 201,
    avg_efficiency_wh_km: 155,
    total_charge_sessions: 89,
    total_energy_kwh: 3456.7,
    total_charging_hours: 210.2,
    total_charging_cost: 543.21,
    gas_equivalent_cost: 1500,
    total_savings: 956.79,
    co2_offset_kg: 780,
    trees_equivalent: 137,
    earth_circumferences: 2.5,
    moon_trips: 0.032,
    days_on_road: 88.4,
    homes_equivalent_days: 12.3,
    first_drive_date: '2023-01-15T00:00:00Z',
    ownership_days: 900,
    most_active_day_of_week: 'Saturday',
    most_active_hour: 18,
    longest_drive_record: { value: 456.7, date: '2024-03-10T00:00:00Z' },
    highest_speed_record: { value: 201, date: '2024-05-20T00:00:00Z' },
    max_charge_record: { value: 75.5, date: '2024-06-01T00:00:00Z' },
    achievements: makeAchievements(),
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="route-location">{location.pathname}{location.search}{location.hash}</output>;
}

function renderPage(path = '/lifetime-stats') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <LifetimeStatsPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

let scrollSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  h.unit.distance = 'km';
  h.unit.speed = 'km/h';
  h.query = makeQuery({ data: makeStats() });
  scrollSpy = vi
    .spyOn(HTMLElement.prototype, 'scrollIntoView')
    .mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('LifetimeStatsPage', () => {
  it('renders the full dashboard with SI→km display values when data is ready', () => {
    renderPage();

    // Page shell.
    expect(screen.getByRole('heading', { name: /Lifetime stats/i })).toBeInTheDocument();

    // KPI band (km identity: 12345 km stays 12,345 km).
    expect(screen.getByText('1,234')).toBeInTheDocument(); // total drives
    expect(screen.getByText('12,345.00 km')).toBeInTheDocument(); // total distance
    expect(screen.getByText('3,456.70 kWh')).toBeInTheDocument(); // total energy kWh
    expect(screen.getByText('$543.21')).toBeInTheDocument(); // electric cost (savings bar)
    expect(screen.getByText('$1,500.00')).toBeInTheDocument(); // gas-equivalent cost

    // Personal records — distance/speed converted, charge shown raw kWh.
    expect(screen.getByText('456.70 km')).toBeInTheDocument();
    expect(screen.getByText('201.00 km/h')).toBeInTheDocument();
    expect(screen.getByText('75.50 kWh')).toBeInTheDocument();

    // Fun facts + activity summary.
    expect(screen.getByText('250.00%')).toBeInTheDocument(); // earth %
    expect(screen.getByText('3.20%')).toBeInTheDocument(); // moon %
    expect(screen.getByText('Saturday')).toBeInTheDocument();
    expect(screen.getByText('18:00')).toBeInTheDocument();
    expect(screen.getByText('155.00 Wh/km')).toBeInTheDocument();

    // Trees appear in both the fun-fact card and the environmental panel.
    expect(screen.getAllByText('137').length).toBeGreaterThanOrEqual(2);

    // Hero context chips (interpolated copy).
    expect(screen.getByText(/2\.50x around the Earth/)).toBeInTheDocument();
    const sinceChip = screen.getByText(/Tracking since/);
    expect(sinceChip.textContent).toMatch(/900 days/);

    // Achievements gallery — unlocked count + accessible badge labels.
    expect(screen.getByText(/2\/3\s+unlocked/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Road Warrior' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Eco Hero' })).toBeInTheDocument();

    // a11y landmarks + isolated AI slot.
    expect(screen.getByRole('region', { name: 'Key stats' })).toBeInTheDocument();
    expect(screen.getByTestId('ai-lifetime-qa')).toBeInTheDocument();
  });

  it('re-converts SI values to the user mi/mph preference at the render boundary', () => {
    h.unit.distance = 'mi';
    h.unit.speed = 'mph';
    h.query = makeQuery({
      data: makeStats({
        total_distance_km: 1609.344, // → 1,000 mi
        longest_drive_record: { value: 804.672, date: '2024-03-10T00:00:00Z' }, // → 500 mi
        highest_speed_record: { value: 160.9344, date: '2024-05-20T00:00:00Z' }, // → 100 mph
      }),
    });

    renderPage();

    expect(screen.getByText('1,000.00 mi')).toBeInTheDocument(); // total distance in miles
    expect(screen.getByText('500.00 mi')).toBeInTheDocument(); // longest drive record
    expect(screen.getByText('100.00 mph')).toBeInTheDocument(); // highest speed record
    // The km identity value must NOT appear once the preference is miles.
    expect(screen.queryByText('12,345.00 km')).not.toBeInTheDocument();
  });

  it('shows a skeleton in every panel while loading and leaks no ready values', () => {
    h.query = makeQuery({ isLoading: true, isFetching: true, dataUpdatedAt: 0 });

    const { container } = renderPage();

    // Header still present; no resolved KPI values.
    expect(screen.getByRole('heading', { name: /Lifetime stats/i })).toBeInTheDocument();
    expect(screen.queryByText('12,345.00 km')).not.toBeInTheDocument();
    expect(screen.queryByText('456.70 km')).not.toBeInTheDocument();
    // Skeletons render across the page.
    expect(container.querySelectorAll('[aria-hidden="true"][class*="bg-[var(--skeleton-bg)]"]').length).toBeGreaterThan(0);
  });

  it('renders a per-section EmptyState (never a blank panel) when the query resolves with no data', () => {
    h.query = makeQuery({ data: null });

    const { container } = renderPage();

    // Several sections share the generic "no data" copy.
    expect(screen.getAllByText(/No driving data yet/i).length).toBeGreaterThanOrEqual(3);
    // Achievements gallery has its own empty message.
    expect(screen.getByText(/Start driving to unlock achievements/i)).toBeInTheDocument();
    // An absent payload is not a measured zero-drive history.
    expect(screen.getByText(/driven across — drives/i)).toBeInTheDocument();
    expect(screen.queryByText(/driven across 0 drives/i)).not.toBeInTheDocument();
    expect(container.querySelectorAll('[aria-hidden="true"][class*="bg-[var(--skeleton-bg)]"]')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces QueryError in every panel and wires Retry to the query refetch', () => {
    h.query = makeQuery({ isError: true, error: new Error('boom'), dataUpdatedAt: 0 });

    renderPage();

    const errors = screen.getAllByText(/Can't reach server/i);
    expect(errors.length).toBeGreaterThan(0);

    const retryButtons = screen.getAllByRole('button', { name: /Retry/i });
    expect(retryButtons.length).toBeGreaterThan(0);

    fireEvent.click(retryButtons[0]);
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it('scrolls to and highlights the deep-linked achievement badge without decorative looping', async () => {
    h.query = makeQuery({ data: makeStats() });

    const { container } = renderPage('/lifetime-stats?achievement=ach-1');

    await waitFor(() => {
      expect(scrollSpy).toHaveBeenCalled();
      const wrapper = container.querySelector('[data-achievement-id="ach-1"]');
      expect(wrapper?.className).toContain('ring-[var(--semantic-info-border)]');
      expect(wrapper?.className).not.toContain('animate-pulse');
    });

    expect(scrollSpy).toHaveBeenCalledWith(
      expect.objectContaining({ block: 'center' }),
    );
  });

  it('removes only the achievement cue after three seconds and preserves workspace query identity and hash', async () => {
    vi.useFakeTimers();
    renderPage('/lifetime-stats?vehicle_id=7&achievement=ach-1&from=2024-01-01&tag=a&tag=b#records');

    await act(async () => { await vi.advanceTimersByTimeAsync(2999); });
    expect(screen.getByTestId('route-location')).toHaveTextContent('achievement=ach-1');
    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ block: 'center' }));

    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByTestId('route-location')).toHaveTextContent(
      '/lifetime-stats?vehicle_id=7&from=2024-01-01&tag=a&tag=b#records',
    );
    expect(h.lifetimeHook).toHaveBeenCalledWith('7');
  });

  it('keeps missing hero counts, achievement counts and individual records unknown without removing sections', () => {
    const stats = makeStats();
    for (const key of ['total_drives', 'total_distance_km', 'achievements'] as const) {
      Reflect.deleteProperty(stats, key);
    }
    Reflect.deleteProperty(stats.longest_drive_record, 'value');
    stats.highest_speed_record.value = Number.NaN;
    stats.max_charge_record.value = Number.POSITIVE_INFINITY;
    h.query = makeQuery({ data: stats });
    renderPage();

    expect(screen.getByText('driven across — drives')).toBeInTheDocument();
    expect(screen.getByText(/—\/—\s+unlocked/)).toBeInTheDocument();
    for (const title of ['Longest drive', 'Highest speed', 'Biggest charge']) {
      const record = screen.getByText(title).parentElement;
      expect(record).not.toBeNull();
      expect(within(record!).getByText('—')).toBeInTheDocument();
    }
    expect(screen.queryByText('0.00 km')).not.toBeInTheDocument();
    expect(screen.queryByText('0.00 km/h')).not.toBeInTheDocument();
    expect(screen.queryByText('0.00 kWh')).not.toBeInTheDocument();
    for (const title of ['Fun facts', 'Savings vs gasoline', 'Environmental impact', 'Personal records', 'Activity summary', 'Achievements']) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }
    expect(screen.getByTestId('ai-lifetime-qa')).toBeInTheDocument();
  });

  it('retains known savings values and marks missing comparison readings unknown instead of fabricating zero', () => {
    const stats = makeStats();
    Reflect.deleteProperty(stats, 'total_charging_cost');
    Reflect.deleteProperty(stats, 'co2_offset_kg');
    h.query = makeQuery({ data: stats });
    renderPage();

    const electric = screen.getByText('Electric cost').closest('div');
    const gas = screen.getByText('Gasoline equivalent').closest('div');
    expect(electric).not.toBeNull();
    expect(gas).not.toBeNull();
    expect(within(electric!).getByText('—')).toBeInTheDocument();
    expect(within(gas!).getByText('$1,500.00')).toBeInTheDocument();
    expect(screen.getAllByText('$956.79').length).toBeGreaterThan(0);
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
    expect(screen.queryByText(/0\.00 kg CO₂/)).not.toBeInTheDocument();
    expect(screen.getByText('456.70 km')).toBeInTheDocument();
  });

  it('preserves genuine zero hero, record and savings readings', () => {
    h.query = makeQuery({ data: makeStats({
      total_drives: 0, total_distance_km: 0, total_charging_cost: 0,
      total_savings: 0, co2_offset_kg: 0, achievements: [],
      longest_drive_record: { value: 0, date: '2024-03-10T00:00:00Z' },
      highest_speed_record: { value: 0, date: '2024-05-20T00:00:00Z' },
      max_charge_record: { value: 0, date: '2024-06-01T00:00:00Z' },
    }) });
    renderPage();

    expect(screen.getByText('driven across 0 drives')).toBeInTheDocument();
    expect(screen.getByText(/0\/0\s+unlocked/)).toBeInTheDocument();
    expect(screen.getByText('0.00 km/h')).toBeInTheDocument();
    expect(screen.getByText('0.00 kWh')).toBeInTheDocument();
    expect(screen.getAllByText('0.00 km').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$0.00').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/0\.00 kg CO₂ avoided/)).toBeInTheDocument();
  });

  it('retains all-time metrics and individual record values through a refresh failure with a working retry', () => {
    h.query = makeQuery({ data: makeStats(), isError: true, error: new Error('refresh failed') });
    renderPage();

    expect(screen.getByText('12,345.00 km')).toBeInTheDocument();
    expect(screen.getByText('456.70 km')).toBeInTheDocument();
    expect(screen.getByText('$543.21')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Road Warrior' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /Retry/i })[0]);
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });
});
