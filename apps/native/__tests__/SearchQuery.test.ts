import {
  compareNumeric,
  matchesTokens,
  matchesYmdPrefix,
  parseDurationToken,
  parseSearchQuery,
  type KvToken,
  type SearchToken,
} from '../src/web-parity/lib/searchQuery';

describe('web-parity searchQuery', () => {
  describe('parseSearchQuery', () => {
    it('returns an empty list for empty / whitespace input', () => {
      expect(parseSearchQuery('')).toEqual([]);
      expect(parseSearchQuery('   ')).toEqual([]);
      expect(parseSearchQuery('\t \n')).toEqual([]);
    });

    it('parses a bare key:value as an `=` kv token (key lowercased)', () => {
      expect(parseSearchQuery('Score:D')).toEqual([
        {kind: 'kv', key: 'score', op: '=', value: 'D'},
      ]);
    });

    it('parses each comparison operator', () => {
      const ops: Array<[string, string]> = [
        ['distance:>10', '>'],
        ['distance:>=10', '>='],
        ['distance:<10', '<'],
        ['distance:<=10', '<='],
        ['distance:=10', '='],
      ];
      for (const [input, op] of ops) {
        expect(parseSearchQuery(input)).toEqual([
          {kind: 'kv', key: 'distance', op, value: '10'},
        ]);
      }
    });

    it('treats a non-structured token as lowercased free text', () => {
      expect(parseSearchQuery('Office')).toEqual([
        {kind: 'text', value: 'office'},
      ]);
    });

    it('combines kv and text tokens (AND semantics) in order', () => {
      expect(parseSearchQuery('score:A Office')).toEqual([
        {kind: 'kv', key: 'score', op: '=', value: 'A'},
        {kind: 'text', value: 'office'},
      ]);
    });

    it('keeps quoted phrases (with spaces) as a single text token', () => {
      expect(parseSearchQuery('"san francisco"')).toEqual([
        {kind: 'text', value: 'san francisco'},
      ]);
    });

    it('keeps an empty value when only the operator is typed', () => {
      expect(parseSearchQuery('score:')).toEqual([
        {kind: 'kv', key: 'score', op: '=', value: ''},
      ]);
    });

    it('falls through digit-led pseudo-keys to free text', () => {
      // KV_RE requires the key to start with a letter, so "1h:foo" is text.
      expect(parseSearchQuery('1h:foo')).toEqual([
        {kind: 'text', value: '1h:foo'},
      ]);
    });
  });

  describe('matchesTokens', () => {
    interface Row {
      name: string;
      distance: number;
    }
    const row: Row = {name: 'Office Garage', distance: 12};
    const opts = {
      text: (r: Row) => [r.name],
      kv: {
        distance: (r: Row, t: KvToken) =>
          compareNumeric(r.distance, t.op, Number(t.value)),
      },
    };

    it('matches everything when there are no tokens', () => {
      expect(matchesTokens(row, [], opts)).toBe(true);
    });

    it('matches a case-insensitive free-text substring', () => {
      expect(matchesTokens(row, parseSearchQuery('office'), opts)).toBe(true);
      expect(matchesTokens(row, parseSearchQuery('warehouse'), opts)).toBe(
        false,
      );
    });

    it('applies a registered kv handler', () => {
      expect(matchesTokens(row, parseSearchQuery('distance:>10'), opts)).toBe(
        true,
      );
      expect(matchesTokens(row, parseSearchQuery('distance:>20'), opts)).toBe(
        false,
      );
    });

    it('requires ALL tokens to match (AND)', () => {
      expect(
        matchesTokens(row, parseSearchQuery('office distance:>10'), opts),
      ).toBe(true);
      expect(
        matchesTokens(row, parseSearchQuery('office distance:>50'), opts),
      ).toBe(false);
    });

    it('falls through to substring when the handler returns null', () => {
      const passthrough = {
        text: (r: Row) => [r.name],
        kv: {distance: () => null as boolean | null},
      };
      // handler yields null → literal "distance:5" is searched in name → no match
      expect(
        matchesTokens(row, parseSearchQuery('distance:5'), passthrough),
      ).toBe(false);
    });

    it('treats an unhandled key as a literal substring search', () => {
      const literalRow: Row = {name: 'addr:home base', distance: 1};
      const tokens: SearchToken[] = parseSearchQuery('addr:home');
      expect(matchesTokens(literalRow, tokens, opts)).toBe(true);
      expect(matchesTokens(row, tokens, opts)).toBe(false);
    });

    it('coerces null / undefined text fields without throwing', () => {
      const sparse = {name: '', distance: 0} as Row;
      const sparseOpts = {
        text: () => [null, undefined, 'Hello'] as Array<
          string | null | undefined
        >,
      };
      expect(matchesTokens(sparse, parseSearchQuery('hello'), sparseOpts)).toBe(
        true,
      );
    });
  });

  describe('compareNumeric', () => {
    it('evaluates every operator', () => {
      expect(compareNumeric(5, '>', 3)).toBe(true);
      expect(compareNumeric(5, '>', 5)).toBe(false);
      expect(compareNumeric(5, '>=', 5)).toBe(true);
      expect(compareNumeric(2, '<', 3)).toBe(true);
      expect(compareNumeric(3, '<=', 3)).toBe(true);
      expect(compareNumeric(3, '=', 3)).toBe(true);
    });

    it('uses an epsilon for equality', () => {
      expect(compareNumeric(1.0, '=', 1.0 + 1e-12)).toBe(true);
      expect(compareNumeric(1.0, '=', 1.1)).toBe(false);
    });

    it('returns false for non-finite inputs', () => {
      expect(compareNumeric(NaN, '>', 1)).toBe(false);
      expect(compareNumeric(1, '>', Infinity)).toBe(false);
      expect(compareNumeric(NaN, '=', NaN)).toBe(false);
    });
  });

  describe('parseDurationToken', () => {
    it('parses a bare number as minutes', () => {
      expect(parseDurationToken('30')).toBe(30);
      expect(parseDurationToken('1.5')).toBe(1.5);
    });

    it('parses unit shorthand and combinations', () => {
      expect(parseDurationToken('30m')).toBe(30);
      expect(parseDurationToken('1h')).toBe(60);
      expect(parseDurationToken('1h30m')).toBe(90);
      expect(parseDurationToken('1.5h')).toBe(90);
      expect(parseDurationToken('2d')).toBe(2880);
      expect(parseDurationToken('1d2h30m')).toBe(1590);
      expect(parseDurationToken('90s')).toBe(1.5);
    });

    it('returns null for empty / unparseable input', () => {
      expect(parseDurationToken('')).toBeNull();
      expect(parseDurationToken('   ')).toBeNull();
      expect(parseDurationToken('later')).toBeNull();
    });

    it('rejects tokens with trailing junk after the last unit', () => {
      expect(parseDurationToken('1h2foo')).toBeNull();
    });
  });

  describe('matchesYmdPrefix', () => {
    it('matches year / year-month / full-date prefixes', () => {
      expect(matchesYmdPrefix('2026-04-15', '2026')).toBe(true);
      expect(matchesYmdPrefix('2026-04-15', '2026-04')).toBe(true);
      expect(matchesYmdPrefix('2026-04-15', '2026-04-15')).toBe(true);
    });

    it('truncates an ISO timestamp to YYYY-MM-DD before comparing', () => {
      expect(matchesYmdPrefix('2026-04-15T08:30:00Z', '2026-04-15')).toBe(true);
    });

    it('returns false for a non-matching prefix', () => {
      expect(matchesYmdPrefix('2026-04-15', '2025')).toBe(false);
    });

    it('returns false for empty / nullish input', () => {
      expect(matchesYmdPrefix('', '2026')).toBe(false);
      expect(matchesYmdPrefix(null, '2026')).toBe(false);
      expect(matchesYmdPrefix(undefined, '2026')).toBe(false);
      expect(matchesYmdPrefix('2026-04-15', '')).toBe(false);
    });
  });
});
