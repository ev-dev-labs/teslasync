import React from 'react';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

import {
  ClientUtilitiesSection,
  ICON_COLOR_MAP,
  useToolList,
} from '../src/web-parity/features/admin/components/devtools/ClientUtilitiesSection';

type Renderer = ReactTestRenderer.ReactTestRenderer;

function render(element: React.ReactElement): Renderer {
  let tree: Renderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(element);
  });
  return tree!;
}

function countHostPrefix(tree: Renderer, prefix: string): number {
  return tree.root.findAll(
    (node: ReactTestInstance) =>
      typeof node.type === 'string' &&
      typeof node.props.testID === 'string' &&
      node.props.testID.startsWith(prefix),
  ).length;
}

function hasHost(tree: Renderer, testID: string): boolean {
  return (
    tree.root.findAll(
      (node: ReactTestInstance) =>
        typeof node.type === 'string' && node.props.testID === testID,
    ).length > 0
  );
}

function press(tree: Renderer, testID: string): void {
  const target = tree.root.find(
    (node: ReactTestInstance) =>
      node.props.testID === testID && typeof node.props.onPress === 'function',
  );
  ReactTestRenderer.act(() => {
    target.props.onPress();
  });
}

function setSearch(tree: Renderer, value: string): void {
  const target = tree.root.find(
    (node: ReactTestInstance) =>
      node.props.testID === 'devtools-search-input' &&
      typeof node.props.onChangeText === 'function',
  );
  ReactTestRenderer.act(() => {
    target.props.onChangeText(value);
  });
}

/* ── registry ── */

test('useToolList exposes the 15 client utilities with stable ids/colors', () => {
  function Probe({onList}: {onList: (l: ReturnType<typeof useToolList>) => void}) {
    onList(useToolList());
    return null;
  }
  let list: ReturnType<typeof useToolList> = [];
  render(<Probe onList={l => (list = l)} />);

  expect(list).toHaveLength(15);
  expect(list.map(t => t.id)).toEqual([
    'vin', 'jwt', 'timestamp', 'base64', 'url', 'json', 'uuid', 'hash',
    'bytes', 'color', 'cron', 'http', 'tesla-api', 'regex', 'unix-perm',
  ]);
  // base64 + json share the lucide "Braces" icon (icon identity preserved).
  expect(list.find(t => t.id === 'base64')?.icon).toBe('Braces');
  expect(list.find(t => t.id === 'json')?.icon).toBe('Braces');
  // every tool colour resolves to a native chip style.
  for (const tool of list) {
    expect(ICON_COLOR_MAP[tool.color]).toBeDefined();
  }
});

/* ── render + search filter ── */

test('renders the search box and all 15 tool cards', () => {
  const tree = render(<ClientUtilitiesSection />);
  expect(hasHost(tree, 'devtools-search-input')).toBe(true);
  expect(countHostPrefix(tree, 'devtools-tool-toggle-')).toBe(15);
  expect(hasHost(tree, 'devtools-no-tools')).toBe(false);
});

test('case-insensitive name/desc filter narrows the grid', () => {
  const tree = render(<ClientUtilitiesSection />);
  setSearch(tree, 'VIN');
  expect(countHostPrefix(tree, 'devtools-tool-toggle-')).toBe(1);
  expect(hasHost(tree, 'devtools-tool-toggle-vin')).toBe(true);
  expect(hasHost(tree, 'devtools-no-tools')).toBe(false);
});

test('a non-matching search shows the empty state and no cards', () => {
  const tree = render(<ClientUtilitiesSection />);
  setSearch(tree, 'zzzzzz');
  expect(countHostPrefix(tree, 'devtools-tool-toggle-')).toBe(0);
  expect(hasHost(tree, 'devtools-no-tools')).toBe(true);
});

/* ── single-open accordion ── */

test('toggling a card expands its body and re-toggling collapses it', () => {
  const tree = render(<ClientUtilitiesSection />);
  expect(countHostPrefix(tree, 'devtools-tool-body-')).toBe(0);

  press(tree, 'devtools-tool-toggle-vin');
  expect(hasHost(tree, 'devtools-tool-body-vin')).toBe(true);
  expect(countHostPrefix(tree, 'devtools-tool-body-')).toBe(1);

  press(tree, 'devtools-tool-toggle-vin');
  expect(countHostPrefix(tree, 'devtools-tool-body-')).toBe(0);
});

test('only one card body is open at a time (single-open accordion)', () => {
  const tree = render(<ClientUtilitiesSection />);
  press(tree, 'devtools-tool-toggle-vin');
  press(tree, 'devtools-tool-toggle-jwt');
  expect(hasHost(tree, 'devtools-tool-body-vin')).toBe(false);
  expect(hasHost(tree, 'devtools-tool-body-jwt')).toBe(true);
  expect(countHostPrefix(tree, 'devtools-tool-body-')).toBe(1);
});
