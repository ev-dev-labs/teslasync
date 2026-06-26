import React, {useState} from 'react';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

// useQuery is mocked so SignalMultiSelect resolves its available-signals list
// synchronously without a QueryClientProvider or any network/fetch (keeps the
// suite deterministic + free of open handles).
let mockAvailableSignals: string[] | undefined = [];
jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({data: mockAvailableSignals}),
}));

import {
  DateTimeRangeControls,
  PAGE_SIZES,
  QueryControls,
  SignalDataTable,
  SignalMultiSelect,
  TIME_RANGE_PRESETS,
  TYPE_BADGE_COLOR,
  TYPE_VALUE_COLOR,
  adaptSignalHistoryPoint,
  adaptSignalHistoryResp,
  formatTimestampMs,
  formatValue,
  getValueType,
  matchTimeRangePreset,
  toLocalDatetimeStr,
  type SignalLogEntry,
} from '../src/web-parity/components/SignalQueryControls';
import type {SignalHistoryResp} from '../src/web-parity/api/types';

type Renderer = ReactTestRenderer.ReactTestRenderer;

function countHost(tree: Renderer, testID: string): number {
  return tree.root.findAll(
    (node: ReactTestInstance) =>
      typeof node.type === 'string' && node.props.testID === testID,
  ).length;
}

function callProp(
  tree: Renderer,
  testID: string,
  prop: string,
  ...args: unknown[]
): void {
  const target = tree.root.find(
    (node: ReactTestInstance) =>
      node.props.testID === testID && typeof node.props[prop] === 'function',
  );
  ReactTestRenderer.act(() => {
    target.props[prop](...args);
  });
}

function render(element: React.ReactElement): Renderer {
  let tree: Renderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(element);
  });
  return tree!;
}

/* ── pure helpers ── */

test('adaptSignalHistoryPoint routes each value type into the legacy shape', () => {
  expect(adaptSignalHistoryPoint({ts: 't', kind: 'k', value: 42}, 'sig')).toEqual(
    {created_at: 't', signal: 'sig', value_num: 42, value_str: null, value_bool: null},
  );
  expect(
    adaptSignalHistoryPoint({ts: 't', kind: 'k', value: true}, 'sig'),
  ).toEqual({created_at: 't', signal: 'sig', value_num: null, value_str: null, value_bool: true});
  expect(
    adaptSignalHistoryPoint({ts: 't', kind: 'k', value: 'hi'}, 'sig'),
  ).toEqual({created_at: 't', signal: 'sig', value_num: null, value_str: 'hi', value_bool: null});
  expect(
    adaptSignalHistoryPoint({ts: 't', kind: 'k', value: null}, 'sig'),
  ).toEqual({created_at: 't', signal: 'sig', value_num: null, value_str: null, value_bool: null});
  // Non-finite numbers are nulled out.
  expect(
    adaptSignalHistoryPoint({ts: 't', kind: 'k', value: Infinity}, 'sig').value_num,
  ).toBeNull();
});

test('adaptSignalHistoryResp maps rows and guards a missing payload', () => {
  const resp: SignalHistoryResp = {
    vehicle_id: 1,
    signal: 'battery',
    count: 2,
    data: [
      {ts: 'a', kind: 'k', value: 1},
      {ts: 'b', kind: 'k', value: 'x'},
    ],
  };
  const rows = adaptSignalHistoryResp(resp);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({created_at: 'a', signal: 'battery', value_num: 1});
  expect(rows[1]).toMatchObject({created_at: 'b', signal: 'battery', value_str: 'x'});
  expect(adaptSignalHistoryResp(null)).toEqual([]);
  expect(adaptSignalHistoryResp(undefined)).toEqual([]);
});

test('toLocalDatetimeStr zero-pads to second precision', () => {
  const d = new Date(2024, 0, 5, 3, 7, 9);
  expect(toLocalDatetimeStr(d)).toBe('2024-01-05T03:07:09');
});

test('formatTimestampMs renders millis and guards invalid input', () => {
  const d = new Date(2024, 0, 5, 3, 7, 9, 12);
  expect(formatTimestampMs(d.toISOString())).toBe('2024-01-05 03:07:09.012');
  expect(formatTimestampMs('not-a-date')).toBe('—');
});

test('getValueType + formatValue cover every discriminant', () => {
  expect(getValueType({created_at: '', signal: '', value_num: 3})).toBe('num');
  expect(getValueType({created_at: '', signal: '', value_str: 's'})).toBe('str');
  expect(getValueType({created_at: '', signal: '', value_bool: false})).toBe('bool');
  expect(getValueType({created_at: '', signal: ''})).toBe('null');

  expect(formatValue({created_at: '', signal: '', value_num: 3})).toBe('3');
  expect(formatValue({created_at: '', signal: '', value_str: 's'})).toBe('s');
  expect(formatValue({created_at: '', signal: '', value_bool: true})).toBe('true');
  expect(formatValue({created_at: '', signal: '', value_bool: false})).toBe('false');
  expect(formatValue({created_at: '', signal: ''})).toBe('—');
});

test('constants preserve the web shape', () => {
  expect(TYPE_BADGE_COLOR).toEqual({num: 'cyan', str: 'green', bool: 'amber', null: 'neutral'});
  expect(Object.keys(TYPE_VALUE_COLOR)).toEqual(['num', 'str', 'bool', 'null']);
  expect(PAGE_SIZES).toEqual([25, 50, 100]);
  expect(TIME_RANGE_PRESETS.map(p => p.hours)).toEqual([1, 6, 24, 168, 720]);
});

test('matchTimeRangePreset matches within tolerance and rejects otherwise', () => {
  const to = new Date('2024-01-02T00:00:00Z');
  const from = new Date(to.getTime() - 24 * 3600_000);
  expect(matchTimeRangePreset(from.toISOString(), to.toISOString())).toBe(24);
  // 12h span matches no preset.
  const from12 = new Date(to.getTime() - 12 * 3600_000);
  expect(matchTimeRangePreset(from12.toISOString(), to.toISOString())).toBeNull();
  expect(matchTimeRangePreset('', '')).toBeNull();
});

/* ── SignalMultiSelect ── */

function SignalMultiSelectHarness(props: {
  initial: string[];
  maxSignals?: number;
  onChange: (signals: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(props.initial);
  return (
    <SignalMultiSelect
      maxSignals={props.maxSignals}
      onChange={next => {
        props.onChange(next);
        setSelected(next);
      }}
      selected={selected}
      vehicleId={7}
    />
  );
}

test('SignalMultiSelect renders chips and removes a selected signal', () => {
  mockAvailableSignals = ['a', 'b', 'c'];
  const onChange = jest.fn();
  const tree = render(
    <SignalMultiSelectHarness initial={['a']} onChange={onChange} />,
  );

  expect(countHost(tree, 'signal-chip-a')).toBe(1);
  callProp(tree, 'signal-chip-remove-a', 'onPress');
  expect(onChange).toHaveBeenLastCalledWith([]);
});

test('SignalMultiSelect opens on focus and adds a filtered option', () => {
  mockAvailableSignals = ['alpha', 'beta', 'gamma'];
  const onChange = jest.fn();
  const tree = render(
    <SignalMultiSelectHarness initial={['alpha']} onChange={onChange} />,
  );

  // Dropdown closed until the field is focused.
  expect(countHost(tree, 'signal-option-beta')).toBe(0);
  callProp(tree, 'signal-search-input', 'onFocus');
  // 'alpha' is already selected, so only beta/gamma remain selectable.
  expect(countHost(tree, 'signal-option-alpha')).toBe(0);
  expect(countHost(tree, 'signal-option-beta')).toBe(1);

  callProp(tree, 'signal-option-beta', 'onPress');
  expect(onChange).toHaveBeenLastCalledWith(['alpha', 'beta']);
});

test('SignalMultiSelect honours maxSignals (add is a no-op at the cap)', () => {
  mockAvailableSignals = ['x', 'y'];
  const onChange = jest.fn();
  const tree = render(
    <SignalMultiSelectHarness initial={['x']} maxSignals={1} onChange={onChange} />,
  );

  callProp(tree, 'signal-search-input', 'onFocus');
  callProp(tree, 'signal-option-y', 'onPress');
  expect(onChange).not.toHaveBeenCalled();
});

/* ── DateTimeRangeControls ── */

test('DateTimeRangeControls edits fields and fires presets', () => {
  const onFromChange = jest.fn();
  const onToChange = jest.fn();
  const onPreset = jest.fn();
  const to = new Date('2024-01-02T00:00:00Z');
  const from = new Date(to.getTime() - 24 * 3600_000);
  const tree = render(
    <DateTimeRangeControls
      fromStr={from.toISOString()}
      onFromChange={onFromChange}
      onPreset={onPreset}
      onToChange={onToChange}
      toStr={to.toISOString()}
    />,
  );

  callProp(tree, 'signal-range-from', 'onChangeText', '2024-01-01T00:00:00');
  expect(onFromChange).toHaveBeenCalledWith('2024-01-01T00:00:00');
  callProp(tree, 'signal-range-to', 'onChangeText', '2024-01-02T00:00:00');
  expect(onToChange).toHaveBeenCalledWith('2024-01-02T00:00:00');

  callProp(tree, 'signal-preset-6h', 'onPress');
  expect(onPreset).toHaveBeenCalledWith(6);

  // The active 24h span pre-selects the 24h chip.
  const active = tree.root.find(
    (node: ReactTestInstance) =>
      node.props.testID === 'signal-preset-24h' &&
      node.props.accessibilityState != null,
  );
  expect(active.props.accessibilityState.selected).toBe(true);
});

/* ── QueryControls ── */

test('QueryControls changes page size and triggers a query', () => {
  const onPerPageChange = jest.fn();
  const onQuery = jest.fn();
  const tree = render(
    <QueryControls
      onPerPageChange={onPerPageChange}
      onQuery={onQuery}
      perPage={50}
    />,
  );

  callProp(tree, 'signal-perpage-100', 'onPress');
  expect(onPerPageChange).toHaveBeenCalledWith(100);

  callProp(tree, 'signal-query-button', 'onPress');
  expect(onQuery).toHaveBeenCalledTimes(1);
});

test('QueryControls disables the button when disabled', () => {
  const tree = render(
    <QueryControls
      disabled
      onPerPageChange={jest.fn()}
      onQuery={jest.fn()}
      perPage={25}
    />,
  );
  const nodes = tree.root.findAll(
    (node: ReactTestInstance) => node.props.testID === 'signal-query-button',
  );
  const isDisabled = nodes.some(
    (node: ReactTestInstance) =>
      node.props.accessibilityState?.disabled === true ||
      node.props.disabled === true,
  );
  expect(isDisabled).toBe(true);
});

/* ── SignalDataTable ── */

const SAMPLE_ROWS: SignalLogEntry[] = [
  {created_at: new Date('2024-01-01T00:00:00Z').toISOString(), signal: 'speed', value_num: 12},
  {created_at: new Date('2024-01-01T00:00:01Z').toISOString(), signal: 'gear', value_str: 'D'},
];

test('SignalDataTable shows a loading skeleton', () => {
  const tree = render(
    <SignalDataTable
      loading
      onPageChange={jest.fn()}
      page={1}
      perPage={25}
      rows={[]}
      total={0}
      totalPages={0}
    />,
  );
  expect(countHost(tree, 'signal-data-table-loading')).toBe(1);
  expect(countHost(tree, 'signal-data-table')).toBe(0);
});

test('SignalDataTable shows the empty message with no rows', () => {
  const tree = render(
    <SignalDataTable
      onPageChange={jest.fn()}
      page={1}
      perPage={25}
      rows={[]}
      total={0}
      totalPages={1}
    />,
  );
  expect(countHost(tree, 'signal-data-table-empty')).toBe(1);
  expect(JSON.stringify(tree.toJSON())).toContain('No results');
});

test('SignalDataTable renders rows and values', () => {
  const tree = render(
    <SignalDataTable
      onPageChange={jest.fn()}
      page={1}
      perPage={25}
      rows={SAMPLE_ROWS}
      total={2}
      totalPages={1}
    />,
  );
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('speed');
  expect(json).toContain('gear');
  expect(json).toContain('Timestamp');
  // No pagination footer for a single page.
  expect(countHost(tree, 'signal-page-next')).toBe(0);
});

test('SignalDataTable paginates across multiple pages', () => {
  const onPageChange = jest.fn();
  const tree = render(
    <SignalDataTable
      onPageChange={onPageChange}
      page={2}
      perPage={25}
      rows={SAMPLE_ROWS}
      total={120}
      totalPages={5}
    />,
  );

  expect(JSON.stringify(tree.toJSON())).toContain('Page 2 of 5');

  callProp(tree, 'signal-page-first', 'onPress');
  expect(onPageChange).toHaveBeenLastCalledWith(1);
  callProp(tree, 'signal-page-prev', 'onPress');
  expect(onPageChange).toHaveBeenLastCalledWith(1);
  callProp(tree, 'signal-page-next', 'onPress');
  expect(onPageChange).toHaveBeenLastCalledWith(3);
  callProp(tree, 'signal-page-last', 'onPress');
  expect(onPageChange).toHaveBeenLastCalledWith(5);
});
