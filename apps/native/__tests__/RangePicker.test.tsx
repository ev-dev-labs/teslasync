import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {RangePicker} from '../src/web-parity/components/forms/RangePicker';

/**
 * Native parity contract for RangePicker.
 *
 * The web component is a single-trigger popover holding a preset listbox, a
 * react-day-picker calendar, and a Cancel/Apply footer with an optional compare
 * checkbox. The native port renders the trigger as a <Pressable>, the popover
 * as a bottom-sheet <Modal>, and substitutes the DOM calendar with two
 * controlled YYYY-MM-DD <TextInput>s. These tests assert the same behavior the
 * web suite would: the trigger opens the sheet, preset press commits
 * immediately via onChange(range, presetId), staged edits only commit on Apply
 * (disabled until dirty), Cancel discards the staged range, the compare toggle
 * fires onCompareChange, presetsOnly hides the staged fields, and presetIds
 * selects the rendered subset.
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

function openSheet(tree: Tree, triggerId: string): void {
  ReactTestRenderer.act(() => {
    byTestId(tree, triggerId).props.onPress();
  });
}

test('trigger toggles the sheet open and exposes the preset list', () => {
  const tree = render(
    <RangePicker
      onChange={jest.fn()}
      triggerTestId="rp"
      value={{start: '2026-01-10', end: '2026-01-20'}}
    />,
  );

  // Sheet closed -> Modal renders null, so preset pills are absent.
  expect(byTestId(tree, 'rp').props.accessibilityState).toEqual({
    expanded: false,
  });
  expect(presentCount(tree, 'range-preset-today')).toBe(0);

  openSheet(tree, 'rp');

  expect(byTestId(tree, 'rp').props.accessibilityState).toEqual({
    expanded: true,
  });
  expect(presentCount(tree, 'range-picker-popover')).toBe(1);
  expect(presentCount(tree, 'range-preset-today')).toBe(1);

  ReactTestRenderer.act(() => tree.unmount());
});

test('preset press commits the resolved range with its id and closes', () => {
  const onChange = jest.fn();
  const today = isoLocal(new Date());
  const tree = render(
    <RangePicker
      onChange={onChange}
      triggerTestId="rp"
      value={{start: '2026-01-10', end: '2026-01-20'}}
    />,
  );

  openSheet(tree, 'rp');
  ReactTestRenderer.act(() => {
    byTestId(tree, 'range-preset-today').props.onPress();
  });

  expect(onChange).toHaveBeenCalledWith({start: today, end: today}, 'today');
  // Popover closed after a preset press.
  expect(byTestId(tree, 'rp').props.accessibilityState).toEqual({
    expanded: false,
  });

  ReactTestRenderer.act(() => tree.unmount());
});

test('"all" preset floors the start at resolveAllTimeStart(minDate)', () => {
  const onChange = jest.fn();
  const today = isoLocal(new Date());
  const tree = render(
    <RangePicker
      minDate="2024-03-01"
      onChange={onChange}
      presetIds={['all']}
      triggerTestId="rp"
      value={{start: '2026-01-10', end: '2026-01-20'}}
    />,
  );

  openSheet(tree, 'rp');
  ReactTestRenderer.act(() => {
    byTestId(tree, 'range-preset-all').props.onPress();
  });

  // minDate (2024-03-01) is later than the 2015 baseline, so it wins.
  expect(onChange).toHaveBeenCalledWith({start: '2024-03-01', end: today}, 'all');

  ReactTestRenderer.act(() => tree.unmount());
});

test('Apply is disabled until a staged edit makes the range dirty, then commits', () => {
  const onChange = jest.fn();
  const tree = render(
    <RangePicker
      onChange={onChange}
      triggerTestId="rp"
      value={{start: '2026-01-10', end: '2026-01-20'}}
    />,
  );

  openSheet(tree, 'rp');

  // Seeded staged range equals value -> not dirty -> Apply disabled.
  expect(byTestId(tree, 'range-picker-apply').props.disabled).toBe(true);
  expect(byTestId(tree, 'range-picker-start').props.value).toBe('2026-01-10');
  expect(byTestId(tree, 'range-picker-end').props.value).toBe('2026-01-20');

  ReactTestRenderer.act(() => {
    byTestId(tree, 'range-picker-start').props.onChangeText('2026-01-05');
  });

  expect(byTestId(tree, 'range-picker-apply').props.disabled).toBe(false);

  ReactTestRenderer.act(() => {
    byTestId(tree, 'range-picker-apply').props.onPress();
  });

  expect(onChange).toHaveBeenCalledWith({start: '2026-01-05', end: '2026-01-20'});

  ReactTestRenderer.act(() => tree.unmount());
});

test('Cancel discards the staged edit (re-open shows the original value)', () => {
  const onChange = jest.fn();
  const tree = render(
    <RangePicker
      onChange={onChange}
      triggerTestId="rp"
      value={{start: '2026-01-10', end: '2026-01-20'}}
    />,
  );

  openSheet(tree, 'rp');
  ReactTestRenderer.act(() => {
    byTestId(tree, 'range-picker-start').props.onChangeText('2026-01-01');
  });
  ReactTestRenderer.act(() => {
    byTestId(tree, 'range-picker-cancel').props.onPress();
  });

  expect(onChange).not.toHaveBeenCalled();

  // Re-open: the staged draft is reseeded from the unchanged value.
  openSheet(tree, 'rp');
  expect(byTestId(tree, 'range-picker-start').props.value).toBe('2026-01-10');

  ReactTestRenderer.act(() => tree.unmount());
});

test('compare toggle fires onCompareChange with the flipped flag', () => {
  const onCompareChange = jest.fn();
  const tree = render(
    <RangePicker
      compare={false}
      enableCompare
      onChange={jest.fn()}
      onCompareChange={onCompareChange}
      triggerTestId="rp"
      value={{start: '2026-01-10', end: '2026-01-20'}}
    />,
  );

  openSheet(tree, 'rp');

  expect(
    byTestId(tree, 'range-picker-compare').props.accessibilityState,
  ).toEqual({checked: false});

  ReactTestRenderer.act(() => {
    byTestId(tree, 'range-picker-compare').props.onPress();
  });

  expect(onCompareChange).toHaveBeenCalledWith(true);

  ReactTestRenderer.act(() => tree.unmount());
});

test('presetsOnly hides the staged fields and footer but keeps the presets', () => {
  const tree = render(
    <RangePicker
      onChange={jest.fn()}
      presetsOnly
      triggerTestId="rp"
      value={{start: '2026-01-10', end: '2026-01-20'}}
    />,
  );

  openSheet(tree, 'rp');

  expect(presentCount(tree, 'range-preset-today')).toBe(1);
  expect(presentCount(tree, 'range-picker-start')).toBe(0);
  expect(presentCount(tree, 'range-picker-apply')).toBe(0);
  expect(presentCount(tree, 'range-picker-cancel')).toBe(0);

  ReactTestRenderer.act(() => tree.unmount());
});

test('respects presetIds overrides and highlights the active preset', () => {
  const today = isoLocal(new Date());
  const tree = render(
    <RangePicker
      onChange={jest.fn()}
      presetIds={['today', '90d', '1y']}
      triggerTestId="rp"
      value={{start: today, end: today}}
    />,
  );

  openSheet(tree, 'rp');

  expect(presentCount(tree, 'range-preset-today')).toBe(1);
  expect(presentCount(tree, 'range-preset-90d')).toBe(1);
  expect(presentCount(tree, 'range-preset-1y')).toBe(1);
  // '30d' is not in the override set -> not rendered.
  expect(presentCount(tree, 'range-preset-30d')).toBe(0);

  // value matches the "today" preset -> its pill is selected.
  expect(
    byTestId(tree, 'range-preset-today').props.accessibilityState,
  ).toEqual({selected: true});
  expect(byTestId(tree, 'range-preset-90d').props.accessibilityState).toEqual({
    selected: false,
  });

  ReactTestRenderer.act(() => tree.unmount());
});
