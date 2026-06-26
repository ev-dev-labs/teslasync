import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  WidgetRankedList,
  type RankedItem,
} from '../src/web-parity/features/dashboard/widgets/shared/WidgetRankedList';

/**
 * Native parity contract for the shared dashboard WidgetRankedList.
 *
 * The web component sorts items by value descending, caps them at a limit
 * (compact -> 3, else 5, overridable via maxItems), draws an optional
 * translucent rank bar per row (hidden when compact or showBars=false), and
 * renders an EmptyState when there is nothing to show. These tests assert that
 * behaviour against the native port: sort + limit, bar suppression, badge
 * variant mapping (error -> danger), value rendering, and the empty state.
 */

type Tree = ReactTestRenderer.ReactTestRenderer;

// Tailwind bg-blue-400 -> native default bar colour; danger badge foreground.
const BAR_COLOR = '#60a5fa';
const DANGER_FG = '#fb7185';

const ITEMS: RankedItem[] = [
  {id: 'a', label: 'Alpha', value: 10, formattedValue: '10 kWh'},
  {id: 'b', label: 'Bravo', value: 30, formattedValue: '30 kWh'},
  {id: 'c', label: 'Charlie', value: 20, formattedValue: '20 kWh'},
  {id: 'd', label: 'Delta', value: 5, formattedValue: '5 kWh'},
  {id: 'e', label: 'Echo', value: 40, formattedValue: '40 kWh'},
  {id: 'f', label: 'Foxtrot', value: 1, formattedValue: '1 kWh'},
];

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

test('sorts by value descending and caps at the default limit of 5', () => {
  const tree = render(<WidgetRankedList items={ITEMS} />);
  const s = json(tree);

  // Echo(40) > Bravo(30) > Charlie(20) > Alpha(10) > Delta(5); Foxtrot(1) cut.
  expect(s).toContain('Echo');
  expect(s).toContain('Bravo');
  expect(s).toContain('Charlie');
  expect(s).toContain('Alpha');
  expect(s).toContain('Delta');
  expect(s).not.toContain('Foxtrot');

  expect(s.indexOf('Echo')).toBeLessThan(s.indexOf('Bravo'));
  expect(s.indexOf('Bravo')).toBeLessThan(s.indexOf('Charlie'));
  expect(s.indexOf('Charlie')).toBeLessThan(s.indexOf('Alpha'));
  expect(s.indexOf('Charlie')).toBeLessThan(s.indexOf('Delta'));

  // Default (non-compact, showBars) renders the translucent rank bar.
  expect(s).toContain(BAR_COLOR);
  // Formatted values are rendered verbatim.
  expect(s).toContain('40 kWh');

  ReactTestRenderer.act(() => tree.unmount());
});

test('maxItems overrides the default limit', () => {
  const tree = render(<WidgetRankedList items={ITEMS} maxItems={2} />);
  const s = json(tree);

  expect(s).toContain('Echo');
  expect(s).toContain('Bravo');
  expect(s).not.toContain('Charlie');

  ReactTestRenderer.act(() => tree.unmount());
});

test('compact caps at 3 items and hides the bars', () => {
  const tree = render(<WidgetRankedList compact items={ITEMS} />);
  const s = json(tree);

  expect(s).toContain('Echo');
  expect(s).toContain('Bravo');
  expect(s).toContain('Charlie');
  expect(s).not.toContain('Alpha');
  // compact -> hideBars: no translucent rank bar.
  expect(s).not.toContain(BAR_COLOR);

  ReactTestRenderer.act(() => tree.unmount());
});

test('showBars=false hides the bars without changing the limit', () => {
  const tree = render(<WidgetRankedList items={ITEMS} showBars={false} />);
  const s = json(tree);

  // Still 5 items (non-compact), but no bar colour anywhere.
  expect(s).toContain('Delta');
  expect(s).not.toContain(BAR_COLOR);

  ReactTestRenderer.act(() => tree.unmount());
});

test('maps the error badge variant to the danger palette', () => {
  const items: RankedItem[] = [
    {
      id: 1,
      label: 'Overheating',
      value: 99,
      formattedValue: '99°C',
      badge: {text: 'Hot', variant: 'error'},
    },
  ];
  const tree = render(<WidgetRankedList items={items} />);
  const s = json(tree);

  expect(s).toContain('Hot');
  // badgeVariantMap.error -> 'danger' -> dangerous foreground token.
  expect(s).toContain(DANGER_FG);

  ReactTestRenderer.act(() => tree.unmount());
});

test('renders an EmptyState with the message when there are no items', () => {
  const tree = render(
    <WidgetRankedList emptyMessage="Nothing here yet" items={[]} />,
  );
  const s = json(tree);

  expect(s).toContain('Nothing here yet');
  expect(s).toContain('empty-state');
  // No rows -> no bar colour.
  expect(s).not.toContain(BAR_COLOR);

  ReactTestRenderer.act(() => tree.unmount());
});

test('falls back to the default empty message', () => {
  const tree = render(<WidgetRankedList items={[]} />);
  expect(json(tree)).toContain('No data available');
  ReactTestRenderer.act(() => tree.unmount());
});
