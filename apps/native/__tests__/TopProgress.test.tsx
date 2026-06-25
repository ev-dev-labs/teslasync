import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  TopProgress,
  globalProgress,
  TRICKLE_INITIAL,
  TRICKLE_TARGET,
  __getGlobalProgressStateForTests,
  __resetGlobalProgressForTests,
} from '../src/web-parity/components/feedback/TopProgress';

/**
 * Native parity contract for TopProgress.
 *
 * The web bar subscribes to the @/lib/globalProgress singleton and shows a slim
 * top strip while at least one consumer is active. The native port inlines a
 * faithful copy of that controller, so these tests drive the bar exactly as the
 * web app does — via globalProgress.start()/stop() — and assert the same
 * lifecycle: hidden until a consumer starts, the progressbar a11y semantics on
 * show, the stacked start/stop concurrency contract, the idempotent stop, the
 * asymptotic trickle, and listener cleanup on unmount.
 */

type Tree = ReactTestRenderer.ReactTestRenderer;

function render(): Tree {
  let tree!: Tree;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<TopProgress />);
  });
  return tree;
}

// React Native yields two matching instances for a testID (the forwardRef
// composite + the host node); collapse to a 0/1 presence count.
function barPresent(tree: Tree): boolean {
  return tree.root.findAllByProps({testID: 'top-progress'}).length > 0;
}

function barNode(tree: Tree) {
  return tree.root.findAllByProps({accessibilityRole: 'progressbar'})[0];
}

beforeEach(() => {
  __resetGlobalProgressForTests();
  jest.useFakeTimers();
});

afterEach(() => {
  __resetGlobalProgressForTests();
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('renders nothing until a consumer starts', () => {
  const tree = render();

  expect(tree.toJSON()).toBeNull();
  expect(barPresent(tree)).toBe(false);

  ReactTestRenderer.act(() => tree.unmount());
});

test('appears when a consumer starts and exposes progressbar a11y', () => {
  const tree = render();

  let stop!: () => void;
  ReactTestRenderer.act(() => {
    stop = globalProgress.start();
  });

  expect(barPresent(tree)).toBe(true);

  const node = barNode(tree);
  expect(node.props.accessibilityRole).toBe('progressbar');
  expect(node.props.accessibilityLabel).toBe('Loading');
  expect(node.props.accessibilityValue).toEqual({
    min: 0,
    max: 100,
    now: TRICKLE_INITIAL,
  });
  expect(node.props.pointerEvents).toBe('none');

  ReactTestRenderer.act(() => stop());
  ReactTestRenderer.act(() => tree.unmount());
});

test('snaps away when the last consumer stops', () => {
  const tree = render();

  let stop!: () => void;
  ReactTestRenderer.act(() => {
    stop = globalProgress.start();
  });
  expect(barPresent(tree)).toBe(true);

  ReactTestRenderer.act(() => stop());

  expect(barPresent(tree)).toBe(false);
  expect(tree.toJSON()).toBeNull();

  ReactTestRenderer.act(() => tree.unmount());
});

test('stacks concurrent starts — the bar stays until the last stop fires', () => {
  const tree = render();

  let stopA!: () => void;
  let stopB!: () => void;
  ReactTestRenderer.act(() => {
    stopA = globalProgress.start();
    stopB = globalProgress.start();
  });

  expect(__getGlobalProgressStateForTests().activeCount).toBe(2);
  expect(barPresent(tree)).toBe(true);

  ReactTestRenderer.act(() => stopA());
  expect(__getGlobalProgressStateForTests().activeCount).toBe(1);
  expect(barPresent(tree)).toBe(true);

  ReactTestRenderer.act(() => stopB());
  expect(__getGlobalProgressStateForTests().activeCount).toBe(0);
  expect(barPresent(tree)).toBe(false);

  ReactTestRenderer.act(() => tree.unmount());
});

test('stop is idempotent — a double-invoked stop cannot underflow activeCount', () => {
  const tree = render();

  let stopA!: () => void;
  let stopB!: () => void;
  ReactTestRenderer.act(() => {
    stopA = globalProgress.start();
    stopB = globalProgress.start();
  });

  // StrictMode double-invokes effect cleanups; stopA firing twice must not push
  // activeCount below the still-active second consumer.
  ReactTestRenderer.act(() => {
    stopA();
    stopA();
  });

  expect(__getGlobalProgressStateForTests().activeCount).toBe(1);
  expect(barPresent(tree)).toBe(true);

  ReactTestRenderer.act(() => stopB());
  expect(__getGlobalProgressStateForTests().activeCount).toBe(0);
  expect(barPresent(tree)).toBe(false);

  ReactTestRenderer.act(() => tree.unmount());
});

test('the trickle advances progress toward the 80% target', () => {
  const tree = render();

  let stop!: () => void;
  ReactTestRenderer.act(() => {
    stop = globalProgress.start();
  });
  expect(barNode(tree).props.accessibilityValue.now).toBe(TRICKLE_INITIAL);

  ReactTestRenderer.act(() => {
    jest.advanceTimersByTime(1200);
  });

  const now = barNode(tree).props.accessibilityValue.now;
  expect(now).toBeGreaterThan(TRICKLE_INITIAL);
  expect(now).toBeLessThanOrEqual(TRICKLE_TARGET);

  ReactTestRenderer.act(() => stop());
  ReactTestRenderer.act(() => tree.unmount());
});

test('unsubscribes from the controller on unmount', () => {
  const tree = render();

  expect(__getGlobalProgressStateForTests().listeners).toBeGreaterThanOrEqual(1);

  ReactTestRenderer.act(() => tree.unmount());

  expect(__getGlobalProgressStateForTests().listeners).toBe(0);

  // A later start must not resurrect the unmounted bar.
  ReactTestRenderer.act(() => {
    globalProgress.start();
  });
  expect(tree.toJSON()).toBeNull();
});
