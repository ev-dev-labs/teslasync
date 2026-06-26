import React from 'react';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

import {
  UuidGeneratorTool,
  safeRandomUUID,
} from '../src/web-parity/features/admin/components/devtools/tools/UuidGenerator';

type Renderer = ReactTestRenderer.ReactTestRenderer;

type JsonNode = {
  type: string;
  props: {testID?: string; [key: string]: unknown};
  children: Array<JsonNode | string> | null;
};

function render(element: React.ReactElement): Renderer {
  let tree: Renderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(element);
  });
  return tree!;
}

function findByTestID(
  node: JsonNode | string | null,
  testID: string,
): JsonNode | null {
  if (!node || typeof node === 'string') {
    return null;
  }
  if (node.props?.testID === testID) {
    return node;
  }
  if (!node.children) {
    return null;
  }
  for (const child of node.children) {
    const found = findByTestID(child, testID);
    if (found) {
      return found;
    }
  }
  return null;
}

function flattenText(node: JsonNode | string | null): string {
  if (node == null) {
    return '';
  }
  if (typeof node === 'string') {
    return node;
  }
  if (!node.children) {
    return '';
  }
  return node.children.map(flattenText).join('');
}

function hasHost(tree: Renderer, testID: string): boolean {
  return findByTestID(tree.toJSON() as JsonNode | null, testID) != null;
}

function textOf(tree: Renderer, testID: string): string {
  return flattenText(findByTestID(tree.toJSON() as JsonNode | null, testID));
}

function countRows(tree: Renderer): number {
  return tree.root.findAll(
    (node: ReactTestInstance) =>
      typeof node.type === 'string' &&
      typeof node.props.testID === 'string' &&
      node.props.testID.startsWith('uuid-row-'),
  ).length;
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

/* ── safeRandomUUID port ── */

const V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test('safeRandomUUID returns RFC 4122 v4 UUIDs', () => {
  const id = safeRandomUUID();
  expect(id).toMatch(V4_RE);
});

test('safeRandomUUID returns distinct values across calls', () => {
  const ids = new Set<string>();
  for (let i = 0; i < 50; i++) {
    ids.add(safeRandomUUID());
  }
  expect(ids.size).toBe(50);
});

/* ── render ── */

test('renders the ToolCard header and starts with an empty list', () => {
  const tree = render(<UuidGeneratorTool />);
  const flat = flattenText(tree.toJSON() as JsonNode | null);
  expect(flat).toContain('Uuid Generator');
  expect(flat).toContain('Uuid Generator Desc');
  // The Generate button shows its label; the list is hidden until first press.
  expect(flat).toContain('Generate');
  expect(hasHost(tree, 'uuid-generate')).toBe(true);
  expect(countRows(tree)).toBe(0);
});

/* ── generate (newest-first, capped at 10) ── */

test('pressing Generate prepends a new UUID row', () => {
  const tree = render(<UuidGeneratorTool />);
  press(tree, 'uuid-generate');
  expect(countRows(tree)).toBe(1);
  expect(textOf(tree, 'uuid-value-0')).toMatch(V4_RE);

  const first = textOf(tree, 'uuid-value-0');
  press(tree, 'uuid-generate');
  expect(countRows(tree)).toBe(2);
  // Newest is prepended at index 0; the previous first slides to index 1.
  expect(textOf(tree, 'uuid-value-0')).not.toBe(first);
  expect(textOf(tree, 'uuid-value-1')).toBe(first);
});

test('the generated list is capped at the 10 most-recent UUIDs', () => {
  const tree = render(<UuidGeneratorTool />);
  for (let i = 0; i < 12; i++) {
    press(tree, 'uuid-generate');
  }
  expect(countRows(tree)).toBe(10);
});

/* ── copy affordance (Copy -> Copied -> Copy after 2s) ── */

test('the per-row copy affordance toggles Copy -> Copied and resets after 2s', () => {
  jest.useFakeTimers();
  try {
    const tree = render(<UuidGeneratorTool />);
    press(tree, 'uuid-generate');
    expect(textOf(tree, 'uuid-copy-0-label')).toBe('Copy');

    press(tree, 'uuid-copy-0');
    expect(textOf(tree, 'uuid-copy-0-label')).toBe('Copied');

    ReactTestRenderer.act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(textOf(tree, 'uuid-copy-0-label')).toBe('Copy');
  } finally {
    jest.useRealTimers();
  }
});
