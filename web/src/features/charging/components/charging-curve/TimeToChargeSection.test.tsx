/**
 * TimeToChargeSection — behaviour + hardening coverage.
 *
 * TimeToChargeSection default-exports a single presentational KPI block that
 * distils a list of charging sessions into four "time-to-charge" metrics
 * (10→80% avg minutes, 20→80% avg minutes, fastest + slowest kWh/h) plus a
 * per-year trend it hands to <YearlyTrendChart>. Its real work is derivation,
 * not pixels: it filters DC sessions, averages the SOC-window durations,
 * computes charge rates from SI watt-hours, and buckets everything by calendar
 * year.
 *
 * Strategy (mirrors the sibling SessionComparisonChart test): the presentation
 * shells are stubbed to lightweight prop-echoing markers so the component's
 * derivations are asserted directly and deterministically —
 *   - <MetricCard>       → a <div> echoing label / value / subtitle / colour and
 *                          rendering the passed icon (so aria-hidden is checked).
 *   - <YearlyTrendChart> → a <div> echoing the yearlyTrend array as JSON.
 *   - <SectionTitle>/<HelperText> → semantic wrappers echoing their text.
 * The pure `helpers` (isDcSession / durationMinutes / avg), `fmtNumber`, and
 * `convertEnergyFromSI` stay REAL so the numeric pipeline is exercised
 * end-to-end. i18n resolves to the English fallback (with {{id}} interpolation)
 * so visible copy is assertable. Nothing hits the network — the component is
 * pure and receives its sessions by prop.
 *
 * Covered facets:
 *   1. HEADER    — localized section title + descriptive helper text.
 *   2. CARDS     — exactly four KPI cards, correct labels/colours, aria-hidden
 *                  icons (never an unlabelled icon-only control).
 *   3. AVERAGES  — 10→80 / 20→80 means computed from completed DC sessions.
 *   4. EXTREMES  — fastest/slowest by kWh/h with their session-id subtitles.
 *   5. BUGFIX-1  — a live/incomplete (0-minute) session that already shows
 *                  end_soc≥80 is NOT folded into the averages as a zero.
 *   6. MIXED     — no charge spans the SOC windows ⇒ average cards show "—"
 *                  while fastest/slowest still resolve from the charge rate.
 *   7. EMPTY     — an empty session list ⇒ every KPI shows "—", no trend rows.
 *   8. NULL-SAFE — an undefined `sessions` prop degrades gracefully (BUGFIX-2)
 *                  instead of throwing on `sessions.length`.
 *   9. NON-DC    — home/AC-only sessions are excluded ⇒ every KPI shows "—".
 *  10. TREND     — per-year buckets, sorted ascending, zero-duration crossings
 *                  excluded from the yearly averages.
 *  11. BAD-DATE  — a session with an unparseable timestamp is skipped from the
 *                  trend (no phantom "" year bucket).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ChargingSession } from '@/api/types';

// English-fallback i18n with {{placeholder}} interpolation (repo convention).
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

// Typography shells → semantic prop-echo so header copy is queryable.
vi.mock('@/components/ui', () => ({
  SectionTitle: ({ children }: { children?: ReactNode }) => (
    <h2 data-testid="section-title">{children}</h2>
  ),
  HelperText: ({ children }: { children?: ReactNode }) => (
    <p data-testid="helper-text">{children}</p>
  ),
}));

// MetricCard → prop echo. Renders the icon so the aria-hidden contract on the
// decorative lucide glyph can be asserted.
vi.mock('@/components/data-display', () => ({
  MetricCard: ({
    label,
    value,
    subtitle,
    color,
    icon,
  }: {
    label: string;
    value: string | number;
    subtitle?: string;
    color?: string;
    icon?: ReactNode;
  }) => (
    <div
      data-testid="metric-card"
      data-label={label}
      data-value={String(value)}
      data-subtitle={subtitle ?? ''}
      data-color={color ?? ''}
    >
      {icon}
    </div>
  ),
}));

// YearlyTrendChart → echo the derived trend array (recharts renders nothing
// measurable under jsdom, so assert the data the section actually controls).
vi.mock('./YearlyTrendChart', () => ({
  default: ({ yearlyTrend }: { yearlyTrend?: unknown[] }) => (
    <div
      data-testid="yearly-trend"
      data-rows={String(Array.isArray(yearlyTrend) ? yearlyTrend.length : 0)}
      data-json={JSON.stringify(yearlyTrend ?? [])}
    />
  ),
}));

import TimeToChargeSection from './TimeToChargeSection';

// ── Fixtures ──────────────────────────────────────────────────────────────
function makeSession(overrides: Partial<ChargingSession> = {}): ChargingSession {
  const started_at = overrides.started_at ?? '2023-01-01T10:00:00Z';
  return {
    id: 1,
    vehicle_id: 7,
    started_at,
    ended_at: '2023-01-01T10:30:00Z',
    start_soc_pct: 10,
    end_soc_pct: 80,
    delta_soc_pct: 70,
    start_odometer_m: null,
    end_odometer_m: null,
    start_lat: null,
    start_lng: null,
    start_place: null,
    total_energy_added_wh: 45_000,
    peak_power_w: 150_000,
    avg_power_w: 120_000,
    cost_decimal: 10,
    cost_currency: 'USD',
    charger_type: 'Tesla',
    cable_type: null,
    live: false,
    startedAt: started_at,
    duration_min: 30,
    ...overrides,
  };
}

// Fast DC / Supercharger — 10→80% in 30 min, 45 kWh ⇒ rate 90 kWh/h.
const s1Fast = makeSession({
  id: 1,
  started_at: '2023-01-01T10:00:00Z',
  ended_at: '2023-01-01T10:30:00Z',
  start_soc_pct: 10,
  end_soc_pct: 80,
  total_energy_added_wh: 45_000,
  charger_type: 'Tesla',
});
// Slow DC (peak power ⇒ DC, no charger_type) — 20→80% in 60 min, 30 kWh ⇒ 30 kWh/h.
const s2Slow = makeSession({
  id: 2,
  started_at: '2024-06-01T10:00:00Z',
  ended_at: '2024-06-01T11:00:00Z',
  start_soc_pct: 20,
  end_soc_pct: 80,
  total_energy_added_wh: 30_000,
  charger_type: null,
  peak_power_w: 50_000,
});
// Live/incomplete DC — reports end_soc 85 but ended_at is still null ⇒ 0 minutes.
const s3Live = makeSession({
  id: 3,
  started_at: '2023-03-01T10:00:00Z',
  ended_at: null,
  start_soc_pct: 5,
  end_soc_pct: 85,
  total_energy_added_wh: 40_000,
  charger_type: 'Tesla',
});
// Home / AC — low peak power, no charger_type ⇒ NOT a DC session.
const s4Ac = makeSession({
  id: 4,
  started_at: '2024-02-01T09:00:00Z',
  ended_at: '2024-02-01T09:20:00Z',
  start_soc_pct: 10,
  end_soc_pct: 90,
  total_energy_added_wh: 12_000,
  charger_type: null,
  peak_power_w: 7_000,
});

const MAIN = [s1Fast, s2Slow, s3Live, s4Ac];

const L10 = '10% → 80%';
const L20 = '20% → 80%';
const L_FAST = 'Fastest Session';
const L_SLOW = 'Slowest Session';

// ── Query helpers ───────────────────────────────────────────────────────────
function cards(): HTMLElement[] {
  return screen.getAllByTestId('metric-card');
}
function cardByLabel(label: string): HTMLElement {
  const found = cards().find((c) => c.getAttribute('data-label') === label);
  if (!found) throw new Error(`no metric card labelled "${label}"`);
  return found;
}
interface TrendRow {
  year: string;
  avg10to80: number;
  avg20to80: number;
  count: number;
}
function yearlyRows(): TrendRow[] {
  const el = screen.getByTestId('yearly-trend');
  return JSON.parse(el.getAttribute('data-json') ?? '[]') as TrendRow[];
}

describe('TimeToChargeSection', () => {
  it('renders the localized section header and description', () => {
    render(<TimeToChargeSection sessions={MAIN} />);

    expect(screen.getByTestId('section-title')).toHaveTextContent('Time-to-Charge Analysis');
    expect(screen.getByTestId('helper-text')).toHaveTextContent(
      'How long DC sessions take to reach key SOC thresholds',
    );
  });

  it('renders exactly four KPI cards with correct labels, colours and aria-hidden icons', () => {
    render(<TimeToChargeSection sessions={MAIN} />);

    expect(cards()).toHaveLength(4);

    const labels = cards().map((c) => c.getAttribute('data-label'));
    expect(labels).toEqual([L10, L20, L_FAST, L_SLOW]);

    expect(cardByLabel(L10)).toHaveAttribute('data-color', 'cyan');
    expect(cardByLabel(L20)).toHaveAttribute('data-color', 'blue');
    expect(cardByLabel(L_FAST)).toHaveAttribute('data-color', 'green');
    expect(cardByLabel(L_SLOW)).toHaveAttribute('data-color', 'amber');

    // Every KPI icon is decorative — hidden from assistive tech, never an
    // unlabelled icon-only control.
    cards().forEach((c) => {
      const svg = c.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    });
  });

  it('computes the 10→80 and 20→80 average durations from completed DC sessions', () => {
    render(<TimeToChargeSection sessions={MAIN} />);

    // 10→80: only s1 (10→80, 30 min) qualifies ⇒ 30 min.
    expect(cardByLabel(L10)).toHaveAttribute('data-value', '30.00 min');
    // 20→80: s1 (30) + s2 (60) ⇒ avg 45 min.
    expect(cardByLabel(L20)).toHaveAttribute('data-value', '45.00 min');
    expect(cardByLabel(L10)).toHaveAttribute('data-subtitle', 'Avg duration');
    expect(cardByLabel(L20)).toHaveAttribute('data-subtitle', 'Avg duration');
  });

  it('identifies the fastest and slowest sessions by kWh/h with their session ids', () => {
    render(<TimeToChargeSection sessions={MAIN} />);

    expect(cardByLabel(L_FAST)).toHaveAttribute('data-value', '90.00 kWh/h');
    expect(cardByLabel(L_FAST)).toHaveAttribute('data-subtitle', 'Session #1');

    expect(cardByLabel(L_SLOW)).toHaveAttribute('data-value', '30.00 kWh/h');
    expect(cardByLabel(L_SLOW)).toHaveAttribute('data-subtitle', 'Session #2');
  });

  it('excludes incomplete (zero-duration) sessions from the SOC-window averages', () => {
    // s1 is a real 30-minute 10→80 charge; s3Live shows end_soc 85 but has no
    // ended_at (0 min). The average must stay 30 — not (30 + 0) / 2 = 15.
    render(<TimeToChargeSection sessions={[s1Fast, s3Live]} />);

    expect(cardByLabel(L10)).toHaveAttribute('data-value', '30.00 min');
    expect(cardByLabel(L20)).toHaveAttribute('data-value', '30.00 min');
    // The live session also never becomes the fastest — it has no charge rate.
    expect(cardByLabel(L_FAST)).toHaveAttribute('data-subtitle', 'Session #1');
  });

  it('shows — for the SOC-window averages but resolves fastest/slowest when no charge spans 10→80 / 20→80', () => {
    const midCharge = makeSession({
      id: 9,
      started_at: '2023-08-01T10:00:00Z',
      ended_at: '2023-08-01T10:30:00Z',
      start_soc_pct: 30,
      end_soc_pct: 70,
      total_energy_added_wh: 20_000,
      charger_type: 'Tesla',
    });
    render(<TimeToChargeSection sessions={[midCharge]} />);

    expect(cardByLabel(L10)).toHaveAttribute('data-value', '—');
    expect(cardByLabel(L20)).toHaveAttribute('data-value', '—');
    // 20 kWh over 30 min ⇒ 40 kWh/h, so both extreme cards resolve.
    expect(cardByLabel(L_FAST)).toHaveAttribute('data-value', '40.00 kWh/h');
    expect(cardByLabel(L_SLOW)).toHaveAttribute('data-value', '40.00 kWh/h');
  });

  it('renders placeholders for every KPI and no trend rows when the session list is empty', () => {
    render(<TimeToChargeSection sessions={[]} />);

    cards().forEach((c) => expect(c).toHaveAttribute('data-value', '—'));
    expect(screen.getByTestId('yearly-trend')).toHaveAttribute('data-rows', '0');
    // Empty subtitles too — no dangling "Session #undefined".
    expect(cardByLabel(L_FAST)).toHaveAttribute('data-subtitle', '');
  });

  it('is null-safe: degrades to placeholders instead of throwing when sessions is undefined', () => {
    expect(() =>
      render(
        <TimeToChargeSection sessions={undefined as unknown as ChargingSession[]} />,
      ),
    ).not.toThrow();

    cards().forEach((c) => expect(c).toHaveAttribute('data-value', '—'));
    expect(screen.getByTestId('yearly-trend')).toHaveAttribute('data-rows', '0');
  });

  it('excludes non-DC (home/AC) sessions from every metric', () => {
    render(<TimeToChargeSection sessions={[s4Ac]} />);

    cards().forEach((c) => expect(c).toHaveAttribute('data-value', '—'));
    expect(yearlyRows()).toHaveLength(0);
  });

  it('builds a per-year trend sorted ascending, excluding zero-duration crossings', () => {
    render(<TimeToChargeSection sessions={MAIN} />);

    expect(screen.getByTestId('yearly-trend')).toHaveAttribute('data-rows', '2');
    expect(yearlyRows()).toEqual([
      // 2023: s1 (30 min crosses both windows) + s3Live (0 min, excluded).
      { year: '2023', avg10to80: 30, avg20to80: 30, count: 2 },
      // 2024: s2 crosses only 20→80 (60 min); 10→80 has no sample ⇒ 0.
      { year: '2024', avg10to80: 0, avg20to80: 60, count: 1 },
    ]);
  });

  it('skips sessions with an unparseable timestamp from the yearly trend', () => {
    const valid = makeSession({
      id: 20,
      started_at: '2025-02-01T10:00:00Z',
      ended_at: '2025-02-01T10:30:00Z',
      start_soc_pct: 10,
      end_soc_pct: 80,
      charger_type: 'Tesla',
    });
    const undated = makeSession({
      id: 21,
      started_at: '',
      ended_at: null,
      charger_type: 'Tesla',
    });

    render(<TimeToChargeSection sessions={[valid, undated]} />);

    const rows = yearlyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].year).toBe('2025');
    rows.forEach((r) => expect(r.year).toMatch(/^\d{4}$/));
  });
});
