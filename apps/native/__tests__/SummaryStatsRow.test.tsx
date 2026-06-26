import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {SummaryStatsRow} from '../src/web-parity/features/admin/components/security-access/SummaryStatsRow';

/**
 * Native parity contract for SummaryStatsRow.
 *
 * The web component renders the admin Security & Access summary stat row: four
 * MetricCards — Current Status (Secure/Unsecure), Last Lock Change (timeSince),
 * Sentry Uptime (fmtInt%), and Total Events (count) — wrapped in a FadeIn, with
 * a four-Skeleton loading state. The native port keeps that structure with an
 * inlined native-safe MetricCard, fmtInt, and timeSince.
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

test('loading state renders four Skeletons and no stat labels', () => {
  const tree = render(
    <SummaryStatsRow
      isLoading
      isSecure
      lastLockChange={undefined}
      sentryUptime={0}
      totalEvents={0}
    />,
  );

  // Each Skeleton's testID propagates to its composite + host instances, so
  // filter to host (string-typed) nodes to count the four loading bars exactly.
  expect(
    tree.root.findAll(
      n => n.props?.testID === 'skeleton' && typeof n.type === 'string',
    ).length,
  ).toBe(4);
  // The stat labels must NOT appear while loading.
  expect(json(tree)).not.toContain('Current Status');

  ReactTestRenderer.act(() => tree.unmount());
});

test('a secure fleet renders the four stat labels and the Secure status', () => {
  const tree = render(
    <SummaryStatsRow
      isLoading={false}
      isSecure
      lastLockChange={undefined}
      sentryUptime={50}
      totalEvents={12}
    />,
  );

  const body = json(tree);
  expect(body).toContain('Current Status');
  expect(body).toContain('Last Lock Change');
  expect(body).toContain('Sentry Uptime');
  expect(body).toContain('Total Events');
  expect(body).toContain('Secure');
  // No Skeletons once loaded.
  expect(tree.root.findAll(n => n.props?.testID === 'skeleton').length).toBe(0);

  ReactTestRenderer.act(() => tree.unmount());
});

test('an unsecure fleet renders the Unsecure status', () => {
  const tree = render(
    <SummaryStatsRow
      isLoading={false}
      isSecure={false}
      lastLockChange={undefined}
      sentryUptime={0}
      totalEvents={0}
    />,
  );

  expect(json(tree)).toContain('Unsecure');

  ReactTestRenderer.act(() => tree.unmount());
});

test('values surface timeSince(—), the fmtInt uptime %, and the total events', () => {
  const tree = render(
    <SummaryStatsRow
      isLoading={false}
      isSecure
      lastLockChange={undefined}
      sentryUptime={87.6}
      totalEvents={1234}
    />,
  );

  const body = json(tree);
  // lastLockChange undefined -> timeSince returns the em dash.
  expect(body).toContain('\u2014');
  // fmtInt(87.6) -> "88", rendered with the trailing percent.
  expect(body).toContain('88%');
  // totalEvents rendered verbatim (raw number, like the web MetricCard).
  expect(body).toContain('1234');

  ReactTestRenderer.act(() => tree.unmount());
});
