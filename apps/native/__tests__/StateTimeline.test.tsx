import React from 'react';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

import {StateTimeline} from '../src/web-parity/features/system/components/state-machine/StateTimeline';
import type {FSMTransition} from '../src/web-parity/api/hooks/useFSM';

type Renderer = ReactTestRenderer.ReactTestRenderer;

function makeTransition(overrides: Partial<FSMTransition>): FSMTransition {
  return {
    id: 1,
    vehicle_id: 1,
    fsm_name: 'vehicle',
    from_state: 'parked',
    to_state: 'driving',
    trigger: 'speed_changed',
    ts: new Date().toISOString(),
    ...overrides,
  };
}

let currentTree: Renderer | null = null;

function render(props: React.ComponentProps<typeof StateTimeline>): Renderer {
  let tree!: Renderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<StateTimeline {...props} />);
  });
  currentTree = tree;
  return tree;
}

function byTestID(tree: Renderer, testID: string): ReactTestInstance[] {
  return tree.root.findAll(
    (node: ReactTestInstance) =>
      typeof node.type === 'string' && node.props.testID === testID,
  );
}

function maybeTestID(tree: Renderer, testID: string): ReactTestInstance | null {
  const matches = byTestID(tree, testID);
  return matches.length > 0 ? matches[0] : null;
}

// Pressable forwards `testID` to its host View but keeps `onPress` on the
// composite instance, so select the node that actually carries the handler.
function press(tree: Renderer, testID: string): void {
  const node = tree.root.findAll(
    (n: ReactTestInstance) =>
      n.props.testID === testID && typeof n.props.onPress === 'function',
  )[0];
  ReactTestRenderer.act(() => {
    node.props.onPress();
  });
}

function hasText(tree: Renderer, text: string): boolean {
  return JSON.stringify(tree.toJSON()).includes(text);
}

afterEach(() => {
  if (currentTree) {
    ReactTestRenderer.act(() => {
      currentTree?.unmount();
    });
    currentTree = null;
  }
});

describe('StateTimeline (native parity)', () => {
  it('shows the empty placeholder when no transitions are in the window', () => {
    const anchor = new Date('2025-01-15T12:00:00Z');
    const tree = render({
      transitions: [],
      fsmType: 'vehicle',
      anchor,
      windowMinutes: 10,
    });

    expect(maybeTestID(tree, 'state-timeline-empty')).not.toBeNull();
    expect(maybeTestID(tree, 'state-timeline')).toBeNull();
    expect(hasText(tree, 'No transitions in window')).toBe(true);
  });

  it('renders only the empty message (no hint, no buttons) when there is no last transition', () => {
    const tree = render({
      transitions: [],
      fsmType: 'vehicle',
      windowMinutes: 10,
    });

    expect(maybeTestID(tree, 'state-timeline-empty')).not.toBeNull();
    expect(maybeTestID(tree, 'state-timeline-widen')).toBeNull();
    expect(maybeTestID(tree, 'state-timeline-jump')).toBeNull();
    expect(hasText(tree, 'Last transition')).toBe(false);
  });

  it('renders the "last transition" hint AND both buttons when a wider preset is provided', () => {
    const last = makeTransition({
      id: 88,
      ts: new Date(Date.now() - 30 * 60_000).toISOString(),
    });
    const onWiden = jest.fn();
    const onJump = jest.fn();
    const tree = render({
      transitions: [],
      fsmType: 'vehicle',
      windowMinutes: 10,
      lastTransition: last,
      widerPreset: 30,
      onWidenWindow: onWiden,
      onJumpToLast: onJump,
    });

    expect(hasText(tree, 'Last transition')).toBe(true);
    expect(hasText(tree, 'Widen window to 30 min')).toBe(true);
    expect(hasText(tree, 'Jump to last transition')).toBe(true);
    expect(maybeTestID(tree, 'state-timeline-widen')).not.toBeNull();
    expect(maybeTestID(tree, 'state-timeline-jump')).not.toBeNull();
  });

  it('invokes onWidenWindow exactly once when the widen button is pressed', () => {
    const last = makeTransition({
      id: 88,
      ts: new Date(Date.now() - 5 * 60_000).toISOString(),
    });
    const onWiden = jest.fn();
    const tree = render({
      transitions: [],
      fsmType: 'vehicle',
      windowMinutes: 10,
      lastTransition: last,
      widerPreset: 30,
      onWidenWindow: onWiden,
    });

    const widen = maybeTestID(tree, 'state-timeline-widen');
    expect(widen).not.toBeNull();
    press(tree, 'state-timeline-widen');
    expect(onWiden).toHaveBeenCalledTimes(1);
  });

  it('invokes onJumpToLast exactly once when the jump button is pressed', () => {
    const last = makeTransition({
      id: 88,
      ts: new Date(Date.now() - 5 * 60_000).toISOString(),
    });
    const onJump = jest.fn();
    const tree = render({
      transitions: [],
      fsmType: 'vehicle',
      windowMinutes: 10,
      lastTransition: last,
      onJumpToLast: onJump,
    });

    const jump = maybeTestID(tree, 'state-timeline-jump');
    expect(jump).not.toBeNull();
    press(tree, 'state-timeline-jump');
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it('renders the jump button but NOT the widen button when no preset fits', () => {
    const last = makeTransition({
      id: 88,
      ts: new Date(Date.now() - 25 * 60 * 60_000).toISOString(),
    });
    const onJump = jest.fn();
    const tree = render({
      transitions: [],
      fsmType: 'vehicle',
      windowMinutes: 10,
      lastTransition: last,
      widerPreset: null,
      onJumpToLast: onJump,
    });

    expect(maybeTestID(tree, 'state-timeline-widen')).toBeNull();
    expect(maybeTestID(tree, 'state-timeline-jump')).not.toBeNull();
  });

  it('renders one tick per in-window transition and reports presses', () => {
    const anchor = new Date('2025-01-15T12:00:00Z');
    const onSelect = jest.fn();
    const t1 = makeTransition({id: 11, ts: '2025-01-15T11:55:00Z'});
    const t2 = makeTransition({id: 12, ts: '2025-01-15T11:58:00Z'});

    const tree = render({
      transitions: [t1, t2],
      fsmType: 'vehicle',
      anchor,
      windowMinutes: 10,
      onSelect,
    });

    expect(maybeTestID(tree, 'state-timeline')).not.toBeNull();
    expect(maybeTestID(tree, 'state-timeline-tick-11')).not.toBeNull();
    expect(maybeTestID(tree, 'state-timeline-tick-12')).not.toBeNull();

    press(tree, 'state-timeline-tick-12');
    expect(onSelect).toHaveBeenCalledWith(t2);
  });

  it('marks the selected tick via accessibilityState and grows it', () => {
    const anchor = new Date('2025-01-15T12:00:00Z');
    const t1 = makeTransition({id: 21, ts: '2025-01-15T11:55:00Z'});
    const tree = render({
      transitions: [t1],
      fsmType: 'vehicle',
      anchor,
      selectedId: 21,
      windowMinutes: 10,
    });

    const tick = maybeTestID(tree, 'state-timeline-tick-21');
    expect(tick).not.toBeNull();
    expect(tick!.props.accessibilityState).toEqual({selected: true});
    const flat = Object.assign(
      {},
      ...(tick!.props.style as Array<Record<string, unknown>>),
    );
    // selected ticks grow from 10 -> 16 (h-4/w-4)
    expect(flat.width).toBe(16);
    expect(flat.height).toBe(16);
  });

  it('renders the window header label and exposes the tick tooltip + aria label', () => {
    const anchor = new Date('2025-01-15T12:00:00Z');
    const t1 = makeTransition({
      id: 31,
      from_state: 'parked',
      to_state: 'driving',
      ts: '2025-01-15T11:57:00Z',
    });
    const tree = render({
      transitions: [t1],
      fsmType: 'vehicle',
      anchor,
      windowMinutes: 10,
    });

    expect(hasText(tree, 'Window: 10 min')).toBe(true);
    const tick = maybeTestID(tree, 'state-timeline-tick-31');
    expect(tick).not.toBeNull();
    // tick aria label preserves the source "{from} to {to}" intent
    expect(tick!.props.accessibilityLabel).toBe('parked to driving');
    // the web Tooltip content (from -> to · time) survives as accessibilityHint
    expect(tick!.props.accessibilityHint).toContain('parked → driving');
  });
});
