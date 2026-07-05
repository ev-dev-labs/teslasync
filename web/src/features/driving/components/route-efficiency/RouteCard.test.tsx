/**
 * RouteCard — behaviour, branch, interaction, a11y and null-safety coverage for
 * the file's sole runtime export (`RouteCard`, plus its `RouteCardProps` type).
 *
 * The component is a pure presentational tile: it takes a `RouteSummary` (SI
 * Wh/km efficiency, km distance) plus a `UnitDisplay` bag and renders the route
 * endpoints, a trips + avg-distance caption, an efficiency badge whose *tone* is
 * derived from the SI value (not the display value), a decorative best→avg→worst
 * gradient bar, and a three-column labelled readout. All the interesting logic
 * lives in the derivations: the em-dash placeholders, the SI→display unit
 * conversion, the badge variant band, and the clamped gradient stops.
 *
 * This file also pins the hardening pass's fixes:
 *   - the empty-string FOOTGUN — `route.startLocation ?? '—'` used to leak a
 *     blank heading for an empty string; it is now `|| '—'` (OrderCard
 *     convention) so an empty location degrades to the em-dash;
 *   - the gradient CLAMP — a net-regen (downhill) route has a negative Wh/km
 *     best efficiency, which used to produce an out-of-range CSS stop like
 *     "-15%"; both stops are now clamped to [0, 100];
 *   - a11y — the decorative gradient bar is `aria-hidden` (its data is fully
 *     duplicated by the labelled readout) and the truncatable endpoints carry a
 *     `title` so long addresses are recoverable on hover.
 *
 * Strategy: the component takes its route + unit converters as props, so no
 * network data is fetched and no QueryClient/Router is required. The real
 * `makeUnitDisplay` helper is used (km and mi) so every assertion reads the
 * value straight back out of the DOM through the production conversion path.
 * Only `react-i18next` is mocked so `t(key, fallback)` renders the English
 * fallback deterministically.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import type { RouteSummary } from '@/types/driving';
import { RouteCard, type RouteCardProps } from './RouteCard';
import { makeUnitDisplay } from './helpers';

// jsdom lacks matchMedia; the shared `@/components/ui` barrel can reach
// framer-motion's useReducedMotion transitively. Install a benign stub before
// any shared module evaluates.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
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

// i18n → return the developer fallback string. RouteCard only ever calls
// t(key, 'fallback'), so echoing the second arg is sufficient.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

/** 1 mile in km — mirrors the helper's display-boundary factor for mi assertions. */
const KM_PER_MILE = 1.609344;

/** A well-formed route: 25 km, 12 trips, best/avg/worst = 120/160/200 Wh/km. */
function makeRoute(over: Partial<RouteSummary> = {}): RouteSummary {
  return {
    startLocation: 'Home',
    endLocation: 'Office',
    tripCount: 12,
    avgDistanceKm: 25,
    avgEfficiency: 160,
    bestEfficiency: 120,
    worstEfficiency: 200,
    ...over,
  };
}

function renderCard(over: Partial<RouteCardProps> = {}) {
  const props: RouteCardProps = {
    route: makeRoute(),
    unit: makeUnitDisplay('km'),
    ...over,
  };
  return { ...render(<RouteCard {...props} />), props };
}

/** The inner gradient bar carries the computed `background` inline style. */
function gradientBar(container: HTMLElement): HTMLElement {
  const bar = container.querySelector('div[style*="linear-gradient"]');
  if (!bar) throw new Error('gradient bar not found');
  return bar as HTMLElement;
}

describe('RouteCard — header (endpoints, caption, badge)', () => {
  it('renders the start→end heading and the trips · avg-distance caption (km)', () => {
    renderCard();

    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading).toHaveTextContent('Home');
    expect(heading).toHaveTextContent('Office');

    // 12 trips, 25 km → "25.00" at the default precision of 2, km label + "avg".
    expect(screen.getByText('12 trips · 25.00 km avg')).toBeInTheDocument();
  });

  it('shows the efficiency badge with the SI value + unit and the matching band tone', () => {
    renderCard(); // avg 160 Wh/km → "info" band (140..180) → bg-blue-100

    const badge = screen.getByText('160 Wh/km');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-blue-100');
  });

  it('maps the badge tone across the efficiency bands (success / danger)', () => {
    const good = renderCard({ route: makeRoute({ avgEfficiency: 100, bestEfficiency: 80, worstEfficiency: 130 }) });
    // 100 < 140 → success.
    expect(within(good.container).getByText('100 Wh/km').className).toContain('bg-green-100');
    good.unmount();

    const bad = renderCard({ route: makeRoute({ avgEfficiency: 300, bestEfficiency: 200, worstEfficiency: 400 }) });
    // 300 >= 220 → danger.
    expect(within(bad.container).getByText('300 Wh/km').className).toContain('bg-red-100');
  });
});

describe('RouteCard — best/avg/worst readout', () => {
  it('renders each labelled figure with its SI-per-km value and unit', () => {
    renderCard();

    expect(screen.getByText('Best')).toBeInTheDocument();
    expect(screen.getByText('Avg')).toBeInTheDocument();
    expect(screen.getByText('Worst')).toBeInTheDocument();

    // The three figures are the distinct best/avg/worst numbers.
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('160')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();

    // Readout (3) + header badge (1) all carry the "Wh/km" unit.
    expect(screen.getAllByText('Wh/km').length).toBeGreaterThanOrEqual(3);
  });

  it('pairs each figure with a toned-down status colour (never hue-only)', () => {
    renderCard();
    // colour is always paired with the value text, per the neon-text guideline.
    expect(screen.getByText('120').closest('p')?.className).toContain('text-emerald-300');
    expect(screen.getByText('200').closest('p')?.className).toContain('text-rose-300');
  });
});

describe('RouteCard — unit conversion (miles branch)', () => {
  it('converts distance + efficiency to miles at the display boundary', () => {
    renderCard({ unit: makeUnitDisplay('mi') });

    // 160 Wh/km × 1.609344 = 257.5 → "257 Wh/mi"; 25 km → 15.53 mi.
    expect(Math.round(160 * KM_PER_MILE)).toBe(257);
    expect(screen.getByText('257 Wh/mi')).toBeInTheDocument();
    expect(screen.getByText('12 trips · 15.53 mi avg')).toBeInTheDocument();
    expect(screen.getAllByText('Wh/mi').length).toBeGreaterThanOrEqual(3);
  });

  it('derives the badge tone from the SI value, not the converted display value', () => {
    // In mi the badge reads "257 Wh/mi" (257 >= 220 would be "danger" if the
    // band were computed from the display number) — but the tone must stay
    // "info" because the raw SI figure is 160 Wh/km.
    renderCard({ unit: makeUnitDisplay('mi') });
    expect(screen.getByText('257 Wh/mi').className).toContain('bg-blue-100');
    expect(screen.getByText('257 Wh/mi').className).not.toContain('bg-red-100');
  });
});

describe('RouteCard — gradient bar', () => {
  it('renders the three-stop gradient at the computed best/avg percentages', () => {
    const { container } = renderCard(); // best 120, avg 160, worst 200 → 60% / 80%
    const bg = gradientBar(container).style.background;

    expect(bg).toContain('linear-gradient');
    expect(bg).toContain('60%');
    expect(bg).toContain('80%');
  });

  it('clamps a net-regen (negative efficiency) route so no CSS stop is negative', () => {
    // A downhill route can be net-regen: best efficiency dips below zero. The
    // raw stop would be -15% — the clamp pins it to 0%.
    const { container } = renderCard({
      route: makeRoute({ bestEfficiency: -30, avgEfficiency: 160, worstEfficiency: 200 }),
    });
    const bg = gradientBar(container).style.background;

    expect(bg).toContain('linear-gradient');
    expect(bg).not.toMatch(/-\d/); // no "-15%" style out-of-range stop
    // …while the readout still surfaces the true negative value.
    expect(screen.getByText('-30')).toBeInTheDocument();
  });

  it('marks the decorative bar aria-hidden (its data is in the labelled readout)', () => {
    const { container } = renderCard();
    expect(gradientBar(container).parentElement).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('RouteCard — null safety + placeholders', () => {
  it('degrades empty-string endpoints to an em-dash without a stray title', () => {
    renderCard({ route: makeRoute({ startLocation: '', endLocation: '' }) });

    const heading = screen.getByRole('heading', { level: 3 });
    const dashes = within(heading).getAllByText('—');
    expect(dashes).toHaveLength(2);
    // No location ⇒ no dangling hover tooltip.
    expect(dashes[0]).not.toHaveAttribute('title');
  });

  it('exposes a hover title on truncatable endpoints when a location is present', () => {
    const longName = 'A Very Long Route Origin Name That Truncates';
    renderCard({ route: makeRoute({ startLocation: longName }) });

    const origin = screen.getByTitle(longName);
    expect(origin).toHaveTextContent(longName);
    expect(origin.className).toContain('truncate');
  });

  it('renders without NaN when every numeric field is null at runtime', () => {
    const { container } = renderCard({
      route: {
        startLocation: 'A',
        endLocation: 'B',
        tripCount: null,
        avgDistanceKm: null,
        avgEfficiency: null,
        bestEfficiency: null,
        worstEfficiency: null,
      } as unknown as RouteSummary,
    });

    // Nullish numbers collapse to 0 rather than crashing or printing NaN.
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('A');
    expect(screen.getByText('0 Wh/km')).toBeInTheDocument();
    expect(screen.getByText('0 trips · 0.00 km avg')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/NaN/);
  });
});

describe('RouteCard — accessibility', () => {
  it('marks the decorative pin + arrow glyphs aria-hidden', () => {
    const { container } = renderCard();
    const hidden = container.querySelectorAll('svg[aria-hidden="true"]');
    // MapPin (endpoint icon) + ArrowRight (route separator).
    expect(hidden.length).toBeGreaterThanOrEqual(2);
  });
});
