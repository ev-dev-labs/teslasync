/**
 * searchIndex — settings find-as-you-type index + matcher.
 *
 * The module has three runtime exports, tested here end to end:
 *   1. `fuzzyMatch`     — case-insensitive, order-preserving subsequence test.
 *   2. `getSettingsIndex` — builds the canonical, translated entry list from a
 *      caller-supplied `t`. We pin its structural invariants (unique ids,
 *      well-formed hrefs, non-empty copy) and its translator contract.
 *   3. `searchSettings` — scores + ranks entries against a query. We verify the
 *      full priority ladder (exact > prefix > substring > keyword > description
 *      > fuzzy-title > fuzzy-description) with a synthetic index, the tie-break
 *      stability, and real-index smoke behaviour.
 *
 * The matcher takes its translator as a parameter and touches no network / DOM,
 * so a spyable fake `t` exercises every branch — no MSW / react-i18next needed.
 */
import { describe, it, expect, vi } from 'vitest';
import type { TFunction } from 'i18next';

import { fuzzyMatch, getSettingsIndex, searchSettings, type SettingsEntry } from './searchIndex';

/** Production happy path: a translator that echoes the English default. */
const passthrough = ((_key: string, defaultValue: string) => defaultValue) as unknown as TFunction;

/** The real, fully-populated index used across the smoke-level assertions. */
const realIndex = getSettingsIndex(passthrough);

/**
 * Build a minimal SettingsEntry, letting each test override only the facet
 * under test. Cast at the boundary so we can also inject deliberately
 * malformed (missing-field) rows for the null-safety checks.
 */
function entry(overrides: Partial<SettingsEntry>): SettingsEntry {
  return {
    id: 'x',
    href: '/x',
    section: 's',
    title: 'unrelated',
    description: 'nothing here',
    ...overrides,
  };
}

describe('fuzzyMatch', () => {
  it('matches when every needle char appears in order', () => {
    expect(fuzzyMatch('lng', 'Language')).toBe(true);
    expect(fuzzyMatch('thm', 'Theme')).toBe(true);
    expect(fuzzyMatch('cur', 'Currency')).toBe(true);
  });

  it('rejects out-of-order and missing characters', () => {
    expect(fuzzyMatch('eag', 'Language')).toBe(false); // 'a' before 'e' fails
    expect(fuzzyMatch('xyz', 'Language')).toBe(false); // none present
  });

  it('is case-insensitive in both directions', () => {
    expect(fuzzyMatch('LNG', 'Language')).toBe(true);
    expect(fuzzyMatch('lng', 'LANGUAGE')).toBe(true);
  });

  it('consumes each haystack character at most once', () => {
    // Only one 'a' in the haystack, so a two-'a' needle cannot be satisfied.
    expect(fuzzyMatch('aa', 'a')).toBe(false);
    expect(fuzzyMatch('aa', 'aa')).toBe(true);
    expect(fuzzyMatch('abc', 'abc')).toBe(true); // full equality is a subsequence
  });

  it('never matches an empty needle and never crashes on empty/nullish input', () => {
    expect(fuzzyMatch('', 'anything')).toBe(false);
    expect(fuzzyMatch('x', '')).toBe(false);
    expect(fuzzyMatch(undefined as unknown as string, 'x')).toBe(false);
    expect(fuzzyMatch('x', undefined as unknown as string)).toBe(false);
  });
});

describe('getSettingsIndex — structural invariants', () => {
  it('returns a non-empty list of fully-shaped entries', () => {
    expect(realIndex.length).toBeGreaterThan(20);
    for (const e of realIndex) {
      expect(typeof e.id).toBe('string');
      expect(e.id.length).toBeGreaterThan(0);
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.description.length).toBeGreaterThan(0);
      expect(e.section.length).toBeGreaterThan(0);
    }
  });

  it('assigns a unique id to every entry (React key / analytics safety)', () => {
    const ids = realIndex.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every entry an absolute href', () => {
    for (const e of realIndex) {
      expect(e.href.startsWith('/')).toBe(true);
    }
  });

  it('only ever carries non-empty keyword arrays when present', () => {
    for (const e of realIndex) {
      if (e.keywords === undefined) continue;
      expect(Array.isArray(e.keywords)).toBe(true);
      expect(e.keywords.length).toBeGreaterThan(0);
      for (const k of e.keywords) {
        expect(typeof k).toBe('string');
        expect(k.length).toBeGreaterThan(0);
      }
    }
  });

  it('returns a fresh array on each call (safe for callers to memoise/mutate)', () => {
    expect(getSettingsIndex(passthrough)).not.toBe(getSettingsIndex(passthrough));
  });
});

describe('getSettingsIndex — translator contract', () => {
  it('requests the exact i18n key + English default for each field', () => {
    const t = vi.fn((_k: string, d: string) => d);
    getSettingsIndex(t as unknown as TFunction);

    expect(t).toHaveBeenCalledWith('search.entries.appearance.theme.title', 'Theme');
    expect(t).toHaveBeenCalledWith('search.entries.general.language.title', 'Language');
    expect(t).toHaveBeenCalledWith('search.entries.general.pressure.title', 'Tire pressure unit');
  });

  it('calls the translator exactly twice per entry (title + description)', () => {
    const t = vi.fn((_k: string, d: string) => d);
    const entries = getSettingsIndex(t as unknown as TFunction);
    expect(t.mock.calls.length).toBe(entries.length * 2);
  });

  it('passes the translated string through verbatim (localization actually happens)', () => {
    const fr: Record<string, string> = {
      'search.entries.appearance.theme.title': 'Thème',
      'search.entries.general.language.title': 'Langue',
    };
    const t = ((key: string, d: string) => fr[key] ?? d) as unknown as TFunction;

    const entries = getSettingsIndex(t);
    expect(entries.find((e) => e.id === 'appearance.theme')?.title).toBe('Thème');
    expect(entries.find((e) => e.id === 'general.language')?.title).toBe('Langue');
    // A non-overridden entry keeps its English default.
    expect(entries.find((e) => e.id === 'general.currency')?.title).toBe('Currency');
  });
});

describe('searchSettings — query short-circuit', () => {
  it('returns nothing for empty or whitespace-only queries', () => {
    expect(searchSettings(realIndex, '')).toEqual([]);
    expect(searchSettings(realIndex, '   ')).toEqual([]);
  });

  it('returns nothing when no entry matches at any tier', () => {
    // 'q','z','x','j','w' never occur in this order in any title/description.
    expect(searchSettings(realIndex, 'qzxjw')).toEqual([]);
  });
});

describe('searchSettings — scoring ladder', () => {
  // One entry per tier for the query 'zap'. Each is crafted to hit exactly one
  // branch so the returned order pins the entire priority ladder in one shot.
  const synthetic: SettingsEntry[] = [
    entry({ id: 'exact', title: 'zap' }), //                     1000: title === q
    entry({ id: 'prefix', title: 'zapper tool' }), //             800: startsWith
    entry({ id: 'substr', title: 'the zap switch' }), //          600: includes
    entry({ id: 'keyword', title: 'quiet mode', keywords: ['zap'] }), // 400: keyword
    entry({ id: 'desc', title: 'quiet mode', description: 'contains zap inline' }), // 300: desc
    entry({ id: 'fuzzyTitle', title: 'z-a-p bolt' }), //          200: fuzzy title only
    entry({ id: 'fuzzyDesc', title: 'quiet mode', description: 'z and a plus more' }), // 100: fuzzy desc
    entry({ id: 'miss', title: 'nothing', description: 'unrelated' }), // no match, dropped
  ];

  it('ranks every tier strictly above the next, highest first', () => {
    const ordered = searchSettings(synthetic, 'zap').map((e) => e.id);
    expect(ordered).toEqual([
      'exact',
      'prefix',
      'substr',
      'keyword',
      'desc',
      'fuzzyTitle',
      'fuzzyDesc',
    ]);
  });

  it('drops entries that match no tier', () => {
    const ids = searchSettings(synthetic, 'zap').map((e) => e.id);
    expect(ids).not.toContain('miss');
  });

  it('matches keywords by substring, case-insensitively', () => {
    const idx = [entry({ id: 'kw', title: 'nope', keywords: ['Diagnostics'] })];
    // Query is a substring of the keyword, and casing differs.
    expect(searchSettings(idx, 'agno').map((e) => e.id)).toEqual(['kw']);
  });

  it('is case-insensitive on the query itself', () => {
    expect(searchSettings(synthetic, 'ZAP').map((e) => e.id)[0]).toBe('exact');
  });

  it('only ever returns entries drawn from the supplied index', () => {
    const results = searchSettings(synthetic, 'zap');
    for (const r of results) {
      expect(synthetic).toContain(r);
    }
  });
});

describe('searchSettings — tie-break stability', () => {
  it('preserves original index order when two entries share a score', () => {
    const idx: SettingsEntry[] = [
      entry({ id: 'first', title: 'reset alpha' }),
      entry({ id: 'second', title: 'reset beta' }),
    ];
    // Both start with 'reset' → identical 800 score → stable input order.
    expect(searchSettings(idx, 'reset').map((e) => e.id)).toEqual(['first', 'second']);
  });

  it('keeps the real index deterministic for a shared-prefix query', () => {
    const ids = searchSettings(realIndex, 'reset').map((e) => e.id);
    // reset.section is declared before reset.all; both title-prefix-match.
    expect(ids.indexOf('reset.section')).toBeLessThan(ids.indexOf('reset.all'));
    expect(ids.indexOf('reset.section')).toBeGreaterThanOrEqual(0);
  });
});

describe('searchSettings — real index smoke matches', () => {
  it('ranks the exact-title hit "Theme" first', () => {
    const results = searchSettings(realIndex, 'theme');
    expect(results[0]?.id).toBe('appearance.theme');
  });

  it('surfaces the tire-pressure entry from the "psi" keyword', () => {
    const ids = searchSettings(realIndex, 'psi').map((e) => e.id);
    expect(ids).toContain('general.units.pressure');
  });

  it('fuzzy-matches "lng" to the Language entry', () => {
    const titles = searchSettings(realIndex, 'lng').map((e) => e.title);
    expect(titles).toContain('Language');
  });

  it('matches a description-only phrase and ranks it above fuzzy noise', () => {
    // "base url" appears only in the Region entry's description.
    expect(searchSettings(realIndex, 'base url')[0]?.id).toBe('region.fleet-api');
  });
});

describe('searchSettings — null safety on malformed input', () => {
  it('treats a nullish query or index as an empty search rather than throwing', () => {
    expect(searchSettings(realIndex, null as unknown as string)).toEqual([]);
    expect(searchSettings(realIndex, undefined as unknown as string)).toEqual([]);
    expect(searchSettings(undefined as unknown as SettingsEntry[], 'zap')).toEqual([]);
  });

  it('does not crash when an entry is missing its title or description', () => {
    const malformed = [
      { id: 'no-title', href: '/a', section: 's', description: 'has zap only' },
      { id: 'no-desc', href: '/b', section: 's', title: 'zap header' },
    ] as unknown as SettingsEntry[];

    let ids: string[] = [];
    expect(() => {
      ids = searchSettings(malformed, 'zap').map((e) => e.id);
    }).not.toThrow();
    // The entry whose surviving field matches is still returned.
    expect(ids).toContain('no-desc');
    expect(ids).toContain('no-title');
  });
});
