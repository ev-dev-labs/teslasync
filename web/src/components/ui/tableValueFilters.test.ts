import { describe, expect, it } from 'vitest';
import { buildTableFilterValues, compactTableValueSelection, matchesTableValueSelection, parseTableValueSelections, selectedTableValueKeys, tableValueKey } from './tableValueFilters';

describe('canonical table value filters', () => {
  it('distinguishes types, unknown, and zero without display-unit keys', () => {
    expect([null, 0, false, '0'].map(tableValueKey)).toEqual(['null', '0', 'false', '"0"']);
    expect(parseTableValueSelections('{"status":["false","null","0"]}', ['status']))
      .toEqual({ selections: { status: ['false', 'null', '0'] }, invalid: false });
  });

  it.each(['{broken', 'null', '[]', '{"unknown":[]}', '{"status":["NaN"]}',
    '{"status":["{}"]}', '{"status":[" 0"]}', '{"status":{"excluded":[],"extra":true}}'])(
    'explicitly rejects invalid saved state %s', raw => {
      expect(parseTableValueSelections(raw, ['status']).invalid).toBe(true);
    },
  );

  it('preserves all, none, exclusions, and unavailable explicit inclusions', () => {
    expect(matchesTableValueSelection(12)).toBe(true);
    expect(matchesTableValueSelection(12, [])).toBe(false);
    expect(matchesTableValueSelection(12, { excluded: ['12'] })).toBe(false);
    expect(matchesTableValueSelection(13, { excluded: ['12'] })).toBe(true);
    expect(selectedTableValueKeys(['99'], ['12'])).toEqual(['99']);
    expect(selectedTableValueKeys({ excluded: ['12'] }, ['12', '13'])).toEqual(['13']);
    expect(selectedTableValueKeys(undefined, ['12'])).toBeNull();
    expect(compactTableValueSelection([], ['12', '13'])).toEqual([]);
    expect(compactTableValueSelection(['99'], ['12', '13'])).toEqual(['99']);
    const available = Array.from({ length: 1000 }, (_, i) => String(i));
    expect(compactTableValueSelection(available.slice(1), available)).toEqual({ excluded: ['0'] });
  });

  it('groups display-equivalent canonical values and counts occurrences, not distinct keys', () => {
    const values = buildTableFilterValues([40001, 40002, 40001, null], row => row,
      value => value == null ? 'Unknown' : `${Math.round(value / 1000)} km`);
    expect(values).toEqual([
      { value: '[false,"40 km"]', label: '40 km', count: 3, keys: ['40001', '40002'], sortValue: 40001 },
      { value: '[true,"Unknown"]', label: 'Unknown', count: 1, keys: ['null'], sortValue: null },
    ]);
    expect(buildTableFilterValues([false, true], row => row, value => String(value))
      .flatMap(option => option.keys)).toEqual(['false', 'true']);
  });

  it('never merges an unknown reading with a recorded value even when labels collide', () => {
    const options = buildTableFilterValues([null, 0, null], row => row, () => '0');
    expect(options).toHaveLength(2);
    expect(options.map(option => option.keys)).toEqual([['0'], ['null']]);
    expect(options.map(option => option.count)).toEqual([1, 2]);
    expect(new Set(options.map(option => option.value)).size).toBe(2);
  });
});
