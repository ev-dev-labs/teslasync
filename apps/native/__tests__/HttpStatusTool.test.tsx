import React from 'react';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

import {
  HttpStatusTool,
  HTTP_CODES,
} from '../src/web-parity/features/admin/components/devtools/tools/HttpStatusTool';

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
      node.props.testID.startsWith('http-status-table-row-'),
  ).length;
}

function setSearch(tree: Renderer, value: string): void {
  const target = tree.root.find(
    (node: ReactTestInstance) =>
      node.props.testID === 'http-status-search' &&
      typeof node.props.onChangeText === 'function',
  );
  ReactTestRenderer.act(() => {
    target.props.onChangeText(value);
  });
}

/* ── data port ── */

test('HTTP_CODES ports the 19 reference codes in order', () => {
  expect(HTTP_CODES).toHaveLength(19);
  expect(HTTP_CODES[0]).toEqual({code: 200, text: 'OK', desc: 'Request succeeded'});
  expect(HTTP_CODES[HTTP_CODES.length - 1]).toEqual({
    code: 504,
    text: 'Gateway Timeout',
    desc: 'Upstream timeout',
  });
});

/* ── render ── */

test('renders the ToolCard header, search box and all 19 rows', () => {
  const tree = render(<HttpStatusTool />);
  expect(hasHost(tree, 'http-status-search')).toBe(true);
  expect(hasHost(tree, 'http-status-table')).toBe(true);
  expect(countRows(tree)).toBe(19);
  // ToolCard title + description (the t() keys, English defaults).
  const flat = flattenText(tree.toJSON() as JsonNode | null);
  expect(flat).toContain('Http Status');
  expect(flat).toContain('Http Status Desc');
});

/* ── search filter (case-insensitive code|text|desc) ── */

test('filtering by code narrows to a single row', () => {
  const tree = render(<HttpStatusTool />);
  setSearch(tree, '404');
  expect(countRows(tree)).toBe(1);
  expect(hasHost(tree, 'http-status-table-row-404')).toBe(true);
});

test('filtering by description matches case-insensitively across rows', () => {
  const tree = render(<HttpStatusTool />);
  // "timeout" appears in 408 Request Timeout + 504 Gateway Timeout descs/text.
  setSearch(tree, 'TIMEOUT');
  expect(hasHost(tree, 'http-status-table-row-408')).toBe(true);
  expect(hasHost(tree, 'http-status-table-row-504')).toBe(true);
  expect(hasHost(tree, 'http-status-table-row-200')).toBe(false);
});

test('a non-matching search shows the empty state and no rows', () => {
  const tree = render(<HttpStatusTool />);
  setSearch(tree, 'zzzzzz');
  expect(countRows(tree)).toBe(0);
  expect(hasHost(tree, 'http-status-table-empty')).toBe(true);
  expect(textOf(tree, 'http-status-table-empty')).toBe('No data');
});

/* ── badge boundary mapping ── */

test('search restores the full list when cleared', () => {
  const tree = render(<HttpStatusTool />);
  setSearch(tree, '500');
  expect(countRows(tree)).toBe(1);
  setSearch(tree, '');
  expect(countRows(tree)).toBe(19);
});
