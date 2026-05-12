import { describe, it, expect } from 'vitest';
import {
  parseSearchQuery,
  matchesTokens,
  compareNumeric,
  parseDurationToken,
  matchesYmdPrefix,
} from '../searchQuery';

describe('parseSearchQuery', () => {
  it('returns an empty list for empty / whitespace input', () => {
    expect(parseSearchQuery('')).toEqual([]);
    expect(parseSearchQuery('   ')).toEqual([]);
  });

  it('parses bare words as text tokens', () => {
    expect(parseSearchQuery('Office')).toEqual([
      { kind: 'text', value: 'office' },
    ]);
  });

  it('parses key:value tokens with the default `=` operator', () => {
    expect(parseSearchQuery('score:D')).toEqual([
      { kind: 'kv', key: 'score', op: '=', value: 'D' },
    ]);
  });

  it('parses comparison operators on numeric tokens', () => {
    expect(parseSearchQuery('distance:>10')).toEqual([
      { kind: 'kv', key: 'distance', op: '>', value: '10' },
    ]);
    expect(parseSearchQuery('distance:>=10')).toEqual([
      { kind: 'kv', key: 'distance', op: '>=', value: '10' },
    ]);
    expect(parseSearchQuery('distance:<5.5')).toEqual([
      { kind: 'kv', key: 'distance', op: '<', value: '5.5' },
    ]);
  });

  it('combines kv tokens and bare words', () => {
    const tokens = parseSearchQuery('score:A Office');
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toEqual({ kind: 'kv', key: 'score', op: '=', value: 'A' });
    expect(tokens[1]).toEqual({ kind: 'text', value: 'office' });
  });

  it('preserves quoted phrases as a single text token', () => {
    expect(parseSearchQuery('"san francisco"')).toEqual([
      { kind: 'text', value: 'san francisco' },
    ]);
  });

  it('lowercases keys but preserves value casing', () => {
    expect(parseSearchQuery('SCORE:D')).toEqual([
      { kind: 'kv', key: 'score', op: '=', value: 'D' },
    ]);
  });
});

describe('matchesTokens', () => {
  type Row = { addr: string; grade: string; distance: number };
  const row: Row = { addr: 'NE 90th St, Kirkland', grade: 'D', distance: 29.1 };

  it('returns true for an empty token list', () => {
    expect(matchesTokens(row, [], { text: () => [] })).toBe(true);
  });

  it('matches a bare text token against the text fields', () => {
    const tokens = parseSearchQuery('kirkland');
    expect(matchesTokens(row, tokens, { text: (r) => [r.addr] })).toBe(true);
    expect(matchesTokens(row, parseSearchQuery('seattle'), { text: (r) => [r.addr] })).toBe(false);
  });

  it('matches a kv token via the registered handler', () => {
    const tokens = parseSearchQuery('score:D');
    expect(matchesTokens(row, tokens, {
      text: (r) => [r.addr],
      kv: { score: (r, t) => r.grade.toLowerCase() === t.value.toLowerCase() },
    })).toBe(true);

    expect(matchesTokens(row, parseSearchQuery('score:A'), {
      text: (r) => [r.addr],
      kv: { score: (r, t) => r.grade.toLowerCase() === t.value.toLowerCase() },
    })).toBe(false);
  });

  it('falls back to substring matching when the kv handler returns null', () => {
    // Handler returns null → token is treated as a literal substring.
    // For an unknown key, "foo:bar" should still match a row whose
    // addr field contains "foo:bar" (graceful degradation).
    const customRow = { addr: 'foo:bar baz' };
    expect(matchesTokens(customRow, parseSearchQuery('foo:bar'), {
      text: (r) => [r.addr],
    })).toBe(true);
  });

  it('combines tokens with AND', () => {
    const tokens = parseSearchQuery('kirkland score:D');
    expect(matchesTokens(row, tokens, {
      text: (r) => [r.addr],
      kv: { score: (r, t) => r.grade.toLowerCase() === t.value.toLowerCase() },
    })).toBe(true);

    const failing = parseSearchQuery('seattle score:D');
    expect(matchesTokens(row, failing, {
      text: (r) => [r.addr],
      kv: { score: (r, t) => r.grade.toLowerCase() === t.value.toLowerCase() },
    })).toBe(false);
  });
});

describe('parseDurationToken', () => {
  it.each([
    ['30',      30],
    ['30m',     30],
    ['1h',      60],
    ['1h30m',   90],
    ['1.5h',    90],
    ['2d',      2880],
    ['1d2h30m', 1590],
    ['90s',     1.5],
  ])('parses %s → %d minutes', (input, minutes) => {
    expect(parseDurationToken(input)).toBeCloseTo(minutes, 6);
  });

  it.each(['', '  ', 'foo', '1h2foo', 'h30m', '--'])(
    'returns null for invalid token %p',
    (s) => {
      expect(parseDurationToken(s)).toBeNull();
    },
  );

  it('is case-insensitive', () => {
    expect(parseDurationToken('1H30M')).toBe(90);
  });
});

describe('matchesYmdPrefix', () => {
  it.each([
    ['2026-04-15', '2026',       true],
    ['2026-04-15', '2026-04',    true],
    ['2026-04-15', '2026-04-15', true],
    ['2026-04-15', '2025',       false],
    ['2026-04-15', '2026-05',    false],
  ])('matchesYmdPrefix(%s, %s) === %s', (value, prefix, expected) => {
    expect(matchesYmdPrefix(value, prefix)).toBe(expected);
  });

  it('extracts the date part from an ISO timestamp', () => {
    expect(matchesYmdPrefix('2026-04-15T12:34:56Z', '2026-04')).toBe(true);
    expect(matchesYmdPrefix('2026-04-15T12:34:56Z', '2026-05')).toBe(false);
  });

  it('returns false for empty / missing input', () => {
    expect(matchesYmdPrefix('', '2026')).toBe(false);
    expect(matchesYmdPrefix(null, '2026')).toBe(false);
    expect(matchesYmdPrefix(undefined, '2026')).toBe(false);
    expect(matchesYmdPrefix('2026-04-15', '')).toBe(false);
  });
});

describe('compareNumeric', () => {
  it('handles each operator', () => {
    expect(compareNumeric(10, '>', 5)).toBe(true);
    expect(compareNumeric(5, '>', 10)).toBe(false);
    expect(compareNumeric(10, '>=', 10)).toBe(true);
    expect(compareNumeric(5, '<', 10)).toBe(true);
    expect(compareNumeric(10, '<=', 10)).toBe(true);
    expect(compareNumeric(10, '=', 10)).toBe(true);
    expect(compareNumeric(10, '=', 11)).toBe(false);
  });

  it('returns false for non-finite inputs', () => {
    expect(compareNumeric(NaN, '>', 0)).toBe(false);
    expect(compareNumeric(0, '>', NaN)).toBe(false);
    expect(compareNumeric(Infinity, '>', 0)).toBe(false);
  });
});
