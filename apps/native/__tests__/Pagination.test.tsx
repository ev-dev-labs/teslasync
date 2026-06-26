import React from 'react';
import {StyleSheet} from 'react-native';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

import {Pagination} from '../src/web-parity/components/ui/Pagination';

type Renderer = ReactTestRenderer.ReactTestRenderer;

function render(element: React.ReactElement): Renderer {
  let tree: Renderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(element);
  });
  return tree!;
}

/** Host (string-typed) node carrying a testID — unique even when a composite forwards the id. */
function findHost(tree: Renderer, testID: string): ReactTestInstance {
  return tree.root.find(
    (node: ReactTestInstance) =>
      typeof node.type === 'string' && node.props.testID === testID,
  );
}

/** The Pressable composite (testID + an onPress function) — uniquely identifies a control. */
function findPressable(tree: Renderer, testID: string): ReactTestInstance {
  return tree.root.find(
    (node: ReactTestInstance) =>
      node.props.testID === testID && typeof node.props.onPress === 'function',
  );
}

function press(tree: Renderer, testID: string): void {
  const target = findPressable(tree, testID);
  ReactTestRenderer.act(() => {
    target.props.onPress();
  });
}

function isDisabled(node: ReactTestInstance): boolean {
  return (
    node.props.disabled === true ||
    node.props.accessibilityState?.disabled === true
  );
}

function hostText(tree: Renderer, testID: string): string {
  const children = findHost(tree, testID).props.children;
  return Array.isArray(children) ? children.join('') : String(children);
}

function exists(tree: Renderer, testID: string): boolean {
  return (
    tree.root.findAll((node: ReactTestInstance) => node.props.testID === testID)
      .length > 0
  );
}

test('renders the showing copy, the page indicator and four nav controls', () => {
  const tree = render(
    <Pagination
      onPageChange={jest.fn()}
      page={1}
      pageSize={25}
      total={100}
    />,
  );

  expect(findHost(tree, 'pagination').props.accessibilityRole).toBe('toolbar');
  expect(hostText(tree, 'pagination-showing')).toMatch(/^Showing 1.+25 of 100$/);
  expect(hostText(tree, 'pagination-indicator')).toBe('1 / 4');

  for (const id of [
    'pagination-first',
    'pagination-previous',
    'pagination-next',
    'pagination-last',
  ]) {
    expect(findPressable(tree, id)).toBeDefined();
  }
});

test('first and previous are disabled on the first page', () => {
  const tree = render(
    <Pagination
      onPageChange={jest.fn()}
      page={1}
      pageSize={25}
      total={100}
    />,
  );

  expect(isDisabled(findPressable(tree, 'pagination-first'))).toBe(true);
  expect(isDisabled(findPressable(tree, 'pagination-previous'))).toBe(true);
  expect(isDisabled(findPressable(tree, 'pagination-next'))).toBe(false);
  expect(isDisabled(findPressable(tree, 'pagination-last'))).toBe(false);
});

test('next and last are disabled on the final page', () => {
  const tree = render(
    <Pagination
      onPageChange={jest.fn()}
      page={4}
      pageSize={25}
      total={100}
    />,
  );

  expect(isDisabled(findPressable(tree, 'pagination-next'))).toBe(true);
  expect(isDisabled(findPressable(tree, 'pagination-last'))).toBe(true);
  expect(isDisabled(findPressable(tree, 'pagination-first'))).toBe(false);
  expect(isDisabled(findPressable(tree, 'pagination-previous'))).toBe(false);
});

test('each control routes to the correct target page', () => {
  const onPageChange = jest.fn();
  const tree = render(
    <Pagination
      onPageChange={onPageChange}
      page={2}
      pageSize={25}
      total={100}
    />,
  );

  press(tree, 'pagination-first');
  press(tree, 'pagination-previous');
  press(tree, 'pagination-next');
  press(tree, 'pagination-last');

  expect(onPageChange.mock.calls.map(c => c[0])).toEqual([1, 1, 3, 4]);
});

test('page-size chips render the selection and fire onPageSizeChange', () => {
  const onPageSizeChange = jest.fn();
  const tree = render(
    <Pagination
      onPageChange={jest.fn()}
      onPageSizeChange={onPageSizeChange}
      page={1}
      pageSize={50}
      total={100}
    />,
  );

  expect(exists(tree, 'pagination-page-size')).toBe(true);
  expect(
    findPressable(tree, 'pagination-page-size-50').props.accessibilityState
      .selected,
  ).toBe(true);
  expect(
    findPressable(tree, 'pagination-page-size-25').props.accessibilityState
      .selected,
  ).toBe(false);

  press(tree, 'pagination-page-size-100');
  expect(onPageSizeChange).toHaveBeenCalledWith(100);
});

test('omits the page-size selector when onPageSizeChange is not provided', () => {
  const tree = render(
    <Pagination
      onPageChange={jest.fn()}
      page={1}
      pageSize={25}
      total={100}
    />,
  );

  expect(exists(tree, 'pagination-page-size')).toBe(false);
});

test('clamps the showing start to 0 and totalPages to 1 when empty', () => {
  const tree = render(
    <Pagination onPageChange={jest.fn()} page={1} pageSize={25} total={0} />,
  );

  expect(hostText(tree, 'pagination-showing')).toMatch(/^Showing 0.+0 of 0$/);
  expect(hostText(tree, 'pagination-indicator')).toBe('1 / 1');
});

test('the live region is announced and the chevron glyphs are hidden', () => {
  const tree = render(
    <Pagination onPageChange={jest.fn()} page={1} pageSize={25} total={100} />,
  );

  expect(findHost(tree, 'pagination-showing').props.accessibilityLiveRegion).toBe(
    'polite',
  );

  // The four decorative chevron glyphs are present but flagged out of the a11y tree.
  const hidden = tree.root.findAll(
    (node: ReactTestInstance) =>
      typeof node.type === 'string' &&
      node.props.importantForAccessibility === 'no',
  );
  const glyphs = hidden.map(node => String(node.props.children));
  expect(glyphs).toEqual(
    expect.arrayContaining(['\u00AB', '\u2039', '\u203A', '\u00BB']),
  );
  expect(StyleSheet.flatten(hidden[0].props.style)).toBeDefined();
});
