import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {DateRangeFilter} from '../src/web-parity/components/forms/DateRangeFilter';

/**
 * Native parity contract for DateRangeFilter.
 *
 * The web component wraps two <input type="date"> fields, an optional Apply
 * <Button>, and a <DatePresetChips> row. The native port swaps the browser date
 * picker for a controlled <TextInput> and inlines a faithful copy of the
 * DATE_PRESETS range math. These tests assert the same behavior the web suite
 * would: controlled value + onChange wiring, the onRangeChange-vs-
 * onStart/onEnd branch, the optional onApply call, the active-preset highlight,
 * and the `presets` toggle.
 */

type Tree = ReactTestRenderer.ReactTestRenderer;

function isoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function render(node: React.ReactElement): Tree {
  let tree!: Tree;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(node);
  });
  return tree;
}

// React Native yields a composite + host instance for a testID; grab the first.
function byTestId(tree: Tree, id: string) {
  return tree.root.findAllByProps({testID: id})[0];
}

function presentCount(tree: Tree, id: string): number {
  return tree.root.findAllByProps({testID: id}).length > 0 ? 1 : 0;
}

test('renders both controlled date inputs with the supplied values', () => {
  const tree = render(
    <DateRangeFilter
      startDate="2026-01-01"
      endDate="2026-01-31"
      onStartDateChange={jest.fn()}
      onEndDateChange={jest.fn()}
    />,
  );

  expect(byTestId(tree, 'date-range-start').props.value).toBe('2026-01-01');
  expect(byTestId(tree, 'date-range-end').props.value).toBe('2026-01-31');

  ReactTestRenderer.act(() => tree.unmount());
});

test('typing into the inputs forwards the raw string to the change handlers', () => {
  const onStartDateChange = jest.fn();
  const onEndDateChange = jest.fn();
  const tree = render(
    <DateRangeFilter
      startDate=""
      endDate=""
      onStartDateChange={onStartDateChange}
      onEndDateChange={onEndDateChange}
    />,
  );

  ReactTestRenderer.act(() => {
    byTestId(tree, 'date-range-start').props.onChangeText('2026-02-03');
    byTestId(tree, 'date-range-end').props.onChangeText('2026-02-09');
  });

  expect(onStartDateChange).toHaveBeenCalledWith('2026-02-03');
  expect(onEndDateChange).toHaveBeenCalledWith('2026-02-09');

  ReactTestRenderer.act(() => tree.unmount());
});

test('Apply button only renders when onApply is provided and fires it on press', () => {
  const onApply = jest.fn();
  const withApply = render(
    <DateRangeFilter
      startDate=""
      endDate=""
      onStartDateChange={jest.fn()}
      onEndDateChange={jest.fn()}
      onApply={onApply}
    />,
  );
  ReactTestRenderer.act(() => {
    byTestId(withApply, 'date-range-apply').props.onPress();
  });
  expect(onApply).toHaveBeenCalledTimes(1);
  ReactTestRenderer.act(() => withApply.unmount());

  const withoutApply = render(
    <DateRangeFilter
      startDate=""
      endDate=""
      onStartDateChange={jest.fn()}
      onEndDateChange={jest.fn()}
    />,
  );
  expect(presentCount(withoutApply, 'date-range-apply')).toBe(0);
  ReactTestRenderer.act(() => withoutApply.unmount());
});

test('preset press uses onRangeChange (atomic) when provided, then onApply', () => {
  const onRangeChange = jest.fn();
  const onStartDateChange = jest.fn();
  const onEndDateChange = jest.fn();
  const onApply = jest.fn();
  const today = isoLocal(new Date());

  const tree = render(
    <DateRangeFilter
      startDate=""
      endDate=""
      onStartDateChange={onStartDateChange}
      onEndDateChange={onEndDateChange}
      onRangeChange={onRangeChange}
      onApply={onApply}
    />,
  );

  ReactTestRenderer.act(() => {
    byTestId(tree, 'date-preset-today').props.onPress();
  });

  expect(onRangeChange).toHaveBeenCalledWith({start: today, end: today});
  expect(onStartDateChange).not.toHaveBeenCalled();
  expect(onEndDateChange).not.toHaveBeenCalled();
  expect(onApply).toHaveBeenCalledTimes(1);

  ReactTestRenderer.act(() => tree.unmount());
});

test('preset press falls back to onStart/onEnd when onRangeChange is absent', () => {
  const onStartDateChange = jest.fn();
  const onEndDateChange = jest.fn();
  const today = isoLocal(new Date());

  const tree = render(
    <DateRangeFilter
      startDate=""
      endDate=""
      onStartDateChange={onStartDateChange}
      onEndDateChange={onEndDateChange}
    />,
  );

  ReactTestRenderer.act(() => {
    byTestId(tree, 'date-preset-today').props.onPress();
  });

  expect(onStartDateChange).toHaveBeenCalledWith(today);
  expect(onEndDateChange).toHaveBeenCalledWith(today);

  ReactTestRenderer.act(() => tree.unmount());
});

test('highlights the chip whose resolved range matches the current dates', () => {
  const today = isoLocal(new Date());
  const tree = render(
    <DateRangeFilter
      startDate={today}
      endDate={today}
      onStartDateChange={jest.fn()}
      onEndDateChange={jest.fn()}
    />,
  );

  expect(byTestId(tree, 'date-preset-today').props.accessibilityState).toEqual({
    selected: true,
  });
  expect(byTestId(tree, 'date-preset-30d').props.accessibilityState).toEqual({
    selected: false,
  });

  ReactTestRenderer.act(() => tree.unmount());
});

test('respects presetIds overrides and the presets=false toggle', () => {
  const custom = render(
    <DateRangeFilter
      startDate=""
      endDate=""
      onStartDateChange={jest.fn()}
      onEndDateChange={jest.fn()}
      presetIds={['7d', '90d', '1y']}
    />,
  );
  expect(presentCount(custom, 'date-preset-7d')).toBe(1);
  expect(presentCount(custom, 'date-preset-90d')).toBe(1);
  expect(presentCount(custom, 'date-preset-1y')).toBe(1);
  // 'today' is not in the override set -> not rendered.
  expect(presentCount(custom, 'date-preset-today')).toBe(0);
  ReactTestRenderer.act(() => custom.unmount());

  const hidden = render(
    <DateRangeFilter
      startDate=""
      endDate=""
      onStartDateChange={jest.fn()}
      onEndDateChange={jest.fn()}
      presets={false}
    />,
  );
  expect(presentCount(hidden, 'date-range-presets')).toBe(0);
  expect(presentCount(hidden, 'date-preset-today')).toBe(0);
  ReactTestRenderer.act(() => hidden.unmount());
});
