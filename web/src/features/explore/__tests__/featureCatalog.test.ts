/**
 * Tests for the Feature Hub data layer.
 *
 * Asserts the catalog stays in sync with `navSections`:
 *   - Every visible sidebar entry has a description (no orphans).
 *   - Every description key matches a real navSections entry (no dangling
 *     descriptions that go nowhere).
 *   - Descriptions are short (≤ 90 chars) and non-empty.
 *   - The filter is AND-token and case-insensitive.
 *   - Grouping preserves navSections order.
 */
import { describe, expect, it } from 'vitest';
import { navSections } from '@/components/layout/Layout';
import {
  buildFeatureCatalog,
  filterFeatureCatalog,
  groupFeatureCatalog,
  __DESCRIPTIONS_FOR_TEST,
} from '../featureCatalog';

describe('featureCatalog', () => {
  it('builds an entry for every visible navSections item', () => {
    const catalog = buildFeatureCatalog();
    const expected = navSections.flatMap((s) => s.items.map((it) => it.to));
    expect(catalog.map((c) => c.to)).toEqual(expected);
  });

  it('every navSections route has a description (no orphan pages)', () => {
    const missing: string[] = [];
    for (const section of navSections) {
      for (const item of section.items) {
        if (!__DESCRIPTIONS_FOR_TEST[item.to]) {
          missing.push(`${section.title} → ${item.label} (${item.to})`);
        }
      }
    }
    expect(missing, `missing descriptions:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('every description key matches a real navSections route', () => {
    const routes = new Set(navSections.flatMap((s) => s.items.map((it) => it.to)));
    const dangling: string[] = [];
    for (const key of Object.keys(__DESCRIPTIONS_FOR_TEST)) {
      if (!routes.has(key)) dangling.push(key);
    }
    expect(dangling, `dangling description keys:\n  ${dangling.join('\n  ')}`).toEqual([]);
  });

  it('descriptions are short and non-empty', () => {
    const offenders: string[] = [];
    for (const [route, desc] of Object.entries(__DESCRIPTIONS_FOR_TEST)) {
      if (!desc.trim()) offenders.push(`${route}: empty`);
      if (desc.length > 90) offenders.push(`${route}: ${desc.length} chars`);
    }
    expect(offenders).toEqual([]);
  });

  describe('filterFeatureCatalog', () => {
    const catalog = buildFeatureCatalog();

    it('returns all entries for an empty query', () => {
      expect(filterFeatureCatalog(catalog, '').length).toBe(catalog.length);
      expect(filterFeatureCatalog(catalog, '   ').length).toBe(catalog.length);
    });

    it('matches case-insensitively against the label', () => {
      const out = filterFeatureCatalog(catalog, 'CHARGE');
      expect(out.some((e) => e.to === '/charging')).toBe(true);
    });

    it('matches against the description text', () => {
      const out = filterFeatureCatalog(catalog, 'supercharger');
      expect(out.length).toBeGreaterThan(0);
      // /charging description mentions Supercharger
      expect(out.some((e) => e.to === '/charging')).toBe(true);
    });

    it('describes the Action Center as a decision surface with evidence', () => {
      const out = filterFeatureCatalog(catalog, 'evidence confidence');
      expect(out.some((entry) => entry.to === '/action-center')).toBe(true);
    });

    it('matches against the section title', () => {
      const out = filterFeatureCatalog(catalog, 'Diagnostics');
      expect(out.every((e) => e.section === 'Diagnostics')).toBe(true);
      expect(out.length).toBeGreaterThan(0);
    });

    it('uses AND-token matching across multiple words', () => {
      // "tire" matches /tire-pressure; "pressure" also matches. Both
      // tokens must be present in the haystack — partial-only matches
      // get filtered out.
      const out = filterFeatureCatalog(catalog, 'tire pressure');
      expect(out.some((e) => e.to === '/tire-pressure')).toBe(true);
      // Bogus combination → empty result.
      expect(filterFeatureCatalog(catalog, 'tire dlq').length).toBe(0);
    });

    it('returns empty for a clearly absent term', () => {
      expect(filterFeatureCatalog(catalog, 'zzznotarealthing').length).toBe(0);
    });
  });

  describe('groupFeatureCatalog', () => {
    it('preserves navSections order', () => {
      const grouped = groupFeatureCatalog(buildFeatureCatalog());
      const sectionOrder = grouped.map((g) => g.section);
      const expected = navSections
        .map((s) => s.title)
        .filter((t) => sectionOrder.includes(t));
      expect(sectionOrder).toEqual(expected);
    });

    it('places each entry in exactly one group', () => {
      const grouped = groupFeatureCatalog(buildFeatureCatalog());
      const totalGrouped = grouped.reduce((n, g) => n + g.entries.length, 0);
      expect(totalGrouped).toBe(buildFeatureCatalog().length);
    });

    it('skips empty sections after filtering', () => {
      const catalog = buildFeatureCatalog();
      const filtered = filterFeatureCatalog(catalog, 'supercharger');
      const grouped = groupFeatureCatalog(filtered);
      // Every returned group has at least one entry.
      for (const g of grouped) {
        expect(g.entries.length).toBeGreaterThan(0);
      }
    });
  });
});
