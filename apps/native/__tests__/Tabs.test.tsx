import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  getNextEnabledTabKey,
  Tabs,
  type TabItem,
} from '../src/web-parity/components/ui/Tabs';

/**
 * Native parity contract for Tabs.
 *
 * The web component is the WAI-ARIA Tabs widget: a `<div role="tablist">` of
 * `<button role="tab">` controls with aria-selected, a roving tabindex, and
 * Arrow/Home/End keyboard navigation. The native port renders a `tablist` of
 * `tab` Pressables (tap selects -> onChange), marks the active/disabled state
 * via accessibilityState, and preserves the roving-navigation arithmetic in the
 * exported `getNextEnabledTabKey` helper (physical-key navigation has no touch
 * analog). These tests assert that behaviour: the rendered roles/labels, the
 * selected + disabled state, the onChange-on-press path, the useId-derived
 * nativeID, and the full navigation helper.
 */

type Tree = ReactTestRenderer.ReactTestRenderer;

function render(node: React.ReactElement): Tree {
  let tree!: Tree;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(node);
  });
  return tree;
}

// React Native yields a composite + host instance for a testID; grab the first
// (the composite, which carries the onPress + accessibility props we passed).
function byTestId(tree: Tree, id: string) {
  return tree.root.findAllByProps({testID: id})[0];
}

// The container View shares its forwarded `testID` with the Tabs composite, so
// resolve the tablist by its accessibility role instead.
function byRole(tree: Tree, role: string) {
  return tree.root.findAll(node => node.props.accessibilityRole === role)[0];
}

const TABS: TabItem[] = [
  {key: 'overview', label: 'Overview'},
  {key: 'charging', label: 'Charging'},
  {key: 'legacy', label: 'Legacy', disabled: true},
];

test('renders a tablist of tabs with the active tab selected', () => {
  const tree = render(
    <Tabs
      tabs={TABS}
      activeTab="charging"
      onChange={jest.fn()}
      ariaLabel="Sections"
      testID="tabs"
    />,
  );

  const tablist = byRole(tree, 'tablist');
  expect(tablist.props.accessibilityRole).toBe('tablist');
  expect(tablist.props.accessibilityLabel).toBe('Sections');

  const overview = byTestId(tree, 'tabs-tab-overview');
  const charging = byTestId(tree, 'tabs-tab-charging');
  expect(overview.props.accessibilityRole).toBe('tab');
  expect(overview.props.accessibilityState).toEqual({
    selected: false,
    disabled: false,
  });
  expect(charging.props.accessibilityState).toEqual({
    selected: true,
    disabled: false,
  });

  ReactTestRenderer.act(() => tree.unmount());
});

test('renders every tab label', () => {
  const tree = render(
    <Tabs tabs={TABS} activeTab="overview" onChange={jest.fn()} />,
  );

  const serialized = JSON.stringify(tree.toJSON());
  expect(serialized).toContain('Overview');
  expect(serialized).toContain('Charging');
  expect(serialized).toContain('Legacy');

  ReactTestRenderer.act(() => tree.unmount());
});

test('tapping a tab fires onChange with its key (web onClick analog)', () => {
  const onChange = jest.fn();
  const tree = render(
    <Tabs tabs={TABS} activeTab="overview" onChange={onChange} testID="tabs" />,
  );

  ReactTestRenderer.act(() => {
    byTestId(tree, 'tabs-tab-charging').props.onPress();
  });

  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith('charging');

  ReactTestRenderer.act(() => tree.unmount());
});

test('marks a disabled tab disabled for assistive tech and presses', () => {
  const tree = render(
    <Tabs tabs={TABS} activeTab="overview" onChange={jest.fn()} testID="tabs" />,
  );

  const legacy = byTestId(tree, 'tabs-tab-legacy');
  expect(legacy.props.disabled).toBe(true);
  expect(legacy.props.accessibilityState).toEqual({
    selected: false,
    disabled: true,
  });

  ReactTestRenderer.act(() => tree.unmount());
});

test('each tab carries a useId-derived nativeID for panel linkage', () => {
  const tree = render(
    <Tabs tabs={TABS} activeTab="overview" onChange={jest.fn()} testID="tabs" />,
  );

  const overview = byTestId(tree, 'tabs-tab-overview');
  expect(typeof overview.props.nativeID).toBe('string');
  expect(overview.props.nativeID).toMatch(/-tab-overview$/);

  ReactTestRenderer.act(() => tree.unmount());
});

describe('getNextEnabledTabKey (roving keyboard navigation parity)', () => {
  const enabled = ['a', 'b', 'c'];

  test('ArrowRight steps forward through the enabled tabs', () => {
    expect(getNextEnabledTabKey(enabled, 'a', 'ArrowRight')).toBe('b');
  });

  test('ArrowRight wraps from the last tab to the first', () => {
    expect(getNextEnabledTabKey(enabled, 'c', 'ArrowRight')).toBe('a');
  });

  test('ArrowLeft steps back through the enabled tabs', () => {
    expect(getNextEnabledTabKey(enabled, 'b', 'ArrowLeft')).toBe('a');
  });

  test('ArrowLeft wraps from the first tab to the last', () => {
    expect(getNextEnabledTabKey(enabled, 'a', 'ArrowLeft')).toBe('c');
  });

  test('Home jumps to the first enabled tab', () => {
    expect(getNextEnabledTabKey(enabled, 'c', 'Home')).toBe('a');
  });

  test('End jumps to the last enabled tab', () => {
    expect(getNextEnabledTabKey(enabled, 'a', 'End')).toBe('c');
  });

  test('returns null for an empty tab strip', () => {
    expect(getNextEnabledTabKey([], 'a', 'ArrowRight')).toBeNull();
  });

  test('returns null when the focused key is not enabled (web idx === -1 guard)', () => {
    expect(getNextEnabledTabKey(enabled, 'z', 'ArrowRight')).toBeNull();
  });

  test('skips disabled tabs by only considering the enabled keys', () => {
    // 'b' filtered out upstream (disabled) -> ArrowRight from 'a' lands on 'c'.
    expect(getNextEnabledTabKey(['a', 'c'], 'a', 'ArrowRight')).toBe('c');
  });
});
