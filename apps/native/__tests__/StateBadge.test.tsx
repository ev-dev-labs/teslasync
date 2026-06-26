import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {StateBadge} from '../src/web-parity/features/system/components/StateBadge';
import {colors} from '../src/theme/tokens';

/**
 * Native parity contract for the FSM StateBadge pill.
 *
 * The web component renders a rounded-full badge tinted by getStateColor(fsmType,
 * state): a `.bg` background, a leading `.dot` status dot, and the lowercase
 * state name in the `.text` color. These tests assert the native port resolves
 * the same three channels for representative states — including the per-state
 * overrides (command.gave_up red-500 + red-600/10, automation.disabled
 * red-400/50 alpha), the case-insensitive lookup, the unknown-state neutral
 * fallback, and the unknown-fsmType -> vehicle-table fallback — and renders the
 * state label.
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

test('renders the state label and resolves the vehicle.charging cyan colors', () => {
  const tree = render(<StateBadge state="charging" fsmType="vehicle" />);
  const s = json(tree);

  // Label text.
  expect(s).toContain('charging');
  // .bg (bg-cyan-500/10), .text + .dot (cyan-400) all present.
  expect(s).toContain('rgba(6,182,212,0.1)');
  expect(s).toContain('#22d3ee');

  ReactTestRenderer.act(() => tree.unmount());
});

test('applies the command.gave_up override (red-500 text/dot, red-600/10 bg)', () => {
  const tree = render(<StateBadge state="gave_up" fsmType="command" />);
  const s = json(tree);

  expect(s).toContain('gave_up');
  expect(s).toContain('#ef4444'); // red-500 text + dot
  expect(s).toContain('rgba(220,38,38,0.1)'); // red-600/10 bg

  ReactTestRenderer.act(() => tree.unmount());
});

test('applies the automation.disabled alpha override (red-400/50 text/dot, red-500/5 bg)', () => {
  const tree = render(<StateBadge state="disabled" fsmType="automation" />);
  const s = json(tree);

  expect(s).toContain('rgba(248,113,113,0.5)'); // red-400/50 text + dot
  expect(s).toContain('rgba(239,68,68,0.05)'); // red-500/5 bg

  ReactTestRenderer.act(() => tree.unmount());
});

test('matches the state name case-insensitively', () => {
  // Upper-case input resolves to the same cyan as lower-case 'charging'.
  const tree = render(<StateBadge state="CHARGING" fsmType="vehicle" />);
  const s = json(tree);

  expect(s).toContain('CHARGING'); // label rendered verbatim
  expect(s).toContain('#22d3ee'); // resolved via toLowerCase()

  ReactTestRenderer.act(() => tree.unmount());
});

test('falls back to the neutral default for an unknown state', () => {
  const tree = render(<StateBadge state="bogus" fsmType="vehicle" />);
  const s = json(tree);

  expect(s).toContain('bogus');
  expect(s).toContain('rgba(107,114,128,0.1)'); // neutral gray-500/10 bg
  expect(s).toContain('#9ca3af'); // neutral gray-400 dot
  expect(s).toContain(colors.textMuted); // neutral muted text

  ReactTestRenderer.act(() => tree.unmount());
});

test('falls back to the vehicle table for an unknown fsmType', () => {
  // Unknown fsmType -> vehicle table; 'online' there resolves to green-400.
  const tree = render(<StateBadge state="online" fsmType="nope" />);
  const s = json(tree);

  expect(s).toContain('online');
  expect(s).toContain('#4ade80'); // vehicle.online green-400
  expect(s).toContain('rgba(34,197,94,0.1)'); // green-500/10 bg

  ReactTestRenderer.act(() => tree.unmount());
});
