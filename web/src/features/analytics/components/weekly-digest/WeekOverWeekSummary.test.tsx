/**
 * WeekOverWeekSummary — behaviour + hardening contract.
 *
 * WeekOverWeekSummary is the full-width "Week-over-Week Comparison" band at the
 * foot of the Weekly Digest. It fans a pre-aggregated `DigestMetrics` object
 * into six `StatCard`s (Distance, Drives, Energy, Cost, Efficiency, CO₂) with a
 * per-card `loading` skeleton, a section-level `QueryError` branch, and a signed
 * week-over-week `trend` badge on each card. It is pure presentation — the
 * parent hook owns the fetch — so these tests build the metrics fixture directly.
 *
 * What the tests pin:
 *   - every card renders its i18n label, its `fmtNumber`/`fmtInt`/`formatCurrency`
 *     value, and its unit suffix;
 *   - the `trendFor` wiring is correct, including the three inverted-positivity
 *     cards (Energy / Cost / Efficiency, where "up" is bad): distance-up reads
 *     green ↑, energy-up reads red ↑, falling efficiency reads green ↓;
 *   - the `pctChange` divide-by-zero guard surfaces "+100.0%" (never Infinity)
 *     when the prior-week baseline is 0, and an unchanged metric reads a flat 0%;
 *   - null-safety: undefined metric fields degrade to 0-forms ("0.0" / "0" /
 *     "$0.00") and flat trends rather than NaN or a crash;
 *   - the loading branch shows skeletons and hides values while keeping the
 *     section title, and the error branch shows a retryable QueryError and hides
 *     the stat grid;
 *   - a11y: the `<section>` is exposed as a labelled region and the six leading
 *     stat icons are decorative (`aria-hidden`).
 *
 * SI values are converted through `useUnits()` at the render boundary.
 *
 * Conventions (mirror ChargingSection.test.tsx in this folder):
 *   - `react-i18next` is stubbed to echo the inline English fallback;
 *   - the real feedback/ui components render inside a `MemoryRouter`
 *     (QueryError calls `useNavigate`), and interactions use `fireEvent`
 *     (`@testing-library/user-event` is not installed in this repo);
 *   - `useSettings` comes from the global stub in src/test-setup.ts (currency
 *     `$`, precision 2, locale en-US) so `useFormatting` runs deterministically.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import { WeekOverWeekSummary } from './WeekOverWeekSummary';
import type { DigestMetrics } from './types';

/* ── react-i18next: deterministic English-fallback rendering ─────────────── */
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

/* ── Fixtures ─────────────────────────────────────────────────────────────── */
function baseMetrics(overrides: Partial<DigestMetrics> = {}): DigestMetrics {
  return {
    totalDistanceM: 0,
    prevDistanceM: 0,
    totalDrives: 0,
    prevDriveCount: 0,
    energyUsedWh: 0,
    prevEnergyWh: 0,
    chargingCost: 0,
    prevChargingCost: 0,
    co2Saved: 0,
    prevCo2: 0,
    avgEfficiencyWhPerM: 0,
    prevAvgEfficiencyWhPerM: 0,
    totalDurationS: 0,
    topDrive: undefined,
    chargeEnergyAddedWh: 0,
    prevChargeEnergyWh: 0,
    avgChargePowerW: 0,
    chargingSessionCount: 0,
    batteryStart: 0,
    batteryEnd: 0,
    alertsByType: {},
    alertTotal: 0,
    ...overrides,
  };
}

// A populated week whose six trend percentages are all distinct, so each card's
// trend badge can be selected unambiguously by its signed-percentage text.
const POPULATED: Partial<DigestMetrics> = {
  totalDistanceM: 130_000,
  prevDistanceM: 100_000, // +30.0% — up, not inverted → green ↑
  totalDrives: 10,
  prevDriveCount: 8, // +25.0% — up → green ↑
  energyUsedWh: 55_000,
  prevEnergyWh: 40_000, // +37.5% — up, inverted → red ↑
  chargingCost: 12,
  prevChargingCost: 10, // +20.0% — up, inverted → red ↑
  avgEfficiencyWhPerM: 0.14,
  prevAvgEfficiencyWhPerM: 0.16, // -12.5% — down, inverted → green ↓
  co2Saved: 8,
  prevCo2: 5, // +60.0% — up → green ↑
};

interface RenderOverrides {
  metrics?: Partial<DigestMetrics>;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

function renderSummary(over: RenderOverrides = {}) {
  return render(
    <MemoryRouter>
      <WeekOverWeekSummary
        metrics={baseMetrics(over.metrics)}
        isLoading={over.isLoading}
        isError={over.isError}
        error={over.error}
        onRetry={over.onRetry}
      />
    </MemoryRouter>,
  );
}

/** The trend badge div is the parent of the signed-percentage `<span>`. */
function trendOf(pctText: string): HTMLElement {
  const el = screen.getByText(pctText).parentElement;
  if (!el) throw new Error(`no trend row for ${pctText}`);
  return el;
}

/* ── Populated rendering ──────────────────────────────────────────────────── */
describe('WeekOverWeekSummary — populated rendering', () => {
  it('renders the section title and every stat label', () => {
    renderSummary({ metrics: POPULATED });

    expect(screen.getByText('Week-over-Week Comparison')).toBeInTheDocument();
    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(screen.getByText('Drives')).toBeInTheDocument();
    expect(screen.getByText('Energy')).toBeInTheDocument();
    expect(screen.getByText('Cost')).toBeInTheDocument();
    expect(screen.getByText('Efficiency')).toBeInTheDocument();
    expect(screen.getByText('CO₂ Saved')).toBeInTheDocument();
  });

  it('formats each metric value with its unit suffix', () => {
    renderSummary({ metrics: POPULATED });

    expect(screen.getByText('130.0 km')).toBeInTheDocument();
    expect(screen.getByText('55.0 kWh')).toBeInTheDocument();
    expect(screen.getByText('140.0 Wh/km')).toBeInTheDocument();
    expect(screen.getByText('8.0')).toBeInTheDocument();
    expect(screen.getByText('kg')).toBeInTheDocument();
  });

  it('renders the drive count as an integer and the cost via formatCurrency', () => {
    renderSummary({ metrics: POPULATED });

    // Drives uses fmtInt (no decimals); Cost uses the $ symbol from the settings stub.
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('$12.00')).toBeInTheDocument();
  });
});

/* ── Trend direction + positivity wiring ──────────────────────────────────── */
describe('WeekOverWeekSummary — trend direction + positivity', () => {
  it('reads more distance as an upward, positive (green) trend', () => {
    renderSummary({ metrics: POPULATED });

    const row = trendOf('+30.0%');
    expect(row.className).toContain('text-green-600');
    expect(row.textContent).toContain('\u2191'); // ↑
  });

  it('inverts positivity for energy — more usage reads as a red up-trend', () => {
    renderSummary({ metrics: POPULATED });

    const row = trendOf('+37.5%');
    expect(row.className).toContain('text-red-600');
    expect(row.className).not.toContain('text-green-600');
    expect(row.textContent).toContain('\u2191');
  });

  it('inverts positivity for cost — a higher bill reads red', () => {
    renderSummary({ metrics: POPULATED });

    expect(trendOf('+20.0%').className).toContain('text-red-600');
  });

  it('reads falling efficiency (lower Wh/km) as a positive (green) down-trend', () => {
    renderSummary({ metrics: POPULATED });

    const row = trendOf('-12.5%');
    expect(row.className).toContain('text-green-600');
    expect(row.textContent).toContain('\u2193'); // ↓
  });

  it('guards divide-by-zero — a zero baseline yields +100.0%, never Infinity', () => {
    renderSummary({ metrics: { totalDrives: 5, prevDriveCount: 0 } });

    expect(screen.getByText('+100.0%')).toBeInTheDocument();
    expect(screen.queryByText(/Infinity/)).toBeNull();
  });

  it('renders a flat 0% trend with an em-dash arrow for an unchanged metric', () => {
    // Distance is unchanged (100 vs 100); every other metric is 0 vs 0 — all flat.
    renderSummary({ metrics: { totalDistanceM: 100_000, prevDistanceM: 100_000 } });

    expect(screen.getByText('100.0 km')).toBeInTheDocument();
    expect(screen.getAllByText('0%')).toHaveLength(6);
    expect(screen.getAllByText('\u2014')).toHaveLength(6); // — flat arrows
  });
});

/* ── Null-safety ──────────────────────────────────────────────────────────── */
describe('WeekOverWeekSummary — null-safety', () => {
  it('defaults undefined metric fields to zeroed values without crashing', () => {
    const undefinedMetrics: Partial<DigestMetrics> = {
      totalDistanceM: undefined,
      prevDistanceM: undefined,
      totalDrives: undefined,
      prevDriveCount: undefined,
      energyUsedWh: undefined,
      prevEnergyWh: undefined,
      chargingCost: undefined,
      prevChargingCost: undefined,
      avgEfficiencyWhPerM: undefined,
      prevAvgEfficiencyWhPerM: undefined,
      co2Saved: undefined,
      prevCo2: undefined,
    };

    renderSummary({ metrics: undefinedMetrics });

    // Labels still render — the panel is never blank.
    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(screen.getByText('0.0 km')).toBeInTheDocument();
    expect(screen.getByText('0.0 kWh')).toBeInTheDocument();
    expect(screen.getByText('0.0 Wh/km')).toBeInTheDocument();
    expect(screen.getByText('0.0')).toBeInTheDocument();
    // Drives → fmtInt(0) → "0"; Cost → formatCurrency(0) → "$0.00".
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('$0.00')).toBeInTheDocument();
    // trendFor(0, 0) is flat for every card.
    expect(screen.getAllByText('0%')).toHaveLength(6);
  });
});

/* ── Loading state ────────────────────────────────────────────────────────── */
describe('WeekOverWeekSummary — loading state', () => {
  it('renders skeleton cards and hides values while keeping the section title', () => {
    const { container } = renderSummary({ metrics: POPULATED, isLoading: true });

    // Title lives outside the grid and is always shown.
    expect(screen.getByText('Week-over-Week Comparison')).toBeInTheDocument();
    // Loading StatCards render skeletons only — labels and values are suppressed.
    expect(screen.queryByText('Distance')).toBeNull();
    expect(screen.queryByText('130.0')).toBeNull();
    // Two skeleton bars per card × six cards.
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(12);
  });
});

/* ── Error state ──────────────────────────────────────────────────────────── */
describe('WeekOverWeekSummary — error state', () => {
  it('renders a retryable QueryError and suppresses the stat grid', () => {
    const onRetry = vi.fn();
    renderSummary({
      metrics: POPULATED,
      isError: true,
      error: new Error('digest boom'),
      onRetry,
    });

    // The grid must not render behind the error surface.
    expect(screen.queryByText('Distance')).toBeNull();
    expect(screen.queryByText('130.0')).toBeNull();
    // The section title is still present so the band keeps its heading.
    expect(screen.getByText('Week-over-Week Comparison')).toBeInTheDocument();

    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not render the error surface when isError is false', () => {
    renderSummary({ metrics: POPULATED });

    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    expect(screen.getByText('Distance')).toBeInTheDocument();
  });
});

/* ── Accessibility ────────────────────────────────────────────────────────── */
describe('WeekOverWeekSummary — accessibility', () => {
  it('exposes the section as a labelled region', () => {
    renderSummary({ metrics: POPULATED });

    expect(
      screen.getByRole('region', { name: 'Week-over-Week Comparison' }),
    ).toBeInTheDocument();
  });

  it('marks the six decorative stat icons as aria-hidden', () => {
    const { container } = renderSummary({ metrics: POPULATED });

    const car = container.querySelector('svg.lucide-car');
    const leaf = container.querySelector('svg.lucide-leaf');
    expect(car).not.toBeNull();
    expect(car).toHaveAttribute('aria-hidden', 'true');
    expect(leaf).toHaveAttribute('aria-hidden', 'true');

    // No leading icon should leak into the accessibility tree.
    const icons = container.querySelectorAll('svg.lucide');
    expect(icons.length).toBeGreaterThanOrEqual(6);
    icons.forEach((icon) => expect(icon).toHaveAttribute('aria-hidden', 'true'));
  });
});
