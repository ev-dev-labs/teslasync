import React from 'react';
import { StyleSheet } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

import {
  KioskOverlay,
  type KioskConfig,
} from '../src/web-parity/features/dashboard/components/KioskOverlay';

/**
 * Native parity contract for KioskOverlay.
 *
 * The web component is the Kiosk-mode chrome overlay: an ambient dim layer, a
 * cursor-hiding CSS injector, an optional corner clock, a dashboard-rotation dot
 * indicator, and a top-right "Exit Kiosk" button that fades in on interaction.
 * The native port keeps every state name (now, showExit), the clock-tick + 3s
 * exit-hint timers, the conditional layers, and the exit action, swapping the
 * DOM/lucide/web-Button pieces for RN primitives. These tests assert that
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

// Host (string-typed) instances only, so a testID shared by a composite + its
// host node is counted once.
function hostsWithTestId(tree: Tree, testID: string) {
  return tree.root.findAll(
    n => n.props?.testID === testID && typeof n.type === 'string',
  );
}

// The pressable instance (not its host View) carries onPress.
function pressableWithTestId(tree: Tree, testID: string) {
  return tree.root.find(
    n => n.props?.testID === testID && typeof n.props?.onPress === 'function',
  );
}

const BASE_CONFIG: KioskConfig = {
  rotateInterval: 30,
  dashboardIds: [],
  hideCursor: true,
  cursorTimeout: 5,
  dimAfter: 0,
  dimLevel: 0.5,
  showClock: true,
  clockPosition: 'bottom-right',
  widgetOpacity: 1,
  backgroundOpacity: 1,
};

function makeConfig(overrides: Partial<KioskConfig> = {}): KioskConfig {
  return { ...BASE_CONFIG, ...overrides };
}

test('renders the exit button and fires onExit when pressed', () => {
  const onExit = jest.fn();
  const tree = render(
    <KioskOverlay
      config={makeConfig({ showClock: false })}
      currentIndex={0}
      dashboardCount={1}
      isCursorHidden={false}
      isDimmed={false}
      onExit={onExit}
    />,
  );

  const exit = pressableWithTestId(tree, 'kiosk-exit');
  expect(exit).toBeDefined();
  expect(exit.props.accessibilityLabel).toBe('Exit kiosk mode');
  expect(json(tree)).toContain('Exit Kiosk');

  ReactTestRenderer.act(() => {
    exit.props.onPress();
  });
  expect(onExit).toHaveBeenCalledTimes(1);

  ReactTestRenderer.act(() => tree.unmount());
});

test('shows the corner clock when showClock is true and omits it when false', () => {
  const shown = render(
    <KioskOverlay
      config={makeConfig({ showClock: true })}
      currentIndex={0}
      dashboardCount={1}
      isCursorHidden={false}
      isDimmed={false}
      onExit={jest.fn()}
    />,
  );
  expect(hostsWithTestId(shown, 'kiosk-clock').length).toBe(1);
  ReactTestRenderer.act(() => shown.unmount());

  const hidden = render(
    <KioskOverlay
      config={makeConfig({ showClock: false })}
      currentIndex={0}
      dashboardCount={1}
      isCursorHidden={false}
      isDimmed={false}
      onExit={jest.fn()}
    />,
  );
  expect(hostsWithTestId(hidden, 'kiosk-clock').length).toBe(0);
  ReactTestRenderer.act(() => hidden.unmount());
});

test('renders one rotation dot per dashboard with the active dot widened', () => {
  const tree = render(
    <KioskOverlay
      config={makeConfig({ rotateInterval: 30, showClock: false })}
      currentIndex={1}
      dashboardCount={4}
      isCursorHidden={false}
      isDimmed={false}
      onExit={jest.fn()}
    />,
  );

  const dots = hostsWithTestId(tree, 'kiosk-dot');
  expect(dots.length).toBe(4);
  const widths = dots.map(d => StyleSheet.flatten(d.props.style).width);
  expect(widths).toEqual([6, 24, 6, 6]);

  ReactTestRenderer.act(() => tree.unmount());
});

test('omits the rotation dots with one dashboard or rotation disabled', () => {
  const single = render(
    <KioskOverlay
      config={makeConfig({ rotateInterval: 30, showClock: false })}
      currentIndex={0}
      dashboardCount={1}
      isCursorHidden={false}
      isDimmed={false}
      onExit={jest.fn()}
    />,
  );
  expect(hostsWithTestId(single, 'kiosk-dots').length).toBe(0);
  ReactTestRenderer.act(() => single.unmount());

  const noRotate = render(
    <KioskOverlay
      config={makeConfig({ rotateInterval: 0, showClock: false })}
      currentIndex={0}
      dashboardCount={3}
      isCursorHidden={false}
      isDimmed={false}
      onExit={jest.fn()}
    />,
  );
  expect(hostsWithTestId(noRotate, 'kiosk-dots').length).toBe(0);
  ReactTestRenderer.act(() => noRotate.unmount());
});

test('renders the dim layer at opacity 1 - dimLevel only when dimmed', () => {
  const dimmed = render(
    <KioskOverlay
      config={makeConfig({ dimLevel: 0.3, showClock: false })}
      currentIndex={0}
      dashboardCount={1}
      isCursorHidden={false}
      isDimmed
      onExit={jest.fn()}
    />,
  );
  const [dim] = hostsWithTestId(dimmed, 'kiosk-dim');
  expect(dim).toBeDefined();
  expect(StyleSheet.flatten(dim.props.style).opacity).toBeCloseTo(0.7);
  ReactTestRenderer.act(() => dimmed.unmount());

  const undimmed = render(
    <KioskOverlay
      config={makeConfig({ showClock: false })}
      currentIndex={0}
      dashboardCount={1}
      isCursorHidden={false}
      isDimmed={false}
      onExit={jest.fn()}
    />,
  );
  expect(hostsWithTestId(undimmed, 'kiosk-dim').length).toBe(0);
  ReactTestRenderer.act(() => undimmed.unmount());
});

test('the exit hint is hidden initially, reveals on interaction, and auto-hides after 3s', () => {
  jest.useFakeTimers();
  try {
    const tree = render(
      <KioskOverlay
        config={makeConfig({ showClock: false })}
        currentIndex={0}
        dashboardCount={1}
        isCursorHidden={false}
        isDimmed={false}
        onExit={jest.fn()}
      />,
    );

    const wrapOpacity = () =>
      StyleSheet.flatten(hostsWithTestId(tree, 'kiosk-exit-wrap')[0].props.style)
        .opacity;
    const [root] = hostsWithTestId(tree, 'kiosk-root');

    expect(wrapOpacity()).toBe(0);

    ReactTestRenderer.act(() => {
      root.props.onTouchStart();
    });
    expect(wrapOpacity()).toBe(1);

    ReactTestRenderer.act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(wrapOpacity()).toBe(0);

    ReactTestRenderer.act(() => tree.unmount());
  } finally {
    jest.useRealTimers();
  }
});
