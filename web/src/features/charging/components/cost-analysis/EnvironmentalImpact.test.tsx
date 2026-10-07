/**
 * EnvironmentalImpact (cost-analysis) — behaviour + hardening contract.
 *
 * EnvironmentalImpact is the "green" band of the Cost Analysis page. It is a
 * pure presentational formatter: the parent (CostAnalysisPage) has already
 * reduced the raw charging sessions into a single `CoreStats` bag via
 * `useCostAnalysisData`, so this component's whole job is to (a) delegate its
 * loading / error / empty chrome to the shared <CostSection> shell and (b)
 * format five environmental figures + a narrative sentence from that bag.
 *
 * These tests therefore pin:
 *   - the exact formatted, locale-grouped strings of all five tiles (co2 saved,
 *     tree-years, gallons avoided, metric-tons, dollars saved) and every label,
 *     plus the narrative sentence that re-cites the CO2 + tree figures;
 *   - the four <CostSection> states are wired correctly and mutually exclusive:
 *     loading shows the skeleton (never the metrics), a null bag shows a labelled
 *     `role="status"` empty state (never a blank panel), and an error shows a
 *     `role="alert"` with a working Retry that invokes `onRetry` — with the
 *     section heading always present so the band is never hidden;
 *   - error precedence: an error suppresses stale metrics even when a non-null
 *     `coreStats` is still supplied;
 *   - null-safety hardening: a dirty bag whose magnitudes are NaN / null /
 *     undefined never leaks "NaN" and never crashes the `/ 1000` metric-tons
 *     math — the boundary `?? 0` guards + `fmtNumber`'s `safeNumber` neutralise
 *     every field to a finite "0" while all labels stay visible;
 *   - a11y: both decorative icons are `aria-hidden` and the panel title is a
 *     real heading whose accessible name excludes the glyph.
 *
 * Conventions mirror the sibling charging-curve / charging-list component tests:
 * `react-i18next` is stubbed so `t(key, fallback)` resolves to its English
 * fallback deterministically, and the globally-stubbed `useSettings`
 * (src/test-setup.ts) lets the real number formatters run against en-US /
 * precision-2 prefs. The error branch renders <QueryError>, which reaches for
 * `useNavigate`, so those renders are wrapped in a <MemoryRouter>.
 */

import type { ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { EnvironmentalImpact } from './EnvironmentalImpact';
import type { CoreStats } from './types';

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

type Props = ComponentProps<typeof EnvironmentalImpact>;

/**
 * Fully-populated CoreStats with deliberately distinct magnitudes so every
 * formatted tile maps to a unique on-screen string:
 *   co2SavedKg 88.87 -> "88.9" tile / "89 kg" narrative / "0.09" metric-tons
 *   treeEquiv  4.04  -> "4.0"  (tile AND narrative both cite it)
 *   gallons    12.3  -> "12.3"
 *   savings    1250  -> "1,250" (proves locale integer grouping)
 */
function makeStats(overrides: Partial<CoreStats> = {}): CoreStats {
  return {
    totalCost: 0,
    totalEnergy: 0,
    avgCostPerKwh: 0,
    totalDuration: 0,
    totalDistanceM: 0,
    costPerDist: 0,
    gasCost: 0,
    savings: 1250,
    savingsPercent: 0,
    co2SavedKg: 88.87,
    treeEquiv: 4.04,
    gallonsEquiv: 12.3,
    count: 5,
    ...overrides,
  };
}

/** All five metric labels, in render order — none may ever be hidden on data. */
const LABELS = [
  'kg CO₂ saved',
  'tree-years equivalent',
  'gallons avoided',
  'metric tons CO₂',
  '$ saved total',
];

/** Wrap in a router so the error branch's <QueryError> can call useNavigate. */
function renderEnv(props: Partial<Props> = {}) {
  return render(
    <MemoryRouter>
      <EnvironmentalImpact coreStats={null} {...props} />
    </MemoryRouter>,
  );
}

describe('EnvironmentalImpact — populated data', () => {
  it('formats and labels all five environmental figures from the CoreStats bag', () => {
    renderEnv({ coreStats: makeStats() });

    // The band renders as a real, accessibly-named heading (glyph excluded).
    expect(
      screen.getByRole('heading', { name: /environmental impact/i }),
    ).toBeInTheDocument();

    // Every label is present — the section never drops a tile.
    for (const label of LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // Hero tiles: 1-dp CO2 and the metric-tons derive (88.87 / 1000 -> 0.09).
    expect(screen.getByText('88.9')).toBeInTheDocument();
    expect(screen.getByText('0.09')).toBeInTheDocument();
    // Gallons at 1-dp.
    expect(screen.getByText('12.3')).toBeInTheDocument();
    // Dollars saved use locale integer grouping, not a bare "1250".
    expect(screen.getByText('1,250')).toBeInTheDocument();
    expect(screen.queryByText('1250')).toBeNull();

    // The tree figure is cited twice — once in its tile, once in the sentence.
    expect(screen.getAllByText('4.0')).toHaveLength(2);

    // No loading / empty / error chrome is present alongside real data.
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the narrative that re-cites the CO2 + tree figures', () => {
    const { container } = renderEnv({ coreStats: makeStats() });

    // The rounded (0-dp) CO2 mass appears inline with its unit in the sentence.
    expect(screen.getByText('89 kg')).toBeInTheDocument();

    // The full sentence reads coherently from its translated fragments.
    const prose = container.textContent ?? '';
    expect(prose).toContain('avoided the equivalent of');
    expect(prose).toContain('of CO₂ emissions.');
    expect(prose).toContain('trees absorbing carbon for a full year.');
  });

  it('marks both decorative icons aria-hidden', () => {
    const { container } = renderEnv({ coreStats: makeStats() });

    // Leaf (header) + Trees (narrative) = two purely decorative glyphs.
    const svgs = container.querySelectorAll('svg');
    expect(svgs).toHaveLength(2);
    svgs.forEach((svg) => expect(svg).toHaveAttribute('aria-hidden', 'true'));
  });
});

describe('EnvironmentalImpact — loading / empty / error states', () => {
  it('shows the skeleton (never the metrics) while loading, keeping the heading', () => {
    // Data supplied but loading -> the shell must still show the skeleton.
    const { container } = renderEnv({ coreStats: makeStats(), isLoading: true });

    expect(
      screen.getByRole('heading', { name: /environmental impact/i }),
    ).toBeInTheDocument();
    // The skeleton block animates; the metric labels are suppressed.
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('kg CO₂ saved')).toBeNull();
    expect(screen.queryByText('88.9')).toBeNull();
    // Loading is not the empty or error branch.
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders a labelled empty state instead of a blank panel when coreStats is null', () => {
    const { container } = renderEnv({ coreStats: null });

    // Heading persists — the band is never fully hidden on empty data.
    expect(
      screen.getByRole('heading', { name: /environmental impact/i }),
    ).toBeInTheDocument();
    // EmptyState surfaces as a status region carrying the fallback copy.
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('No data')).toBeInTheDocument();
    // Neither metrics nor a loading skeleton render.
    expect(screen.queryByText('kg CO₂ saved')).toBeNull();
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  it('renders an error with a working Retry that invokes onRetry', () => {
    const onRetry = vi.fn();
    renderEnv({ coreStats: null, error: new Error('boom'), onRetry });

    expect(
      screen.getByRole('heading', { name: /environmental impact/i }),
    ).toBeInTheDocument();
    // The failed query surfaces as an assertive alert, not silent zeros.
    expect(screen.getByRole('alert')).toBeInTheDocument();

    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(onRetry).not.toHaveBeenCalled();
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);

    // Metrics are not rendered in the error branch.
    expect(screen.queryByText('kg CO₂ saved')).toBeNull();
  });

  it('prioritises the error over stale data', () => {
    // Even with a non-null bag, an error must win — never show stale figures.
    renderEnv({ coreStats: makeStats(), error: new Error('stale'), onRetry: vi.fn() });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('88.9')).toBeNull();
    expect(screen.queryByText('kg CO₂ saved')).toBeNull();
  });
});

describe('EnvironmentalImpact — dirty-data hardening', () => {
  it('neutralises NaN / null / undefined magnitudes to a finite "0" with no NaN leak', () => {
    // `?? 0` catches null/undefined; `fmtNumber`'s safeNumber finishes NaN.
    const dirty = {
      co2SavedKg: NaN,
      treeEquiv: undefined,
      gallonsEquiv: null,
      savings: NaN,
    } as unknown as CoreStats;

    const { container } = renderEnv({ coreStats: dirty });

    // The section is fully populated, not blanked, on dirty input.
    expect(
      screen.getByRole('heading', { name: /environmental impact/i }),
    ).toBeInTheDocument();
    for (const label of LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // The metric-tons derive (NaN / 1000) is neutralised to "0.00" — the guard
    // means the raw division never propagates a nullish/NaN operand to the DOM.
    expect(screen.getByText('0.00')).toBeInTheDocument();
    // Absolutely no "NaN" leaks anywhere in the rendered output.
    expect(container.textContent).not.toContain('NaN');
  });

  it('renders without throwing when the entire CoreStats bag is dirty', () => {
    const dirty = {} as unknown as CoreStats;
    expect(() => renderEnv({ coreStats: dirty })).not.toThrow();
    // A wholly-empty bag still renders every label and a finite metric-tons "0.00".
    expect(screen.getByText('metric tons CO₂')).toBeInTheDocument();
    expect(screen.getByText('0.00')).toBeInTheDocument();
  });
});
