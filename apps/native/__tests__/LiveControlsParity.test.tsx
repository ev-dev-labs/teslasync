import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {LiveControls} from '../src/web-parity/features/system/components/state-machine/LiveControls';

type JsonNode =
  | string
  | number
  | null
  | undefined
  | {children?: JsonNode | JsonNode[]}
  | JsonNode[];

function flattenText(node: JsonNode): string {
  if (node == null) {
    return '';
  }
  if (typeof node === 'string') {
    return node;
  }
  if (typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(flattenText).join('');
  }
  return flattenText(node.children);
}

function serialize(tree: ReactTestRenderer.ReactTestRenderer | undefined): string {
  return flattenText(tree?.toJSON() as JsonNode);
}

function findPressable(
  tree: ReactTestRenderer.ReactTestRenderer | undefined,
  testID: string,
) {
  return tree?.root
    .findAllByProps({testID})
    .find(candidate => typeof candidate.props.onPress === 'function');
}

function a11yState(
  tree: ReactTestRenderer.ReactTestRenderer | undefined,
  testID: string,
): {disabled?: boolean; selected?: boolean} | undefined {
  const node = tree?.root
    .findAllByProps({testID})
    .find(candidate => candidate.props.accessibilityState != null);
  return node?.props.accessibilityState;
}

function pressByTestId(
  tree: ReactTestRenderer.ReactTestRenderer | undefined,
  testID: string,
) {
  const node = findPressable(tree, testID);
  expect(node).toBeDefined();
  node?.props.onPress();
}

const baseProps = {
  isLive: true,
  onToggleLive: jest.fn(),
  onStepPrev: jest.fn(),
  onStepNext: jest.fn(),
  windowMinutes: 10,
  onWindowChange: jest.fn(),
  onClearBuffer: jest.fn(),
};

function render(
  props: Partial<React.ComponentProps<typeof LiveControls>> = {},
): ReactTestRenderer.ReactTestRenderer | undefined {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<LiveControls {...baseProps} {...props} />);
  });
  return tree;
}

test('renders Live/Freeze/Clear, the active window label, and the buffered counter', () => {
  const tree = render({windowMinutes: 10, bufferCount: 7});

  const serialized = serialize(tree);
  expect(serialized).toContain('Live');
  expect(serialized).toContain('Freeze');
  expect(serialized).toContain('Window');
  expect(serialized).toContain('10 min');
  expect(serialized).toContain('Clear buffer');
  expect(serialized).toContain('7 buffered');

  ReactTestRenderer.act(() => tree?.unmount());
});

test('tapping Live fires onToggleLive(true) and Freeze fires onToggleLive(false)', () => {
  const onToggleLive = jest.fn();
  const tree = render({onToggleLive});

  ReactTestRenderer.act(() => pressByTestId(tree, 'live-controls-live'));
  expect(onToggleLive).toHaveBeenLastCalledWith(true);

  ReactTestRenderer.act(() => pressByTestId(tree, 'live-controls-freeze'));
  expect(onToggleLive).toHaveBeenLastCalledWith(false);

  ReactTestRenderer.act(() => tree?.unmount());
});

test('step buttons are disabled by default and enabled via canStepPrev/canStepNext', () => {
  const disabledTree = render();
  expect(a11yState(disabledTree, 'live-controls-step-prev')?.disabled).toBe(true);
  expect(a11yState(disabledTree, 'live-controls-step-next')?.disabled).toBe(true);
  ReactTestRenderer.act(() => disabledTree?.unmount());

  const onStepPrev = jest.fn();
  const onStepNext = jest.fn();
  const enabledTree = render({
    canStepPrev: true,
    canStepNext: true,
    onStepPrev,
    onStepNext,
  });

  expect(a11yState(enabledTree, 'live-controls-step-prev')?.disabled).toBe(false);
  ReactTestRenderer.act(() => pressByTestId(enabledTree, 'live-controls-step-prev'));
  ReactTestRenderer.act(() => pressByTestId(enabledTree, 'live-controls-step-next'));
  expect(onStepPrev).toHaveBeenCalledTimes(1);
  expect(onStepNext).toHaveBeenCalledTimes(1);

  ReactTestRenderer.act(() => enabledTree?.unmount());
});

test('choosing a Window option fires onWindowChange with the numeric minutes', () => {
  const onWindowChange = jest.fn();
  const tree = render({windowMinutes: 10, onWindowChange});

  ReactTestRenderer.act(() => pressByTestId(tree, 'live-controls-window'));
  ReactTestRenderer.act(() => pressByTestId(tree, 'live-controls-window-option-30'));

  expect(onWindowChange).toHaveBeenCalledTimes(1);
  expect(onWindowChange).toHaveBeenCalledWith(30);

  ReactTestRenderer.act(() => tree?.unmount());
});

test('tapping Clear buffer fires onClearBuffer', () => {
  const onClearBuffer = jest.fn();
  const tree = render({onClearBuffer});

  ReactTestRenderer.act(() => pressByTestId(tree, 'live-controls-clear'));
  expect(onClearBuffer).toHaveBeenCalledTimes(1);

  ReactTestRenderer.act(() => tree?.unmount());
});

test('dual counter shows the window/24 h split and the counter reveals the scope tooltip', () => {
  const tree = render({windowMinutes: 5, windowCount: 3, totalCount: 12});

  expect(serialize(tree)).toContain('3 in window · 12 in 24 h');

  ReactTestRenderer.act(() => pressByTestId(tree, 'live-controls-counter'));
  const revealed = serialize(tree);
  expect(revealed).toContain('Counts inside the 5-minute Window dropdown.');
  expect(revealed).toContain('9 more transitions fetched in the last 24 h.');

  ReactTestRenderer.act(() => tree?.unmount());
});
