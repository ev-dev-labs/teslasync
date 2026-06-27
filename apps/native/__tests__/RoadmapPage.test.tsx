import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import RoadmapPage from '../src/web-parity/features/system/pages/RoadmapPage';

/**
 * Native parity contract for RoadmapPage.
 *
 * The web page is a static product roadmap: a PageContainer (title + subtitle)
 * with a phase-progress bar (done/current/next/future markers + counts) followed
 * by one section per phase, each a colored heading above a grid of RoadmapCards
 * (tinted icon + title + description + phase badge + bulleted feature list). It
 * makes no API calls, so the native port needs no QueryClient — these tests
 * render the page directly and assert the header, every phase label, the per-
 * phase counts, representative card titles spanning all four phases, and feature
 * strings all render.
 */

type Tree = ReactTestRenderer.ReactTestRenderer;

// Drain microtasks + the FadeIn AccessibilityInfo.isReduceMotionEnabled promise
// chain inside act so every pending setState settles while the tree is mounted.
async function flush(): Promise<void> {
  await ReactTestRenderer.act(async () => {
    await new Promise<void>(resolve => setImmediate(() => resolve()));
  });
}

async function renderPage(): Promise<Tree> {
  let tree!: Tree;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<RoadmapPage />);
  });
  await flush();
  return tree;
}

async function teardown(tree: Tree): Promise<void> {
  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
  await flush();
}

test('renders the page header and all four phase labels', async () => {
  const tree = await renderPage();
  const body = JSON.stringify(tree.toJSON());

  // Page header (title + subtitle).
  expect(body).toContain('Roadmap');
  expect(body).toContain(
    "What's been built, what's in progress, and what's coming next",
  );

  // All four phase labels (progress bar + section headings).
  expect(body).toContain('Completed');
  expect(body).toContain('In Progress');
  expect(body).toContain('Up Next');
  expect(body).toContain('Future');

  await teardown(tree);
});

test('renders representative cards from every phase with descriptions', async () => {
  const tree = await renderPage();
  const body = JSON.stringify(tree.toJSON());

  // done
  expect(body).toContain('Core Platform');
  expect(body).toContain('Premium UI & Design System');
  // current
  expect(body).toContain('External Integrations');
  // next
  expect(body).toContain('Enhanced Visualization');
  expect(body).toContain('Helix & Predictive Analytics');
  // future
  expect(body).toContain('Mobile App');
  expect(body).toContain('Global & Multi-Brand');

  // A card description + a couple of feature strings render.
  expect(body).toContain(
    'Real-time fleet monitoring, analytics, and vehicle control',
  );
  expect(body).toContain('Real-time vehicle state tracking via SSE');
  expect(body).toContain('Native iOS and Android apps (React Native)');

  await teardown(tree);
});
