import React from 'react';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

import {
  HelpSegment,
  SHORTCUTS_EVENT,
  TOUR_OPEN_LAUNCHER_EVENT,
  FEEDBACK_MODAL_EVENT,
  TOOLTIP_SIDE,
} from '../src/web-parity/components/layout/status-bar/HelpSegment';

type Renderer = ReactTestRenderer.ReactTestRenderer;

// Pressable owns `onPress`; find the single instance that actually carries it.
function press(tree: Renderer, testID: string): void {
  const target = tree.root.find(
    (node: ReactTestInstance) =>
      node.props.testID === testID && typeof node.props.onPress === 'function',
  );
  ReactTestRenderer.act(() => {
    target.props.onPress();
  });
}

// Count host (string-typed) nodes carrying a testID — composite wrappers reuse
// the same testID, so restrict to host instances for accurate presence checks.
function countHost(tree: Renderer, testID: string): number {
  return tree.root.findAll(
    (node: ReactTestInstance) =>
      typeof node.type === 'string' && node.props.testID === testID,
  ).length;
}

function findPressable(tree: Renderer, testID: string): ReactTestInstance {
  return tree.root.find(
    (node: ReactTestInstance) =>
      node.props.testID === testID && typeof node.props.onPress === 'function',
  );
}

function renderSegment(props: {
  iconOnly?: boolean;
  onOpenShortcuts?: () => void;
  onOpenTour?: () => void;
  onOpenFeedback?: () => void;
}) {
  let tree: Renderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<HelpSegment {...props} />);
  });
  return tree!;
}

test('invokes the three host callbacks when each affordance is pressed', () => {
  const onOpenShortcuts = jest.fn();
  const onOpenTour = jest.fn();
  const onOpenFeedback = jest.fn();
  const tree = renderSegment({onOpenShortcuts, onOpenTour, onOpenFeedback});

  press(tree, 'help-segment-shortcuts-trigger');
  press(tree, 'help-segment-tour-trigger');
  press(tree, 'status-bar-feedback-trigger');

  expect(onOpenShortcuts).toHaveBeenCalledTimes(1);
  expect(onOpenTour).toHaveBeenCalledTimes(1);
  expect(onOpenFeedback).toHaveBeenCalledTimes(1);
});

test('pressing an unwired affordance is a no-op (does not throw)', () => {
  const tree = renderSegment({});
  expect(() => {
    press(tree, 'help-segment-shortcuts-trigger');
    press(tree, 'help-segment-tour-trigger');
    press(tree, 'status-bar-feedback-trigger');
  }).not.toThrow();
});

test('renders accessible labels + hints mirroring the web aria + tooltip text', () => {
  const tree = renderSegment({});

  const shortcuts = findPressable(tree, 'help-segment-shortcuts-trigger');
  expect(shortcuts.props.accessibilityLabel).toBe('Open keyboard shortcuts');
  expect(shortcuts.props.accessibilityHint).toBe('Keyboard shortcuts');

  const tour = findPressable(tree, 'help-segment-tour-trigger');
  expect(tour.props.accessibilityLabel).toBe('Open tour launcher');
  expect(tour.props.accessibilityHint).toBe('Take a tour');

  const feedback = findPressable(tree, 'status-bar-feedback-trigger');
  expect(feedback.props.accessibilityLabel).toBe(
    'Open feedback / bug report form',
  );
  expect(feedback.props.accessibilityHint).toBe('Report bug');
});

test('iconOnly hides the `?` shortcut chip', () => {
  // Expanded mode still shows the `?` shortcut-key chip.
  const expanded = renderSegment({iconOnly: false});
  expect(countHost(expanded, 'help-segment-shortcut-key')).toBe(1);

  // Icon-only mode drops the chip (and all suffix labels).
  const compact = renderSegment({iconOnly: true});
  expect(countHost(compact, 'help-segment-shortcut-key')).toBe(0);
});

test('suffix labels stay hidden below the XL breakpoint (test viewport)', () => {
  // useWindowDimensions reports the default (sub-1280px) test viewport, so the
  // `hidden xl:inline` suffix/label spans never render — mirroring the web
  // narrow-screen tier.
  const tree = renderSegment({iconOnly: false});
  expect(countHost(tree, 'help-segment-shortcuts-suffix')).toBe(0);
  expect(countHost(tree, 'help-segment-tour-suffix')).toBe(0);
  expect(countHost(tree, 'help-segment-feedback-suffix')).toBe(0);
});

test('preserves the web event identifiers and tooltip side for host wiring', () => {
  expect(SHORTCUTS_EVENT).toBe('toggle-keyboard-shortcuts');
  expect(TOUR_OPEN_LAUNCHER_EVENT).toBe('teslasync:tour:openLauncher');
  expect(FEEDBACK_MODAL_EVENT).toBe('open-feedback-modal');
  expect(TOOLTIP_SIDE).toBe('top');
});
