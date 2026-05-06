import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  recordSearch,
  getRecentSearches,
  removeSearch,
  clearScope,
  _resetSearchHistory,
  CAP,
} from '../searchHistory';

const STORAGE_KEY = 'teslasync:search-history:v1';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('searchHistory', () => {
  it('returns [] for an unknown scope', () => {
    expect(getRecentSearches('drives')).toEqual([]);
  });

  it('record then get round-trips the original query', () => {
    recordSearch('drives', 'M3 sport');
    expect(getRecentSearches('drives')).toEqual(['M3 sport']);
  });

  it('persists under the v1 key', () => {
    recordSearch('drives', 'foo bar');
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.scopes.drives).toBeDefined();
    expect(parsed.scopes.drives[0].q).toBe('foo bar');
    expect(typeof parsed.scopes.drives[0].ts).toBe('number');
  });

  it('trims whitespace before storing', () => {
    recordSearch('drives', '   spaced out   ');
    expect(getRecentSearches('drives')).toEqual(['spaced out']);
  });

  it('ignores empty queries', () => {
    recordSearch('drives', '');
    recordSearch('drives', '     ');
    expect(getRecentSearches('drives')).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('ignores queries shorter than MIN_QUERY_LEN (2 chars)', () => {
    recordSearch('drives', 'a');
    recordSearch('drives', '  b  ');
    expect(getRecentSearches('drives')).toEqual([]);
  });

  it('records 2-character queries (boundary)', () => {
    recordSearch('drives', 'ab');
    expect(getRecentSearches('drives')).toEqual(['ab']);
  });

  it('newest entry is on top', () => {
    recordSearch('drives', 'first');
    recordSearch('drives', 'second');
    recordSearch('drives', 'third');
    expect(getRecentSearches('drives')).toEqual(['third', 'second', 'first']);
  });

  it('de-dupes case-insensitively, newest casing wins', () => {
    recordSearch('drives', 'foo');
    recordSearch('drives', 'bar');
    recordSearch('drives', 'FOO');
    // 'FOO' should replace 'foo' and move to the top.
    expect(getRecentSearches('drives')).toEqual(['FOO', 'bar']);
  });

  it(`caps a single scope at CAP (${CAP}) entries with FIFO eviction`, () => {
    for (let i = 0; i < CAP + 5; i++) {
      recordSearch('drives', `query ${i}`);
    }
    const list = getRecentSearches('drives', CAP + 5);
    expect(list).toHaveLength(CAP);
    expect(list[0]).toBe(`query ${CAP + 4}`);
    expect(list[CAP - 1]).toBe(`query ${5}`);
  });

  it('separate scopes do not bleed', () => {
    recordSearch('drives', 'drive query');
    recordSearch('charging', 'charge query');
    expect(getRecentSearches('drives')).toEqual(['drive query']);
    expect(getRecentSearches('charging')).toEqual(['charge query']);
  });

  it('getRecentSearches respects the max parameter', () => {
    recordSearch('drives', 'one');
    recordSearch('drives', 'two');
    recordSearch('drives', 'three');
    expect(getRecentSearches('drives', 2)).toEqual(['three', 'two']);
  });

  it('getRecentSearches default cap is 8', () => {
    for (let i = 0; i < 10; i++) {
      recordSearch('drives', `q${i}`);
    }
    expect(getRecentSearches('drives')).toHaveLength(8);
  });

  it('removeSearch drops a single entry case-insensitively', () => {
    recordSearch('drives', 'alpha');
    recordSearch('drives', 'beta');
    recordSearch('drives', 'gamma');
    removeSearch('drives', 'BETA');
    expect(getRecentSearches('drives')).toEqual(['gamma', 'alpha']);
  });

  it('removeSearch is a no-op for unknown queries', () => {
    recordSearch('drives', 'alpha');
    removeSearch('drives', 'nope');
    expect(getRecentSearches('drives')).toEqual(['alpha']);
  });

  it('removeSearch is a no-op for unknown scopes', () => {
    removeSearch('ghost', 'anything');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('clearScope only clears the named scope', () => {
    recordSearch('drives', 'drive query');
    recordSearch('charging', 'charge query');
    clearScope('drives');
    expect(getRecentSearches('drives')).toEqual([]);
    expect(getRecentSearches('charging')).toEqual(['charge query']);
  });

  it('clearScope is a no-op for unknown scope', () => {
    recordSearch('drives', 'drive query');
    clearScope('does-not-exist');
    expect(getRecentSearches('drives')).toEqual(['drive query']);
  });

  it('_resetSearchHistory removes the entire storage key', () => {
    recordSearch('drives', 'foo');
    recordSearch('charging', 'bar');
    _resetSearchHistory();
    expect(getRecentSearches('drives')).toEqual([]);
    expect(getRecentSearches('charging')).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('survives malformed JSON in storage', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json{');
    expect(getRecentSearches('drives')).toEqual([]);
    // Subsequent recording recovers
    recordSearch('drives', 'recovered');
    expect(getRecentSearches('drives')).toEqual(['recovered']);
  });

  it('survives a non-object payload in storage', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['not', 'an', 'object']));
    expect(getRecentSearches('drives')).toEqual([]);
  });

  it('ignores non-array scope values when loading', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ scopes: { drives: 'not an array', valid: [{ q: 'ok', ts: 123 }] } }),
    );
    expect(getRecentSearches('drives')).toEqual([]);
    expect(getRecentSearches('valid')).toEqual(['ok']);
  });

  it('filters out malformed individual entries on load', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        scopes: {
          drives: [
            { q: 'good', ts: 123 },
            { q: '', ts: 456 },          // empty string rejected
            { q: 'no-ts' },              // missing ts rejected
            { q: 'nan-ts', ts: NaN },    // NaN rejected
            'oops',                      // not an object rejected
            { q: 'also-good', ts: 789 },
          ],
        },
      }),
    );
    expect(getRecentSearches('drives')).toEqual(['good', 'also-good']);
  });

  it('ignores recordSearch with empty scope', () => {
    recordSearch('', 'something');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('ignores getRecentSearches with empty scope', () => {
    recordSearch('drives', 'something');
    expect(getRecentSearches('')).toEqual([]);
  });

  it('removeSearch ignores whitespace-only query', () => {
    recordSearch('drives', 'alpha');
    removeSearch('drives', '   ');
    expect(getRecentSearches('drives')).toEqual(['alpha']);
  });
});
