import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VampireDrainEvent, VampireDrainStats, VampireDrainWatch } from '@/types/energy';
import { STATUS_COLORS } from '@/lib/colors';
import VampireDrainWidget, {
  buildDrainBarData,
  getDrainStatus,
  drainColor,
} from './VampireDrainWidget';

vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: /prefers-reduced-motion/.test(query),
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

const mocks = vi.hoisted(() => ({
  vehicles: vi.fn(),
  stats: vi.fn(),
  events: vi.fn(),
  watch: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => mocks.vehicles() }));
vi.mock('@/api/hooks/useEnergy', () => ({
  useVampireDrainStats: (id: string | null) => mocks.stats(id),
  useVampireDrainEvents: (id: string | null) => mocks.events(id),
  useVampireDrainWatch: (id: string | null) => mocks.watch(id),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      const template = typeof fallback === 'string' ? fallback : key;
      const values = options?.replace && typeof options.replace === 'object'
        ? options.replace as Record<string, unknown>
        : options;
      return typeof values === 'object' && values != null
        ? template.replace(/{{(\w+)}}/g, (_match, name: string) => String(values[name] ?? ''))
        : template;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: { tz_display_default: 'utc', decimal_precision: 1, locale: 'en-US' },
    locale: 'en-US',
  }),
}));

function query(data?: unknown, extra: Record<string, unknown> = {}) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isPending: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: 1000,
    refetch: vi.fn(),
    ...extra,
  };
}

const stats: VampireDrainStats = {
  avg_drain_pct_per_day: 0.8,
  median_drain_pct_per_day: 0.7,
  p95_drain_pct_per_day: 1.4,
  total_observed_hours: 48,
  event_count: 12,
  sample_window_days: 90,
};

const event: VampireDrainEvent = {
  started_at: '2026-10-09T12:00:00Z',
  ended_at: '2026-10-10T06:00:00Z',
  duration_hours: 18,
  start_battery_pct: 80,
  end_battery_pct: 78,
  drain_pct: 2,
  drain_pct_per_day: 2.1,
  ambient_temp_c_avg: null,
};

const watch: VampireDrainWatch = {
  status: 'ok',
  threshold_pct_per_day: 3,
  avg_drain_pct_per_day: 0.8,
  events_evaluated: 12,
  breach_streak: 0,
  breaches_last_7_days: 0,
  worst_event: event,
  recommendation: 'Monitor',
};

function renderWidget(cols = 2) {
  return render(
    <MemoryRouter>
      <VampireDrainWidget size={{ cols, rows: 4 }} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.vehicles.mockReturnValue(query([{ id: 1 }]));
  mocks.stats.mockReturnValue(query(stats));
  mocks.events.mockReturnValue(query([event]));
  mocks.watch.mockReturnValue(query(watch));
});

afterEach(cleanup);

describe('VampireDrainWidget redesign contract', () => {
  it('renders one After-style headline and status dot for a measured normal rate', () => {
    renderWidget(2);
    expect(screen.getByRole('heading', { name: 'Vampire drain', level: 3 })).toBeVisible();
    expect(screen.getByText('0.8')).toBeVisible();
    expect(screen.getByText('%/day')).toBeVisible();
    expect(screen.getByText('Average while parked')).toBeVisible();
    const status = screen.getByLabelText('Normal');
    expect(status.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it('does not fabricate a headline when the aggregate population has no measured average', () => {
    mocks.stats.mockReturnValue(query({ ...stats, event_count: 0, avg_drain_pct_per_day: 0.8 }));
    mocks.events.mockReturnValue(query([]));
    mocks.watch.mockReturnValue(query(null));
    renderWidget(1);
    expect(screen.getByText('Average unavailable')).toBeVisible();
    expect(screen.queryByText('0.8')).not.toBeInTheDocument();
  });

  it('uses the shared empty explanation rather than a blank body', () => {
    mocks.stats.mockReturnValue(query(undefined));
    mocks.events.mockReturnValue(query([]));
    mocks.watch.mockReturnValue(query(null));
    renderWidget(2);
    expect(screen.getByText('No vampire drain data')).toBeVisible();
    expect(screen.getByText('Observed parked windows will appear when drain history is available.')).toBeVisible();
  });

  it('keeps compact mode to the headline and removes the chart and highest annotation', () => {
    renderWidget(1);
    expect(screen.queryByText(/Highest:/)).not.toBeInTheDocument();
    expect(document.querySelector('[class*="recharts"]')).toBeNull();
  });
});

describe('Vampire drain helpers', () => {
  it('maps unknown and threshold values without false alarms', () => {
    expect(getDrainStatus(null)).toBeNull();
    expect(getDrainStatus(Number.NaN)).toBeNull();
    expect(getDrainStatus(0.99)).toBe('normal');
    expect(getDrainStatus(1)).toBe('elevated');
    expect(getDrainStatus(3)).toBe('high');
  });

  it('uses valid status colors only for finite values', () => {
    expect(drainColor(0)).toBe(STATUS_COLORS.good);
    expect(drainColor(1.5)).toBe(STATUS_COLORS.warning);
    expect(drainColor(3)).toBe(STATUS_COLORS.critical);
    expect(drainColor(Number.NaN)).toBe('var(--text-muted)');
  });

  it('keeps numeric event bars without coalescing missing rates to zero', () => {
    expect(buildDrainBarData([
      { drain_pct_per_day: null },
      { drain_pct_per_day: 0.6 },
      { drain_pct_per_day: 2.1 },
    ])).toEqual([
      { index: '1', rate: 0.6 },
      { index: '2', rate: 2.1 },
    ]);
    expect(buildDrainBarData([])).toEqual([]);
  });
});
