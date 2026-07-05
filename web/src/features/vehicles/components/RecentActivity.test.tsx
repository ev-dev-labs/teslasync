/**
 * RecentActivity — behavioural coverage for the vehicle "Recent Drives /
 * Recent Charges" twin-panel widget.
 *
 * The file exports a single presentational component (`RecentActivity`) that
 * takes two prop arrays (`drives`, `sessions`) and renders two GlassPanels,
 * each capped at five rows, with its own empty state. These tests drive it
 * entirely through its public prop surface and assert real, observable
 * behaviour:
 *
 *   • both panels always render their heading + "View all" deep-link, even when
 *     the corresponding array is empty or undefined (never a blank panel);
 *   • the SI display contract — distance is read from `distance_m` (metres) and
 *     converted with the user's `unitPrefs.distance`, energy from
 *     `total_energy_added_wh` (watt-hours) → kWh — and the converted value plus
 *     the correct unit suffix reach the DOM;
 *   • duration is formatted "Hh Mm" from `duration_s` (drives, seconds) and
 *     `duration_min` (charges, minutes), and the null/undefined-safe guard keeps
 *     a missing duration from rendering "NaN";
 *   • the charging row reads the CANONICAL `started_at` timestamp (not the
 *     optional legacy `start_ts` alias), so a session that only carries
 *     `started_at` still shows its time;
 *   • each row deep-links to its detail route (`/drives/:id`, `/charging/:id`),
 *     the list is capped at five, and the SOC transition only shows when both
 *     ends are present; and
 *   • decorative icons are `aria-hidden` and every row/link stays keyboard
 *     reachable via the anchor role.
 *
 * `react-i18next` is mocked to echo each `t(key, fallback)` fallback so
 * assertions read against the English copy. `AnimatedNumber` and `TimeStamp`
 * are mocked with deterministic renderers (the real `AnimatedNumber` animates
 * from 0 over rAF, which is non-deterministic in jsdom) so the exact converted
 * value / forwarded timestamp is observable in a single synchronous render.
 * `FadeIn` is flattened to sidestep framer-motion. The real
 * `@/lib/unitConversion` converters run untouched — the assertions exercise the
 * genuine metres→km / Wh→kWh math. A `<MemoryRouter>` wraps every render
 * because the rows use `<Link>`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { type ReactNode } from 'react';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: string) => fallback ?? key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

// The user's display preference. The component only reads `unitPrefs.distance`;
// pinning it to 'km' makes metres→km land on round numbers (5000 m → "5.0 km").
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: 'km' } }),
}));

// framer-motion adds no behaviour worth testing here — flatten it.
vi.mock('@/components/motion/FadeIn', () => ({
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Deterministic display-boundary stand-ins. The real AnimatedNumber tweens from
// 0 across requestAnimationFrame, so its final value is unreadable in a
// synchronous test; the stub renders the settled `value` immediately in a
// single text node so `getByText('5.0 km')` is reliable.
vi.mock('@/components/data-display/AnimatedNumber', () => ({
  AnimatedNumber: ({
    value,
    decimals = 0,
    prefix = '',
    suffix = '',
  }: {
    value: number;
    decimals?: number;
    prefix?: string;
    suffix?: string;
  }) => <span data-testid="metric">{`${prefix}${value.toFixed(decimals)}${suffix}`}</span>,
}));

// TimeStamp is mocked to echo the raw value it was handed. This is the probe
// that proves the charging row forwards `started_at`, not the legacy `start_ts`.
vi.mock('@/components/data-display', () => ({
  TimeStamp: ({ value }: { value: string | number | Date | null | undefined }) => (
    <span data-testid="timestamp">{value == null ? '—' : String(value)}</span>
  ),
}));

import { RecentActivity } from './RecentActivity';
import type { Drive, ChargingSession } from '@/api/types';

// ── Fixtures ────────────────────────────────────────────────────────────────
function makeDrive(overrides: Partial<Drive> = {}): Drive {
  return {
    id: 1,
    vehicle_id: 7,
    start_ts: '2026-03-01T12:00:00Z',
    end_ts: '2026-03-01T13:30:00Z',
    duration_s: 5400, // 1h 30m
    distance_m: 5000, // 5.0 km
    start_address: 'Alpha',
    end_address: 'Beta',
    start_lat: null,
    start_lon: null,
    end_lat: null,
    end_lon: null,
    start_soc_pct: 80,
    end_soc_pct: 60,
    energy_used_wh: 8000,
    regen_energy_wh: 500,
    avg_speed_mps: 20,
    max_speed_mps: 30,
    avg_power_w: 15000,
    outside_temp_avg_c: 20,
    inside_temp_avg_c: 21,
    score: 90,
    ended_status: 'completed',
    created_at: '2026-03-01T13:30:00Z',
    updated_at: '2026-03-01T13:30:00Z',
    ...overrides,
  };
}

function makeSession(overrides: Partial<ChargingSession> = {}): ChargingSession {
  return {
    id: 1,
    vehicle_id: 7,
    started_at: '2026-03-01T12:00:00Z',
    ended_at: '2026-03-01T13:00:00Z',
    start_soc_pct: 20,
    end_soc_pct: 80,
    delta_soc_pct: 60,
    start_odometer_m: null,
    end_odometer_m: null,
    start_lat: null,
    start_lng: null,
    start_place: 'Home',
    total_energy_added_wh: 53500, // 53.5 kWh
    peak_power_w: 11000,
    avg_power_w: 7000,
    cost_decimal: 4.5,
    cost_currency: 'USD',
    charger_type: 'Home',
    cable_type: 'Type2',
    startedAt: '2026-03-01T12:00:00Z',
    duration_min: 90, // 1h 30m
    ...overrides,
  };
}

function renderActivity(props: { drives?: Drive[]; sessions?: ChargingSession[] } = {}) {
  return render(
    <MemoryRouter>
      <RecentActivity drives={props.drives} sessions={props.sessions} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Recent Drives panel ───────────────────────────────────────────────────
describe('RecentActivity — Recent Drives panel', () => {
  it('renders the heading and a "View all" link to /drives', () => {
    const { container } = renderActivity({ drives: [makeDrive()], sessions: [] });
    expect(screen.getByRole('heading', { name: /Recent Drives/i })).toBeInTheDocument();
    const viewAll = container.querySelector('a[href="/drives"]');
    expect(viewAll).not.toBeNull();
    expect(viewAll).toHaveTextContent('View all');
  });

  it('converts distance from SI metres to the user unit and deep-links each row', () => {
    const { container } = renderActivity({
      drives: [makeDrive({ id: 42, distance_m: 5000 })],
      sessions: [],
    });
    // 5000 m ÷ 1000 = 5.0 km, with the user's distance-unit suffix.
    expect(screen.getByText('5.0 km')).toBeInTheDocument();
    expect(container.querySelector('a[href="/drives/42"]')).not.toBeNull();
  });

  it('formats the drive duration as "Hh Mm" from duration_s (seconds)', () => {
    renderActivity({ drives: [makeDrive({ duration_s: 5400 })], sessions: [] });
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
  });

  it('shows the SOC transition only when both ends are present', () => {
    renderActivity({
      drives: [
        makeDrive({ id: 1, start_soc_pct: 80, end_soc_pct: 60 }),
        makeDrive({ id: 2, start_soc_pct: 55, end_soc_pct: null }),
      ],
      sessions: [],
    });
    expect(screen.getByText('80% → 60%')).toBeInTheDocument();
    // The second drive has a null end SOC — no transition rendered for it.
    expect(screen.queryByText(/55%\s*→/)).not.toBeInTheDocument();
  });

  it('forwards the drive start_ts to the timestamp renderer', () => {
    renderActivity({
      drives: [makeDrive({ start_ts: '2026-04-04T04:04:00Z' })],
      sessions: [],
    });
    expect(screen.getByTestId('timestamp')).toHaveTextContent('2026-04-04T04:04:00Z');
  });

  it('caps the list at five drives', () => {
    const drives = Array.from({ length: 6 }, (_, i) =>
      makeDrive({ id: i + 1, distance_m: (i + 1) * 1000 }),
    );
    renderActivity({ drives, sessions: [] });
    expect(screen.getByText('5.0 km')).toBeInTheDocument(); // 5th row present
    expect(screen.queryByText('6.0 km')).not.toBeInTheDocument(); // 6th sliced off
  });
});

// ── Recent Charges panel ──────────────────────────────────────────────────
describe('RecentActivity — Recent Charges panel', () => {
  it('renders the heading and a "View all" link to /charging', () => {
    const { container } = renderActivity({ drives: [], sessions: [makeSession()] });
    expect(screen.getByRole('heading', { name: /Recent Charges/i })).toBeInTheDocument();
    const viewAll = container.querySelector('a[href="/charging"]');
    expect(viewAll).not.toBeNull();
    expect(viewAll).toHaveTextContent('View all');
  });

  it('converts energy from watt-hours to kWh and deep-links each row', () => {
    const { container } = renderActivity({
      drives: [],
      sessions: [makeSession({ id: 9, total_energy_added_wh: 53500 })],
    });
    // 53500 Wh ÷ 1000 = 53.5 kWh.
    expect(screen.getByText('53.5 kWh')).toBeInTheDocument();
    expect(container.querySelector('a[href="/charging/9"]')).not.toBeNull();
  });

  it('formats the charge duration as "Hh Mm" from duration_min (minutes)', () => {
    renderActivity({ drives: [], sessions: [makeSession({ duration_min: 90 })] });
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
  });

  it('reads the canonical started_at timestamp, ignoring the legacy start_ts alias', () => {
    // Real API rows carry `started_at`; `start_ts` is an optional legacy alias.
    // The canonical field must win — this is the regression this test locks in.
    renderActivity({
      drives: [],
      sessions: [
        makeSession({ started_at: '2026-05-05T05:05:00Z', start_ts: '1999-01-01T00:00:00Z' }),
      ],
    });
    const stamps = screen.getAllByTestId('timestamp');
    expect(stamps).toHaveLength(1);
    expect(stamps[0]).toHaveTextContent('2026-05-05T05:05:00Z');
    expect(screen.queryByText('1999-01-01T00:00:00Z')).not.toBeInTheDocument();
  });

  it('caps the list at five charging sessions', () => {
    const sessions = Array.from({ length: 6 }, (_, i) =>
      makeSession({ id: i + 1, total_energy_added_wh: (i + 1) * 1000 }),
    );
    renderActivity({ drives: [], sessions });
    expect(screen.getByText('5.0 kWh')).toBeInTheDocument(); // 5th present
    expect(screen.queryByText('6.0 kWh')).not.toBeInTheDocument(); // 6th sliced off
  });
});

// ── Empty & undefined states ────────────────────────────────────────────────
describe('RecentActivity — empty & undefined states', () => {
  it('shows both empty-state messages when both arrays are empty', () => {
    renderActivity({ drives: [], sessions: [] });
    expect(screen.getByText('No drives recorded yet')).toBeInTheDocument();
    expect(screen.getByText('No charging sessions recorded yet')).toBeInTheDocument();
    // No rows rendered — no metric spans at all.
    expect(screen.queryAllByTestId('metric')).toHaveLength(0);
  });

  it('degrades undefined props to the empty states without crashing', () => {
    expect(() => renderActivity({})).not.toThrow();
    // Both panels still render their headings — never a blank shell.
    expect(screen.getByRole('heading', { name: /Recent Drives/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Recent Charges/i })).toBeInTheDocument();
    expect(screen.getByText('No drives recorded yet')).toBeInTheDocument();
    expect(screen.getByText('No charging sessions recorded yet')).toBeInTheDocument();
  });
});

// ── Null-safety & edge cases (the bugs these tests surface) ──────────────────
describe('RecentActivity — null-safety', () => {
  it('renders "0h 0m" (never NaN) for a drive with a missing duration', () => {
    renderActivity({
      drives: [makeDrive({ duration_s: undefined as unknown as number })],
      sessions: [],
    });
    expect(screen.getByText('0h 0m')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('renders "0h 0m" (never NaN) for a charge with a missing duration', () => {
    renderActivity({
      drives: [],
      sessions: [makeSession({ duration_min: undefined as unknown as number })],
    });
    expect(screen.getByText('0h 0m')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('treats a missing distance / energy as zero at the display boundary', () => {
    renderActivity({
      drives: [makeDrive({ distance_m: undefined as unknown as number })],
      sessions: [makeSession({ total_energy_added_wh: undefined as unknown as number })],
    });
    expect(screen.getByText('0.0 km')).toBeInTheDocument();
    expect(screen.getByText('0.0 kWh')).toBeInTheDocument();
  });
});

// ── Accessibility ───────────────────────────────────────────────────────────
describe('RecentActivity — accessibility', () => {
  it('marks decorative icons as aria-hidden', () => {
    const { container } = renderActivity({
      drives: [makeDrive()],
      sessions: [makeSession()],
    });
    // Every lucide icon in this widget is decorative and must be hidden from AT.
    const icons = container.querySelectorAll('svg');
    expect(icons.length).toBeGreaterThan(0);
    icons.forEach((icon) => expect(icon).toHaveAttribute('aria-hidden', 'true'));
  });

  it('exposes each drive/charge row as a keyboard-reachable link', () => {
    renderActivity({
      drives: [makeDrive({ id: 3 })],
      sessions: [makeSession({ id: 4 })],
    });
    const driveLink = screen.getByRole('link', { name: (_, el) => el.getAttribute('href') === '/drives/3' });
    const chargeLink = screen.getByRole('link', { name: (_, el) => el.getAttribute('href') === '/charging/4' });
    // Anchor rows are natively focusable — assert the resolved targets.
    expect(within(driveLink).getByTestId('timestamp')).toBeInTheDocument();
    expect(within(chargeLink).getByTestId('timestamp')).toBeInTheDocument();
  });
});
