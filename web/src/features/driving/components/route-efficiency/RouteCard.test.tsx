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
 * The concrete ThemeProvider supplies transitive theme consumers; only its
 * settings request and i18n are mocked for deterministic presentation.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';

import type { RouteSummary } from '@/types/driving';
import { RouteCard, type RouteCardProps } from './RouteCard';
import { makeUnitDisplay } from './helpers';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import {
  expectAppDesignDataMode, matchesAppDesignCss, setAppDesignTestProfile,
} from '@/components/feedback/appDesignCss.test-utils';
import { ROUTE_EFF_COLORS } from './constants';

const actualThemeProvider = await vi.importActual<
  typeof import('@/components/ui/ThemeProvider')
>('@/components/ui/ThemeProvider');
const ActualThemeProvider = actualThemeProvider.ThemeProvider;

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
  return {
    ...render(<ActualThemeProvider><RouteCard {...props} /></ActualThemeProvider>),
    props,
  };
}

// jsdom rejects gradients containing light-dark(). Capture the actual React
// style assignment without replacing the palette or bypassing the native setter.
const assignedBackgrounds = new WeakMap<CSSStyleDeclaration, string>();

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({})));
  // jsdom places CSS property accessors on CSSStyleProperties, one level
  // above CSSStyleDeclaration; use the prototype of an actual element style.
  const stylePrototype: CSSStyleDeclaration = Object.getPrototypeOf(
    document.createElement('div').style,
  );
  const setBackground = Object.getOwnPropertyDescriptor(
    stylePrototype,
    'background',
  )?.set;
  if (!setBackground) throw new Error('background setter not found');
  vi.spyOn(stylePrototype, 'background', 'set').mockImplementation(
    function (this: CSSStyleDeclaration, value: string) {
      assignedBackgrounds.set(this, value);
      setBackground.call(this, value);
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Find the decorative range bar independently of jsdom's CSS support. */
function gradientBar(container: HTMLElement): HTMLElement {
  const bar = container.querySelector<HTMLDivElement>('div[aria-hidden="true"] > div.h-full.rounded-full');
  if (!bar) throw new Error('gradient bar not found');
  return bar;
}

function gradientBackground(container: HTMLElement): string {
  const background = assignedBackgrounds.get(gradientBar(container).style);
  if (background === undefined) throw new Error('gradient background was not assigned');
  return background;
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
    renderCard(); // avg 160 Wh/km → "info" band (140..180)

    const badge = screen.getByText('160 Wh/km');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-[var(--semantic-info-bg)]');
  });

  it('maps the badge tone across the efficiency bands (success / danger)', () => {
    const good = renderCard({ route: makeRoute({ avgEfficiency: 100, bestEfficiency: 80, worstEfficiency: 130 }) });
    // 100 < 140 → success.
    expect(within(good.container).getByText('100 Wh/km').className).toContain('bg-[var(--semantic-success-bg)]');
    good.unmount();

    const bad = renderCard({ route: makeRoute({ avgEfficiency: 300, bestEfficiency: 200, worstEfficiency: 400 }) });
    // 300 >= 220 → danger.
    expect(within(bad.container).getByText('300 Wh/km').className).toContain('bg-[var(--semantic-danger-bg)]');
  });
});

describe('RouteCard — best/avg/worst readout', () => {
  it.each(['km', 'mi'] as const)('binds native definition readings and units in every design without changing negative/inverted %s operands or the gradient', distance => {
    const unit = makeUnitDisplay(distance);
    const { container } = renderCard({ unit, route: makeRoute({ bestEfficiency: -30, avgEfficiency: 200, worstEfficiency: 100 }) });
    const before = gradientBackground(container);
    const definitions = container.querySelector('[data-app-list="definitions"]')!;
    const values = [...definitions.querySelectorAll('[data-app-part="metric-value"]')].map(node => node.textContent);
    expect(values).toEqual([-30, 200, 100].map(value => String(Math.round(unit.toEfficiency(value)))));
    expect(definitions.querySelectorAll('[data-app-part="metric-unit"]')).toHaveLength(3);
    container.setAttribute('data-app-design-preview', '');
    for (const pack of PACK_IDS) {
      for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) container.setAttribute(name, value);
      const release = observeAppDesignScopes(container);
      try {
        for (const reading of definitions.querySelectorAll('[data-app-part="metric-reading"]')) {
          expectAppDesignDataMode(reading, APPLICATION_DESIGNS[pack].data, '[data-app-list="definitions"]');
          expect(reading.querySelector('[data-app-part="metric-unit"]')).toHaveTextContent(unit.efficiencyUnit);
        }
        expect([...definitions.querySelectorAll('[data-app-part="metric-value"]')].map(node => node.textContent)).toEqual(values);
        expect(gradientBackground(container)).toBe(before);
        expect(gradientBar(container).parentElement).toHaveAttribute('data-app-metric', 'bar');
      } finally { release(); }
    }
  });

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
    expect(screen.getByText('120').closest('dd')?.className).toContain('text-emerald-300');
    expect(screen.getByText('200').closest('dd')?.className).toContain('text-rose-300');
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
    expect(screen.getByText('257 Wh/mi').className).toContain('bg-[var(--semantic-info-bg)]');
    expect(screen.getByText('257 Wh/mi').className).not.toContain('bg-[var(--semantic-danger-bg)]');
  });
});

describe('RouteCard — gradient bar', () => {
  it('binds only the original aria-hidden track and original fill to deliberate native consumers in all27', () => {
    const { container } = renderCard();
    const fill = gradientBar(container);
    const track = fill.parentElement!;
    const before = gradientBackground(container);
    expect(track).toHaveAttribute('data-app-part', 'metric');
    expect(track).toHaveAttribute('data-metric-track');
    expect(fill).toHaveAttribute('data-metric-fill');
    expect(track.children).toHaveLength(1);
    container.setAttribute('data-app-design-preview', '');
    for (const pack of PACK_IDS) {
      setAppDesignTestProfile(container, pack);
      const release = observeAppDesignScopes(container);
      try {
        expectAppDesignDataMode(track, APPLICATION_DESIGNS[pack].data, '[data-app-metric="bar"][data-metric-track]');
        const trackRules = matchesAppDesignCss(track, '[data-app-metric="bar"][data-metric-track]');
        expect(trackRules.some(rule => 'outline' in rule.declarations)).toBe(true);
        expect(trackRules.every(rule => Object.keys(rule.declarations)
          .every(property => ['outline', 'outline-offset'].includes(property)))).toBe(true);
        const fillRules = matchesAppDesignCss(fill, '[data-metric-fill]');
        expect(fillRules).toHaveLength(1);
        expect(fillRules[0].declarations).toEqual({ 'box-sizing': 'border-box', 'min-inline-size': '0' });
        expect(track).toHaveAttribute('aria-hidden', 'true');
        expect(track).toHaveClass('mt-4', 'h-2.5', 'overflow-hidden', 'rounded-full', 'bg-[var(--surface-2)]');
        expect(fill).toHaveClass('h-full', 'rounded-full');
        expect(fill.style.width).toBe('');
        expect(gradientBackground(container)).toBe(before);
        for (const node of [track, fill]) {
          for (const attribute of ['role', 'aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'data-value', 'data-percent']) {
            expect(node).not.toHaveAttribute(attribute);
          }
        }
        expect(screen.getByText('12 trips · 25.00 km avg')).toBeInTheDocument();
        expect(container.querySelectorAll('dl > div')).toHaveLength(3);
      } finally { release(); }
    }
  });

  it.each([
    { name: 'normal', bestEfficiency: 120, avgEfficiency: 160, worstEfficiency: 200, bestStop: '60', avgStop: '80' },
    { name: 'net regeneration', bestEfficiency: -30, avgEfficiency: 160, worstEfficiency: 200, bestStop: '0', avgStop: '80' },
    { name: 'inverted stops', bestEfficiency: 180, avgEfficiency: 90, worstEfficiency: 200, bestStop: '90', avgStop: '45' },
    { name: 'zero denominator', bestEfficiency: -10, avgEfficiency: 20, worstEfficiency: 0, bestStop: '0', avgStop: '100' },
    { name: 'all negative', bestEfficiency: -30, avgEfficiency: -20, worstEfficiency: -10, bestStop: '0', avgStop: '0' },
    { name: 'malformed source with existing safe converter', bestEfficiency: NaN, avgEfficiency: Infinity, worstEfficiency: -Infinity, bestStop: '0', avgStop: '0' },
  ])('retains the exact full-width source gradient for $name', ({ bestEfficiency, avgEfficiency, worstEfficiency, bestStop, avgStop }) => {
    const { container } = renderCard({ route: makeRoute({ bestEfficiency, avgEfficiency, worstEfficiency }) });
    expect(gradientBackground(container)).toBe(
      `linear-gradient(to right, ${ROUTE_EFF_COLORS.best} 0%, ${ROUTE_EFF_COLORS.best} ${bestStop}%,` +
      ` ${ROUTE_EFF_COLORS.avg} ${bestStop}%, ${ROUTE_EFF_COLORS.avg} ${avgStop}%,` +
      ` ${ROUTE_EFF_COLORS.worst} ${avgStop}%, ${ROUTE_EFF_COLORS.worst} 100%)`,
    );
    expect(gradientBar(container)).toHaveAttribute('data-metric-fill');
    expect(gradientBar(container).style.width).toBe('');
    expect(container.querySelectorAll('[data-metric-fill]')).toHaveLength(1);
    expect(container.textContent).not.toContain('%');
  });

  it('does not repair a caller converter that intentionally propagates malformed operands', () => {
    const { container } = renderCard({
      route: makeRoute({ bestEfficiency: NaN, avgEfficiency: Infinity, worstEfficiency: NaN }),
      unit: { ...makeUnitDisplay('km'), toEfficiency: value => value ?? 0 },
    });
    expect(gradientBackground(container)).toBe(
      `linear-gradient(to right, ${ROUTE_EFF_COLORS.best} 0%, ${ROUTE_EFF_COLORS.best} NaN%,` +
      ` ${ROUTE_EFF_COLORS.avg} NaN%, ${ROUTE_EFF_COLORS.avg} NaN%,` +
      ` ${ROUTE_EFF_COLORS.worst} NaN%, ${ROUTE_EFF_COLORS.worst} 100%)`,
    );
    expect(gradientBar(container).parentElement).toHaveAttribute('aria-hidden', 'true');
    expect(gradientBar(container).parentElement).not.toHaveAttribute('role');
  });

  it.each(['default', 'widget-only', 'public', 'incomplete'] as const)('leaves the native range neutral in %s scope', scope => {
    const { container } = renderCard();
    if (scope === 'widget-only') container.setAttribute('data-widget-pack', 'v2');
    if (scope === 'public') container.setAttribute('data-public-report', '');
    if (scope === 'incomplete') {
      container.setAttribute('data-app-design-preview', '');
      setAppDesignTestProfile(container, 'v2');
      container.removeAttribute('data-app-map');
    }
    const release = observeAppDesignScopes(container);
    try {
      for (const node of [gradientBar(container), gradientBar(container).parentElement!]) {
        expect(node).not.toHaveAttribute('data-app-design-owner');
        expect(matchesAppDesignCss(node, '[data-metric-track]')).toHaveLength(0);
      }
    } finally { release(); }
  });

  it('respects nearest complete ownership and makes an incomplete nested range neutral', async () => {
    const { container } = renderCard();
    container.setAttribute('data-app-design-preview', '');
    setAppDesignTestProfile(container, 'classic');
    const island = container.firstElementChild!;
    island.setAttribute('data-app-design-preview', '');
    setAppDesignTestProfile(island, 'v2');
    const track = gradientBar(container).parentElement!;
    const release = observeAppDesignScopes(container);
    try {
      expectAppDesignDataMode(track, 'cards', '[data-app-metric="bar"][data-metric-track]');
      expect(matchesAppDesignCss(track, '[data-app-data="table"]')).toHaveLength(0);
      island.removeAttribute('data-app-controls');
      await waitFor(() => expect(track).not.toHaveAttribute('data-app-design-owner'));
      expect(matchesAppDesignCss(track, '[data-metric-track]')).toHaveLength(0);
      expect(gradientBar(container)).not.toHaveAttribute('data-app-design-owner');
    } finally { release(); }
  });

  it('renders the three-stop gradient at the computed best/avg percentages', () => {
    const { container } = renderCard(); // best 120, avg 160, worst 200 → 60% / 80%
    const bg = gradientBackground(container);

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
    const bg = gradientBackground(container);

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
