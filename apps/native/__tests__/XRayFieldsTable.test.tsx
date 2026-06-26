import React from 'react';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

import {XRayFieldsTable} from '../src/web-parity/features/admin/components/ingest-xray/XRayFieldsTable';
import type {IngestXRayFieldStat} from '../src/web-parity/api/hooks/useIngestXRay';

type Renderer = ReactTestRenderer.ReactTestRenderer;

type JsonNode = {
  type: string;
  props: {testID?: string; [key: string]: unknown};
  children: Array<JsonNode | string> | null;
};

const TABLE = 'admin:xray-fields';

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

/** Collect, in document (DFS) order, every testID that starts with `prefix`. */
function collectTestIDs(node: JsonNode | string | null, prefix: string): string[] {
  if (!node || typeof node === 'string') {
    return [];
  }
  const out: string[] = [];
  const id = node.props?.testID;
  if (typeof id === 'string' && id.startsWith(prefix)) {
    out.push(id);
  }
  if (node.children) {
    for (const child of node.children) {
      out.push(...collectTestIDs(child, prefix));
    }
  }
  return out;
}

function hasHost(tree: Renderer, testID: string): boolean {
  return findByTestID(tree.toJSON() as JsonNode | null, testID) != null;
}

function textOf(tree: Renderer, testID: string): string {
  return flattenText(findByTestID(tree.toJSON() as JsonNode | null, testID));
}

function treeText(tree: Renderer): string {
  return flattenText(tree.toJSON() as JsonNode | null);
}

function rowOrder(tree: Renderer): string[] {
  return collectTestIDs(tree.toJSON() as JsonNode | null, `${TABLE}-row-`);
}

function tapHeader(tree: Renderer, key: string): void {
  const node = tree.root.find(
    (n: ReactTestInstance) =>
      n.props.testID === `${TABLE}-header-${key}` &&
      typeof n.props.onPress === 'function',
  );
  ReactTestRenderer.act(() => {
    node.props.onPress();
  });
}

function tapTestID(tree: Renderer, testID: string): void {
  const node = tree.root.find(
    (n: ReactTestInstance) =>
      n.props.testID === testID && typeof n.props.onPress === 'function',
  );
  ReactTestRenderer.act(() => {
    node.props.onPress();
  });
}

const minutesAgo = (m: number): string =>
  new Date(Date.now() - m * 60_000).toISOString();

const ROWS: IngestXRayFieldStat[] = [
  {field: 'zeta', sample_count: 10, last_seen_at: minutesAgo(2), value_kind: 1},
  {
    field: 'mike',
    sample_count: 12345,
    last_seen_at: minutesAgo(70),
    value_kind: 6,
  },
  {field: 'delta', sample_count: 500, last_seen_at: minutesAgo(0), value_kind: 10},
];

/* ── headers + cell rendering ── */

test('renders all four column headers with their English defaults', () => {
  const tree = render(<XRayFieldsTable rows={ROWS} loading={false} />);
  expect(textOf(tree, `${TABLE}-header-field`)).toContain('Field');
  expect(textOf(tree, `${TABLE}-header-sample_count`)).toContain('Samples');
  expect(textOf(tree, `${TABLE}-header-last_seen_at`)).toContain('Last seen');
  expect(textOf(tree, `${TABLE}-header-value_kind`)).toContain('Kind');
});

test('renders a row per field with grouped counts and value-kind labels', () => {
  const tree = render(<XRayFieldsTable rows={ROWS} loading={false} />);
  expect(hasHost(tree, `${TABLE}-row-zeta`)).toBe(true);
  expect(hasHost(tree, `${TABLE}-row-mike`)).toBe(true);
  expect(hasHost(tree, `${TABLE}-row-delta`)).toBe(true);

  const all = treeText(tree);
  // fmtInt grouping (12345 -> "12,345") + small value verbatim.
  expect(all).toContain('12,345');
  expect(all).toContain('500');
  // formatValueKind: 6 -> float64, 10 -> location, 1 -> string.
  expect(all).toContain('float64');
  expect(all).toContain('location');
  expect(all).toContain('string');
  // relative TimeStamp body for the just-now row.
  expect(all).toContain('just now');
});

/* ── default + toggled sort ── */

test('defaults to sample_count descending', () => {
  const tree = render(<XRayFieldsTable rows={ROWS} loading={false} />);
  expect(rowOrder(tree)).toEqual([
    `${TABLE}-row-mike`, // 12345
    `${TABLE}-row-delta`, // 500
    `${TABLE}-row-zeta`, // 10
  ]);
});

test('tapping the field header sorts desc then toggles to asc', () => {
  const tree = render(<XRayFieldsTable rows={ROWS} loading={false} />);

  tapHeader(tree, 'field');
  // new key => desc => reverse-alphabetical (zeta, mike, delta).
  expect(rowOrder(tree)).toEqual([
    `${TABLE}-row-zeta`,
    `${TABLE}-row-mike`,
    `${TABLE}-row-delta`,
  ]);

  tapHeader(tree, 'field');
  // same key => toggle asc => alphabetical (delta, mike, zeta).
  expect(rowOrder(tree)).toEqual([
    `${TABLE}-row-delta`,
    `${TABLE}-row-mike`,
    `${TABLE}-row-zeta`,
  ]);
});

test('tapping sample_count header toggles to ascending', () => {
  const tree = render(<XRayFieldsTable rows={ROWS} loading={false} />);
  tapHeader(tree, 'sample_count'); // active key => flip desc -> asc
  expect(rowOrder(tree)).toEqual([
    `${TABLE}-row-zeta`, // 10
    `${TABLE}-row-delta`, // 500
    `${TABLE}-row-mike`, // 12345
  ]);
});

/* ── empty / loading states ── */

test('shows the loading message when empty and loading', () => {
  const tree = render(<XRayFieldsTable rows={[]} loading />);
  expect(hasHost(tree, `${TABLE}-empty`)).toBe(true);
  expect(textOf(tree, `${TABLE}-empty`)).toBe('Loading\u2026');
  expect(rowOrder(tree)).toEqual([]);
});

test('shows the empty-window message when empty and not loading', () => {
  const tree = render(<XRayFieldsTable rows={[]} loading={false} />);
  expect(textOf(tree, `${TABLE}-empty`)).toBe(
    'No samples in this window. Try widening the window or confirm the vehicle is publishing.',
  );
});

/* ── pagination ── */

test('paginates at the default page size of 50 and honours page-size options', () => {
  const many: IngestXRayFieldStat[] = Array.from({length: 60}, (_, i) => ({
    field: `f${String(i).padStart(2, '0')}`,
    sample_count: 60 - i,
    last_seen_at: minutesAgo(i),
    value_kind: 0,
  }));
  const tree = render(<XRayFieldsTable rows={many} loading={false} />);

  expect(hasHost(tree, `${TABLE}-pager`)).toBe(true);
  // 60 rows / default 50 => 2 pages, 50 rows visible on page 1.
  expect(textOf(tree, `${TABLE}-pager-info`)).toBe('1 / 2');
  expect(rowOrder(tree)).toHaveLength(50);

  // Next page shows the remaining 10 rows.
  tapTestID(tree, `${TABLE}-pager-next`);
  expect(textOf(tree, `${TABLE}-pager-info`)).toBe('2 / 2');
  expect(rowOrder(tree)).toHaveLength(10);

  // Switching to page size 25 re-clamps to page 1 with 3 pages.
  tapTestID(tree, `${TABLE}-pagesize-25`);
  expect(textOf(tree, `${TABLE}-pager-info`)).toBe('1 / 3');
  expect(rowOrder(tree)).toHaveLength(25);
});
