/**
 * helpers — analytics loading-skeleton primitives contract + hardening tests.
 *
 * `helpers.tsx` exports two purely-presentational placeholders used by the
 * analytics tabs (HeroGauges, DrivingPerformanceCards, BatteryTab, ChargingTab)
 * while `useFleetAnalytics()` loads its first payload:
 *   - <MetricSkeleton/>      — a single GlassPanel-shaped card with two shimmer
 *                              bars, decorative (aria-hidden).
 *   - <MetricBandSkeleton/>  — a responsive grid of `count` MetricSkeletons that
 *                              reserves the KPI band's footprint so the layout
 *                              does not jump when real metrics land.
 *
 * There is no network, no QueryClient and no Router here — these render bare, so
 * the suite asserts against the rendered DOM directly (shimmer count, grid
 * classes, decorative a11y, and the count guard) rather than mounting providers.
 *
 * Facets covered:
 *   1. MetricSkeleton — renders a decorative GlassPanel with exactly two shimmer
 *      bars, and is hidden from assistive tech (aria-hidden).
 *   2. MetricBandSkeleton — renders exactly `count` cards inside a decorative
 *      responsive grid.
 *   3. className merge — a caller override (BatteryTab's `lg:grid-cols-5`) wins
 *      over the default `lg:grid-cols-6` via tailwind-merge, not just appends.
 *   4. Zero / negative counts degrade to an empty grid (never a crash).
 *   5. Non-finite count (Infinity) — regression guard: pre-hardening this threw
 *      `RangeError: Invalid array length` and blanked the whole analytics tab.
 *   6. Fractional count is floored to a whole number of cards.
 */

import { render } from '@testing-library/react';
import { MetricSkeleton, MetricBandSkeleton } from './helpers';

// The GlassPanel primitive always carries this class — used as the "one card"
// marker (mirrors the PageLoadSkeleton suite's panel-counting convention).
const CARD_SELECTOR = '.backdrop-blur-sm';
// The inner <Skeleton> shimmer bars animate via this class.
const SHIMMER_SELECTOR = '.animate-pulse';

describe('MetricSkeleton', () => {
  it('renders a decorative GlassPanel card with exactly two shimmer bars', () => {
    const { container } = render(<MetricSkeleton />);

    const card = container.firstElementChild as HTMLElement;
    expect(card).not.toBeNull();
    // It is a GlassPanel (padded surface), not a bare div.
    expect(card).toHaveClass('backdrop-blur-sm', 'p-3');
    // Two shimmer bars: the value line + the label line.
    expect(container.querySelectorAll(SHIMMER_SELECTOR)).toHaveLength(2);
  });

  it('is hidden from assistive tech (decorative placeholder)', () => {
    const { container } = render(<MetricSkeleton />);

    const card = container.firstElementChild as HTMLElement;
    expect(card).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('MetricBandSkeleton', () => {
  it('renders exactly `count` cards inside a decorative responsive grid', () => {
    const { container } = render(<MetricBandSkeleton count={6} />);

    const band = container.firstElementChild as HTMLElement;
    // Decorative band — the page, not each shimmer, announces "loading".
    expect(band).toHaveAttribute('aria-hidden', 'true');
    // Responsive KPI-band grid so the footprint matches the real MetricCards.
    expect(band).toHaveClass(
      'grid',
      'grid-cols-2',
      'md:grid-cols-3',
      'lg:grid-cols-6',
    );
    // One MetricSkeleton per requested slot.
    expect(band.children).toHaveLength(6);
    expect(container.querySelectorAll(CARD_SELECTOR)).toHaveLength(6);
  });

  it('honours a different count (BatteryTab requests five)', () => {
    const { container } = render(<MetricBandSkeleton count={5} />);

    expect(
      (container.firstElementChild as HTMLElement).children,
    ).toHaveLength(5);
  });

  it('lets a caller className override the default column count (tailwind-merge, not append)', () => {
    const { container } = render(
      <MetricBandSkeleton count={5} className="lg:grid-cols-5" />,
    );

    const band = container.firstElementChild as HTMLElement;
    // The override wins…
    expect(band).toHaveClass('lg:grid-cols-5');
    // …and the conflicting default is dropped, not stacked (which would let CSS
    // source-order pick the wrong one).
    expect(band.className).not.toContain('lg:grid-cols-6');
  });

  it('degrades to an empty grid for a zero count without crashing', () => {
    const { container } = render(<MetricBandSkeleton count={0} />);

    const band = container.firstElementChild as HTMLElement;
    expect(band).toBeInTheDocument();
    expect(band.children).toHaveLength(0);
    expect(container.querySelectorAll(CARD_SELECTOR)).toHaveLength(0);
  });

  it('clamps a negative count to an empty grid', () => {
    const { container } = render(<MetricBandSkeleton count={-3} />);

    expect(
      (container.firstElementChild as HTMLElement).children,
    ).toHaveLength(0);
  });

  it('does not throw and renders no cards for a non-finite count (RangeError guard)', () => {
    // Regression guard: `Array.from({ length: Infinity })` throws
    // "Invalid array length", which pre-hardening blanked the analytics tab.
    expect(() =>
      render(<MetricBandSkeleton count={Number.POSITIVE_INFINITY} />),
    ).not.toThrow();

    const { container } = render(
      <MetricBandSkeleton count={Number.POSITIVE_INFINITY} />,
    );
    expect(container.querySelectorAll(CARD_SELECTOR)).toHaveLength(0);
  });

  it('floors a fractional count to a whole number of cards', () => {
    const { container } = render(<MetricBandSkeleton count={3.7} />);

    expect(container.querySelectorAll(CARD_SELECTOR)).toHaveLength(3);
  });
});
