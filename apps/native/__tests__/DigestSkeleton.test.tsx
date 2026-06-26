import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {DigestSkeleton} from '../src/web-parity/features/analytics/components/weekly-digest/DigestSkeleton';

/**
 * Native parity contract for DigestSkeleton.
 *
 * The web component is the Weekly Digest loading placeholder: a FadeIn-wrapped
 * column of three GlassPanels — a 2-line text Skeleton, a responsive grid of
 * six height-80 Skeleton tiles, and a single height-260 chart Skeleton. The
 * native port keeps that exact structure with the already-ported native
 * GlassPanel / Skeleton / FadeIn.
 */

type Tree = ReactTestRenderer.ReactTestRenderer;

function render(node: React.ReactElement): Tree {
  let tree!: Tree;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(node);
  });
  return tree;
}

test('renders three panels with eight host Skeleton placeholders', () => {
  const tree = render(<DigestSkeleton />);

  // Renders without throwing.
  expect(tree.toJSON()).not.toBeNull();

  // Each Skeleton's testID propagates to its host instance; filter to host
  // (string-typed) nodes to count the bars exactly: the 2-line group (1) + the
  // six grid tiles (6) + the chart bar (1) = 8.
  expect(
    tree.root.findAll(
      n => n.props?.testID === 'skeleton' && typeof n.type === 'string',
    ).length,
  ).toBe(8);

  ReactTestRenderer.act(() => tree.unmount());
});
