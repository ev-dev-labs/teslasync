/**
 * analytics/constants — behaviour + hardening contract.
 *
 * This module is the shared vocabulary the Fleet Analytics page threads down to
 * every tab: the tab-key tuple, the pie-slice palette, the "Quick Links" band,
 * and the two query/type aliases. It has no data source of its own, so the
 * contract worth pinning is structural integrity — the invariants a silent
 * regression here would break in the UI:
 *
 *   - TAB_KEYS must stay in sync with the `analytics.<tab>` i18n namespaces and
 *     the union `TabKey` derived from it (a closed union — a stray value must
 *     not type-check).
 *   - PIE_COLORS must expose six DEFINED hex colours (recharts renders one
 *     <Cell fill> per slice via `PIE_COLORS[i % PIE_COLORS.length]`; an
 *     `undefined` hole would paint a slice with no fill). It mirrors the first
 *     six entries of the CB-safe shared palette.
 *   - QUICK_LINKS must point only at real, registered routes (dead-link guard),
 *     expose unique hrefs (they double as React keys), resolve every `labelKey`
 *     in the i18n catalog (regression guard for the previously-missing
 *     `analytics.links.*` block that fell back to raw "compare"/"weeklyDigest"),
 *     and carry decorative, `aria-hidden` icons sized `h-4 w-4`.
 */
import { describe, it, expect } from 'vitest';
import { isValidElement } from 'react';
import { render } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';

import { TAB_KEYS, PIE_COLORS, QUICK_LINKS, type TabKey, type FleetAnalyticsQuery } from './constants';
import { CHART_COLORS } from '@/lib/colors';
import { ROUTE_REGISTRY } from '@/lib/routeRegistry';
import type { FleetAnalytics } from '@/api/types';
import en from '@/i18n/en.json';

const HEX6 = /^#[0-9a-f]{6}$/i;

/** Walk a dotted i18n key against the English catalog, mirroring how i18next
 *  resolves nested namespaces. Returns the leaf value or `undefined`. */
function resolveI18nKey(key: string): unknown {
  const catalog = en as unknown as Record<string, unknown>;
  return key.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
      return (node as Record<string, unknown>)[part];
    }
    return undefined;
  }, catalog);
}

describe('TAB_KEYS / TabKey', () => {
  it('exposes exactly the four analytics tabs in canonical order', () => {
    expect(TAB_KEYS).toEqual(['overview', 'driving', 'charging', 'battery']);
    expect(TAB_KEYS).toHaveLength(4);
  });

  it('contains no duplicate keys', () => {
    expect(new Set(TAB_KEYS).size).toBe(TAB_KEYS.length);
  });

  it('backs every tab with an `analytics.<tab>` i18n namespace', () => {
    for (const key of TAB_KEYS) {
      const namespace = resolveI18nKey(`analytics.${key}`);
      expect(namespace, `missing analytics.${key} namespace`).toBeTypeOf('object');
    }
  });

  it('derives a closed TabKey union from the tuple', () => {
    const overview: TabKey = 'overview';
    expect(TAB_KEYS).toContain(overview);

    // @ts-expect-error 'settings' is not a member of the TabKey union — the
    // union must stay closed to the four analytics tabs.
    const invalid: TabKey = 'settings';
    expect(TAB_KEYS).not.toContain(invalid);
  });
});

describe('PIE_COLORS', () => {
  it('provides six colours', () => {
    expect(PIE_COLORS).toHaveLength(6);
  });

  it('is every entry a defined 6-digit hex string (no undefined holes)', () => {
    for (const color of PIE_COLORS) {
      expect(color).toBeDefined();
      expect(color).toMatch(HEX6);
    }
  });

  it('mirrors the first six entries of the CB-safe shared palette', () => {
    expect(PIE_COLORS).toEqual(CHART_COLORS.slice(0, 6));
  });

  it('has distinct slices so adjacent pie wedges never collide', () => {
    expect(new Set(PIE_COLORS).size).toBe(PIE_COLORS.length);
  });

  it('never yields undefined under the consumer cyclic-index pattern', () => {
    // Consumers paint slices with `PIE_COLORS[i % PIE_COLORS.length]` for an
    // arbitrary series length — walk past the array end to prove it wraps.
    for (let i = 0; i < PIE_COLORS.length * 2 + 1; i++) {
      const picked = PIE_COLORS[i % PIE_COLORS.length];
      expect(picked).toMatch(HEX6);
    }
  });
});

describe('QUICK_LINKS', () => {
  it('lists the five analytics quick links, in order', () => {
    expect(QUICK_LINKS).toHaveLength(5);
    expect(QUICK_LINKS.map((l) => l.href)).toEqual([
      '/statistics',
      '/period-compare',
      '/weekly-digest',
      '/mileage',
      '/timeline',
    ]);
  });

  it('gives every link a namespaced labelKey, an absolute href, and an icon element', () => {
    for (const link of QUICK_LINKS) {
      expect(link.labelKey).toMatch(/^analytics\.links\./);
      expect(link.href).toMatch(/^\//);
      expect(isValidElement(link.icon)).toBe(true);
    }
  });

  it('exposes unique hrefs (they double as React keys)', () => {
    const hrefs = QUICK_LINKS.map((l) => l.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('points only at routes registered in ROUTE_REGISTRY (dead-link guard)', () => {
    const registeredPaths = new Set(ROUTE_REGISTRY.map((r) => r.path));
    for (const link of QUICK_LINKS) {
      expect(registeredPaths.has(link.href), `unregistered route ${link.href}`).toBe(true);
    }
  });

  it('resolves every labelKey to a non-empty English string', () => {
    // Regression guard: the `analytics.links.*` block used to be absent, so the
    // consumer fell back to raw slugs ("compare", "weeklyDigest").
    for (const link of QUICK_LINKS) {
      const label = resolveI18nKey(link.labelKey);
      expect(label, `missing translation for ${link.labelKey}`).toBeTypeOf('string');
      expect((label as string).length).toBeGreaterThan(0);
    }
  });

  it('renders each icon as a decorative, correctly-sized SVG', () => {
    for (const link of QUICK_LINKS) {
      const { container, unmount } = render(link.icon);
      const svg = container.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg).toHaveClass('h-4', 'w-4');
      // Decorative: hidden from assistive tech since the visible text label
      // supplies the link's accessible name.
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      unmount();
    }
  });

  it('uses a visually distinct icon per link', () => {
    const shapes = QUICK_LINKS.map((link) => {
      const { container, unmount } = render(link.icon);
      const markup = container.innerHTML;
      unmount();
      return markup;
    });
    expect(new Set(shapes).size).toBe(QUICK_LINKS.length);
  });
});

describe('FleetAnalyticsQuery', () => {
  it('aliases a react-query result carrying FleetAnalytics data', () => {
    const data = { total_vehicles: 4, period_days: 30 } as unknown as FleetAnalytics;
    const query = {
      data,
      isSuccess: true,
      isError: false,
      isPending: false,
    } as unknown as FleetAnalyticsQuery;

    // Compile-time pin (checked by `tsc --noEmit`): the alias must be
    // bidirectionally assignable with UseQueryResult<FleetAnalytics>, so the
    // generic payload type stays FleetAnalytics.
    const asBase: UseQueryResult<FleetAnalytics> = query;
    const asAlias: FleetAnalyticsQuery = asBase;

    expect(asBase.isSuccess).toBe(true);
    expect(asBase.data?.total_vehicles).toBe(4);
    expect(asAlias.data?.period_days).toBe(30);
  });
});
