import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  RecentlyViewedWidget,
  getRecentPages,
  setRecentPagesForParity,
  type RecentEntry,
} from '../src/web-parity/features/dashboard/components/RecentlyViewedWidget';

/**
 * Native parity contract for RecentlyViewedWidget.
 *
 * The web widget renders the top-N entries from the client-side `recentPages`
 * store as router <Link> rows (icon + title + relative time), updating live via
 * `subscribeRecentPages`, and shows a non-actionable hint when the list is empty.
 * The native port keeps the state-driven `useRecentPages` subscription, the
 * `formatRelative` thresholds, the per-row testIDs, and the empty-state hint,
 * swapping the browser-only localStorage store for an in-memory native seam and
 * the <Link> for a Pressable + onNavigate(path). These tests assert that
 * behaviour.
 */

type Tree = ReactTestRenderer.ReactTestRenderer;

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

function hostsWithTestId(tree: Tree, testID: string) {
  return tree.root.findAll(
    n => n.props?.testID === testID && typeof n.type === 'string',
  );
}

function pressableWithTestId(tree: Tree, testID: string) {
  return tree.root.find(
    n => n.props?.testID === testID && typeof n.props?.onPress === 'function',
  );
}

const NOW = Date.UTC(2026, 5, 26, 12, 0, 0);

function entry(overrides: Partial<RecentEntry> = {}): RecentEntry {
  return {
    path: '/vehicles/1',
    title: 'Roadrunner',
    kind: 'vehicle',
    visited_at: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  setRecentPagesForParity([]);
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
  setRecentPagesForParity([]);
});

test('shows the non-actionable empty hint and no list when the store is empty', () => {
  const tree = render(<RecentlyViewedWidget />);

  expect(hostsWithTestId(tree, 'recently-viewed-widget').length).toBe(1);
  expect(hostsWithTestId(tree, 'recently-viewed-empty').length).toBe(1);
  expect(hostsWithTestId(tree, 'recently-viewed-list').length).toBe(0);
  expect(json(tree)).toContain(
    'Pages you visit will appear here for quick access.',
  );
  expect(json(tree)).toContain('Recently Viewed');

  ReactTestRenderer.act(() => tree.unmount());
});

test('renders one row per stored entry with title and relative time', () => {
  setRecentPagesForParity([
    entry({path: '/vehicles/1', title: 'Roadrunner', visited_at: NOW}),
    entry({
      path: '/drives/9',
      title: 'Morning commute',
      kind: 'drive',
      visited_at: NOW - 5 * 60_000,
    }),
    entry({
      path: '/charging/4',
      title: 'Garage charge',
      kind: 'charging',
      visited_at: NOW - 3 * 60 * 60_000,
    }),
  ]);

  const tree = render(<RecentlyViewedWidget />);

  expect(hostsWithTestId(tree, 'recently-viewed-list').length).toBe(1);
  expect(hostsWithTestId(tree, 'recently-viewed-empty').length).toBe(0);
  expect(pressableWithTestId(tree, 'recently-viewed-row-/vehicles/1')).toBeDefined();
  expect(pressableWithTestId(tree, 'recently-viewed-row-/drives/9')).toBeDefined();
  expect(pressableWithTestId(tree, 'recently-viewed-row-/charging/4')).toBeDefined();

  const serialized = json(tree);
  expect(serialized).toContain('Roadrunner');
  expect(serialized).toContain('Morning commute');
  expect(serialized).toContain('Garage charge');
  // formatRelative thresholds: just now, minutes, hours.
  expect(serialized).toContain('Just now');
  expect(serialized).toContain('5m');
  expect(serialized).toContain('3h');

  ReactTestRenderer.act(() => tree.unmount());
});

test('honours the limit prop (defaults to 5, capping the rows shown)', () => {
  setRecentPagesForParity(
    Array.from({length: 8}, (_, i) =>
      entry({path: `/vehicles/${i}`, title: `Vehicle ${i}`, visited_at: NOW - i}),
    ),
  );

  const dflt = render(<RecentlyViewedWidget />);
  expect(getRecentPages(5)).toHaveLength(5);
  for (let i = 0; i < 5; i += 1) {
    expect(
      pressableWithTestId(dflt, `recently-viewed-row-/vehicles/${i}`),
    ).toBeDefined();
  }
  expect(
    hostsWithTestId(dflt, 'recently-viewed-row-/vehicles/5').length,
  ).toBe(0);
  ReactTestRenderer.act(() => dflt.unmount());

  const limited = render(<RecentlyViewedWidget limit={2} />);
  expect(
    pressableWithTestId(limited, 'recently-viewed-row-/vehicles/0'),
  ).toBeDefined();
  expect(
    pressableWithTestId(limited, 'recently-viewed-row-/vehicles/1'),
  ).toBeDefined();
  expect(
    hostsWithTestId(limited, 'recently-viewed-row-/vehicles/2').length,
  ).toBe(0);
  ReactTestRenderer.act(() => limited.unmount());
});

test('calls onNavigate with the entry path verbatim when a row is pressed', () => {
  setRecentPagesForParity([entry({path: '/trips/7', title: 'Road trip', kind: 'trip'})]);
  const onNavigate = jest.fn();

  const tree = render(<RecentlyViewedWidget onNavigate={onNavigate} />);
  const row = pressableWithTestId(tree, 'recently-viewed-row-/trips/7');
  expect(row.props.accessibilityLabel).toBe('Road trip');

  ReactTestRenderer.act(() => {
    row.props.onPress();
  });
  expect(onNavigate).toHaveBeenCalledTimes(1);
  expect(onNavigate).toHaveBeenCalledWith('/trips/7');

  ReactTestRenderer.act(() => tree.unmount());
});

test('updates live when the store changes via the subscription', () => {
  const tree = render(<RecentlyViewedWidget />);
  expect(hostsWithTestId(tree, 'recently-viewed-empty').length).toBe(1);

  ReactTestRenderer.act(() => {
    setRecentPagesForParity([
      entry({
        path: '/year-review/2026',
        title: '2026 Year in Review',
        kind: 'year-review',
        visited_at: NOW - 25 * 60 * 60_000,
      }),
    ]);
  });

  expect(hostsWithTestId(tree, 'recently-viewed-empty').length).toBe(0);
  expect(
    pressableWithTestId(tree, 'recently-viewed-row-/year-review/2026'),
  ).toBeDefined();
  const serialized = json(tree);
  expect(serialized).toContain('2026 Year in Review');
  // 25h ago rounds to the day threshold.
  expect(serialized).toContain('1d');

  ReactTestRenderer.act(() => tree.unmount());
});
