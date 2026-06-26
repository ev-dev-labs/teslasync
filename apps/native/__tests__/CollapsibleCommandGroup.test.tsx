import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {AppText} from '../src/components/ui/AppText';
import {
  CollapsibleCommandGroup,
  type CommandCategory,
} from '../src/web-parity/features/system/components/CollapsibleCommandGroup';

/**
 * Native parity contract for the Vehicle Commands CollapsibleCommandGroup.
 *
 * The web component renders a toggle row (category icon + uppercase label +
 * "(count)" + chevron) and reveals its `children` only while expanded, with the
 * open state persisted per vehicle+category via sessionStorage. These tests
 * assert that behaviour against the native port: collapsed-by-default, the
 * defaultOpen seed, toggle reveal/hide, and the in-memory session persistence
 * that replaces the browser sessionStorage.
 */

type Tree = ReactTestRenderer.ReactTestRenderer;

const CHILD = 'COMMAND_TILE_MARKER';

function render(node: React.ReactElement): Tree {
  let tree!: Tree;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(node);
  });
  return tree;
}

function json(tree: Tree): string {
  return JSON.stringify(tree.toJSON());
}

function press(tree: Tree): void {
  // The Pressable composite renders as a host View; the established repo
  // pattern locates it by its accessibilityRole + onPress, not findByType.
  const pressable = tree.root.findAll(
    n =>
      n.props?.accessibilityRole === 'button' &&
      typeof n.props?.onPress === 'function',
  )[0];
  ReactTestRenderer.act(() => {
    pressable.props.onPress();
  });
}

function group(
  category: CommandCategory,
  vehicleId: number,
  defaultOpen?: boolean,
): React.ReactElement {
  return (
    <CollapsibleCommandGroup
      category={category}
      vehicleId={vehicleId}
      count={3}
      defaultOpen={defaultOpen}>
      <AppText>{CHILD}</AppText>
    </CollapsibleCommandGroup>
  );
}

test('renders the label + count and hides children when collapsed by default', () => {
  const tree = render(group('security', 1));
  const s = json(tree);

  expect(s).toContain('Security & Access');
  expect(s).toContain('(');
  expect(s).toContain('3');
  // Collapsed: the command tiles are not mounted.
  expect(s).not.toContain(CHILD);

  ReactTestRenderer.act(() => tree.unmount());
});

test('defaultOpen mounts the children grid immediately', () => {
  const tree = render(group('charging', 2, true));
  expect(json(tree)).toContain(CHILD);
  ReactTestRenderer.act(() => tree.unmount());
});

test('pressing the toggle reveals then hides the children', () => {
  const tree = render(group('climate', 3));
  expect(json(tree)).not.toContain(CHILD);

  press(tree);
  expect(json(tree)).toContain(CHILD);

  press(tree);
  expect(json(tree)).not.toContain(CHILD);

  ReactTestRenderer.act(() => tree.unmount());
});

test('open state persists across remounts for the same vehicle+category', () => {
  const first = render(group('media', 99));
  press(first);
  expect(json(first)).toContain(CHILD);
  ReactTestRenderer.act(() => first.unmount());

  // A fresh instance (defaultOpen omitted -> false) must read the persisted
  // 'true' from the in-memory session store and mount expanded.
  const second = render(group('media', 99));
  expect(json(second)).toContain(CHILD);
  ReactTestRenderer.act(() => second.unmount());

  // A different vehicle id has its own key and stays collapsed.
  const other = render(group('media', 100));
  expect(json(other)).not.toContain(CHILD);
  ReactTestRenderer.act(() => other.unmount());
});
