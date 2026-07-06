/**
 * SummaryStatsGrid (charging-curve) — behaviour + hardening contract.
 *
 * SummaryStatsGrid is the KPI band of the Charging Curve page. It is a *pure
 * presentational* formatter: the parent (ChargingCurvePage) has already reduced
 * the raw sessions into DISPLAY-unit magnitudes before handing over the
 * `SummaryStats` bag — energy is divided from watt-hours to kWh and power from
 * watts to kW at the page boundary — so this grid's job is only to format +
 * label + colour six tiles. These tests therefore pin:
 *
 *   - the exact formatted, unit-suffixed string of every one of the six cards
 *     (integer grouping, 2-dp decimals, "kWh"/"kW"/"min" suffixes, currency);
 *   - null-safety: a `null` stats bag renders zeroed tiles (never a blank
 *     panel), and — critically — `NaN`/`null`/`undefined` field values are
 *     neutralised to a finite "0" by the formatters, because the source's
 *     `?? 0` guard alone does NOT catch `NaN`;
 *   - the loading branch is an accessible, busy, labelled `role="status"` live
 *     region (the elevation added here — it was previously a silent grid of
 *     skeletons that assistive tech never announced) with one skeleton per card;
 *   - every metric icon is decorative (`aria-hidden`) so screen readers announce
 *     the value/label, not the glyph.
 *
 * Conventions mirror the sibling LoadingSkeleton / SummaryStats tests in this
 * repo: the component is presentational (no router/query context), and the
 * globally-stubbed `useSettings` (src/test-setup.ts — currency `$`, precision 2,
 * locale en-US) lets the real `useFormatting` run against deterministic prefs.
 * `react-i18next` is stubbed so `t(key, fallback)` resolves to its English
 * fallback deterministically.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import SummaryStatsGrid from './SummaryStatsGrid';
import type { SummaryStats } from './types';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

/** Fully-populated display-unit stats (already converted by the page). */
const fullStats: SummaryStats = {
  totalSessions: 12_345,
  totalEnergy: 523.4,
  avgRate: 48.25,
  peakRate: 120.5,
  avgDuration: 35.6,
  totalCost: 89.9,
};

/** The six card labels, in render order — every one must always be present. */
const LABELS = [
  'Total Sessions',
  'Total Energy',
  'Avg Charge Rate',
  'Peak Rate',
  'Avg Duration',
  'Total Cost',
];

describe('SummaryStatsGrid — populated data', () => {
  it('formats and labels all six metric cards with their unit suffixes', () => {
    render(<SummaryStatsGrid stats={fullStats} />);

    // Every label renders (never hide a tile).
    for (const label of LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // Sessions use integer grouping (12,345), not a raw "12345".
    expect(screen.getByText('12,345')).toBeInTheDocument();
    expect(screen.queryByText('12345')).toBeNull();
    // Energy / power carry their display-unit suffixes at 2-dp precision.
    expect(screen.getByText('523.40 kWh')).toBeInTheDocument();
    expect(screen.getByText('48.25 kW')).toBeInTheDocument();
    expect(screen.getByText('120.50 kW')).toBeInTheDocument();
    // Duration is a rounded integer of minutes (35.6 → 36).
    expect(screen.getByText('36 min')).toBeInTheDocument();
    // Cost goes through useFormatting.formatCurrency ($ + 2-dp).
    expect(screen.getByText('$89.90')).toBeInTheDocument();
  });

  it('marks every metric icon as decorative and never shows the loading region', () => {
    const { container } = render(<SummaryStatsGrid stats={fullStats} />);

    const svgs = container.querySelectorAll('svg');
    expect(svgs).toHaveLength(6);
    svgs.forEach((svg) => expect(svg).toHaveAttribute('aria-hidden', 'true'));

    // Data present → this is the metric grid, not the busy skeleton.
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByTestId('charging-summary-skeleton')).toBeNull();
  });
});

describe('SummaryStatsGrid — null / dirty stats hardening', () => {
  it('renders zeroed tiles (not a blank panel) when stats is null', () => {
    render(<SummaryStatsGrid stats={null} />);

    // All labels still present — the section is never hidden on empty data.
    for (const label of LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    expect(screen.getByText('0.00 kWh')).toBeInTheDocument();
    expect(screen.getByText('$0.00')).toBeInTheDocument();
    expect(screen.getByText('0 min')).toBeInTheDocument();
    // Both rate tiles zero out → two "0.00 kW" values, not a crash.
    expect(screen.getAllByText('0.00 kW')).toHaveLength(2);
    // The null grid is not the loading skeleton.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('neutralises NaN / null / undefined field values to a finite "0"', () => {
    // `?? 0` catches null/undefined but NOT NaN — the formatter's safeNumber
    // must finish the job so a dirty upstream bag never leaks "NaN".
    const dirty = {
      totalSessions: NaN,
      totalEnergy: undefined,
      avgRate: null,
      peakRate: 120.5,
      avgDuration: NaN,
      totalCost: undefined,
    } as unknown as SummaryStats;

    const { container } = render(<SummaryStatsGrid stats={dirty} />);

    // A valid sibling still renders correctly amid the dirty fields.
    expect(screen.getByText('120.50 kW')).toBeInTheDocument();
    // undefined/null → 0 via `?? 0`; NaN → 0 via safeNumber inside the formatter.
    expect(screen.getByText('0')).toBeInTheDocument(); // NaN sessions → "0"
    expect(screen.getByText('0.00 kWh')).toBeInTheDocument(); // undefined energy
    expect(screen.getByText('0 min')).toBeInTheDocument(); // NaN duration
    expect(screen.getByText('$0.00')).toBeInTheDocument(); // undefined cost
    // No literal "NaN" leaked into the DOM anywhere.
    expect(container.textContent).not.toContain('NaN');
  });
});

describe('SummaryStatsGrid — loading state', () => {
  it('exposes a busy, labelled role="status" live region while loading', () => {
    render(<SummaryStatsGrid stats={null} loading />);

    const region = screen.getByRole('status');
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('aria-busy', 'true');
    // aria-label resolves to the English fallback via the mocked t().
    expect(region).toHaveAccessibleName('Loading summary metrics');
    // The status role and the stable test id are the same node.
    expect(screen.getByTestId('charging-summary-skeleton')).toBe(region);
  });

  it('renders one animated skeleton panel per card and no metric labels', () => {
    const { container } = render(<SummaryStatsGrid stats={fullStats} loading />);

    // GlassPanel tags each panel root with data-print-card — one per card.
    expect(container.querySelectorAll('[data-print-card]')).toHaveLength(LABELS.length);
    // Two Skeletons per panel, each animated.
    expect(container.querySelectorAll('.animate-pulse').length).toBe(LABELS.length * 2);
    // Loading takes precedence over data: no metric label/value leaks through.
    expect(screen.queryByText('Total Sessions')).toBeNull();
    expect(screen.queryByText('523.40 kWh')).toBeNull();
  });
});
