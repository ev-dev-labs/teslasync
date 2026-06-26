import React from 'react';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

import {ResultPanel} from '../src/web-parity/features/admin/components/devtools/ResultPanel';

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

function findPressable(tree: Renderer, testID: string): ReactTestInstance {
  return tree.root.find(
    (node: ReactTestInstance) =>
      node.props.testID === testID && typeof node.props.onPress === 'function',
  );
}

/* ── idle state ── */

test('idle state shows the default placeholder, no data/error/copy', () => {
  const tree = render(<ResultPanel title="Decode" />);
  expect(hasHost(tree, 'result-panel-idle')).toBe(true);
  expect(textOf(tree, 'result-panel-idle')).toBe('No result yet');
  expect(hasHost(tree, 'result-panel-data')).toBe(false);
  expect(hasHost(tree, 'result-panel-error')).toBe(false);
  expect(hasHost(tree, 'result-panel-copy')).toBe(false);
});

test('idle state honours a custom idleMessage', () => {
  const tree = render(<ResultPanel title="Decode" idleMessage="Nothing yet" />);
  expect(textOf(tree, 'result-panel-idle')).toBe('Nothing yet');
});

/* ── error state ── */

test('error state shows the error line and hides data/idle/copy', () => {
  const tree = render(<ResultPanel title="Decode" error="Invalid input" />);
  expect(hasHost(tree, 'result-panel-error')).toBe(true);
  expect(textOf(tree, 'result-panel-error')).toBe('Invalid input');
  expect(hasHost(tree, 'result-panel-data')).toBe(false);
  expect(hasHost(tree, 'result-panel-idle')).toBe(false);
  expect(hasHost(tree, 'result-panel-copy')).toBe(false);
});

/* ── data state ── */

test('data state renders pretty-printed JSON and the copy affordance', () => {
  const tree = render(<ResultPanel title="Decode" data={{vin: 'ABC', year: 2024}} />);
  expect(hasHost(tree, 'result-panel-data')).toBe(true);
  expect(textOf(tree, 'result-panel-data')).toBe(
    JSON.stringify({vin: 'ABC', year: 2024}, null, 2),
  );
  expect(hasHost(tree, 'result-panel-copy')).toBe(true);
  expect(hasHost(tree, 'result-panel-idle')).toBe(false);
  expect(hasHost(tree, 'result-panel-error')).toBe(false);
});

/* ── copy affordance toggle ── */

test('copy button toggles Copy -> Copied and resets after 2s', () => {
  jest.useFakeTimers();
  try {
    const tree = render(<ResultPanel title="Decode" data={{a: 1}} />);
    expect(textOf(tree, 'result-panel-copy-label')).toBe('Copy');

    ReactTestRenderer.act(() => {
      findPressable(tree, 'result-panel-copy').props.onPress();
    });
    expect(textOf(tree, 'result-panel-copy-label')).toBe('Copied');

    ReactTestRenderer.act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(textOf(tree, 'result-panel-copy-label')).toBe('Copy');
  } finally {
    jest.useRealTimers();
  }
});
