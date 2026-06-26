import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {FSMStateDiagram} from '../src/web-parity/features/system/components/FSMStateDiagram';
import type {FSMTransition} from '../src/web-parity/api/hooks/useFSM';

/**
 * Native parity contract for the State-Machine Debugger FSMStateDiagram.
 *
 * The web component renders a "State Diagram" panel: a wrapping row of FSM state
 * nodes (status dot + name + live hit-count + current-state marker) joined by
 * arrows carrying per-edge counts, then a top-10 busiest-edge summary. When the
 * requested FSM type has no diagram (e.g. the aggregate 'all'), it shows the
 * title plus an EmptyState prompt. These tests assert that behaviour against the
 * native port: the empty-type prompt, the per-type node rendering with live
 * counts derived from the transitions, the fsm_name filtering, and the
 * busiest-edge summary chips.
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

function tr(
  id: number,
  fsmName: string,
  from: string,
  to: string,
  ts: string,
): FSMTransition {
  return {
    id,
    vehicle_id: 1,
    ts,
    fsm_name: fsmName,
    from_state: from,
    to_state: to,
    trigger: 'manual',
  };
}

test('shows the title + prompt and no state nodes for an FSM type with no diagram', () => {
  const tree = render(<FSMStateDiagram fsmType="all" transitions={[]} />);
  const s = json(tree);

  expect(s).toContain('State Diagram');
  expect(s).toContain('Select a specific FSM type');
  // No concrete diagram: vehicle/telemetry state nodes are not rendered.
  expect(s).not.toContain('online');

  ReactTestRenderer.act(() => tree.unmount());
});

test('renders the vehicle state nodes, live counts, and busiest-edge summary', () => {
  const transitions = [
    tr(1, 'vehicle', 'online', 'driving', '2026-01-01T00:00:00Z'),
    tr(2, 'vehicle', 'driving', 'parked', '2026-01-01T00:01:00Z'),
    tr(3, 'vehicle', 'parked', 'charging', '2026-01-01T00:02:00Z'),
  ];
  const tree = render(<FSMStateDiagram fsmType="vehicle" transitions={transitions} />);
  const s = json(tree);

  expect(s).toContain('State Diagram');
  // Every vehicle state node is rendered (always shown, even with zero count).
  for (const state of ['online', 'driving', 'charging', 'parked', 'updating', 'asleep', 'offline']) {
    expect(s).toContain(state);
  }
  // Arrows connect consecutive nodes.
  expect(s).toContain('→');
  // The busiest-edge summary renders ×count chips for the observed edges.
  expect(s).toContain('×');

  ReactTestRenderer.act(() => tree.unmount());
});

test('ignores transitions whose fsm_name does not match the selected type', () => {
  // A telemetry transition while viewing the vehicle FSM must not contribute to
  // the vehicle edge summary, so no ×count chip is produced.
  const transitions = [
    tr(1, 'telemetry_connection', 'connecting', 'streaming', '2026-01-01T00:00:00Z'),
  ];
  const tree = render(<FSMStateDiagram fsmType="vehicle" transitions={transitions} />);
  const s = json(tree);

  expect(s).toContain('State Diagram');
  expect(s).not.toContain('×');

  ReactTestRenderer.act(() => tree.unmount());
});

test('renders the telemetry-connection diagram for its own type', () => {
  const transitions = [
    tr(1, 'telemetry_connection', 'connecting', 'streaming', '2026-01-01T00:00:00Z'),
  ];
  const tree = render(
    <FSMStateDiagram fsmType="telemetry_connection" transitions={transitions} />,
  );
  const s = json(tree);

  for (const state of ['unknown', 'connecting', 'streaming', 'stale', 'disconnected', 'polling_only']) {
    expect(s).toContain(state);
  }
  expect(s).toContain('×');

  ReactTestRenderer.act(() => tree.unmount());
});
