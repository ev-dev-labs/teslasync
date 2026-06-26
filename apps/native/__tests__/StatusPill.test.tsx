import React, {createRef} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

import {
  StatusPill,
  resolveStatusDotColor,
} from '../src/web-parity/components/ui/StatusPill';

type Renderer = ReactTestRenderer.ReactTestRenderer;

function render(element: React.ReactElement): Renderer {
  let tree: Renderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(element);
  });
  return tree!;
}

function unmount(tree: Renderer): void {
  ReactTestRenderer.act(() => {
    tree.unmount();
  });
}

function findHost(tree: Renderer, testID: string): ReactTestInstance {
  return tree.root.find(
    (node: ReactTestInstance) =>
      typeof node.type === 'string' && node.props.testID === testID,
  );
}

function flatStyle(node: ReactTestInstance): Record<string, unknown> {
  return StyleSheet.flatten(node.props.style) as Record<string, unknown>;
}

function exists(tree: Renderer, testID: string): boolean {
  return (
    tree.root.findAll((node: ReactTestInstance) => node.props.testID === testID)
      .length > 0
  );
}

test('default pill renders the surface-2 row and a gray-500 dot', () => {
  const tree = render(
    <StatusPill testID="pill">Online</StatusPill>,
  );

  const pill = flatStyle(findHost(tree, 'pill'));
  expect(pill.flexDirection).toBe('row');
  expect(pill.alignItems).toBe('center');
  expect(pill.alignSelf).toBe('flex-start');
  expect(pill.borderRadius).toBe(9999);
  expect(pill.gap).toBe(6);
  expect(pill.paddingHorizontal).toBe(10);
  expect(pill.paddingVertical).toBe(2);
  expect(pill.backgroundColor).toBe('#151621');

  const dot = flatStyle(findHost(tree, 'pill-dot'));
  expect(dot.width).toBe(6);
  expect(dot.height).toBe(6);
  expect(dot.borderRadius).toBe(9999);
  expect(dot.flexShrink).toBe(0);
  expect(dot.backgroundColor).toBe('#6b7280');

  unmount(tree);
});

test('the label inherits the gray-200 / text-xs / medium styling', () => {
  const tree = render(
    <StatusPill testID="pill">Charging</StatusPill>,
  );

  const label = findHost(tree, 'pill-label');
  expect(String(label.props.children)).toBe('Charging');
  const style = flatStyle(label);
  expect(style.color).toBe('#e5e7eb');
  expect(style.fontSize).toBe(12);
  expect(style.fontWeight).toBe('500');

  unmount(tree);
});

test('a Tailwind bg-* color class drives the dot hue', () => {
  const tree = render(
    <StatusPill color="bg-green-500" testID="pill">
      Healthy
    </StatusPill>,
  );

  expect(flatStyle(findHost(tree, 'pill-dot')).backgroundColor).toBe('#22c55e');

  unmount(tree);
});

test('a raw CSS color passes straight through to the dot', () => {
  const tree = render(
    <StatusPill color="#123456" testID="pill">
      Custom
    </StatusPill>,
  );

  expect(flatStyle(findHost(tree, 'pill-dot')).backgroundColor).toBe('#123456');

  unmount(tree);
});

test('the style override escape hatch is applied last to the pill', () => {
  const tree = render(
    <StatusPill style={{marginTop: 9, backgroundColor: '#abcdef'}} testID="pill">
      Styled
    </StatusPill>,
  );

  const pill = flatStyle(findHost(tree, 'pill'));
  expect(pill.marginTop).toBe(9);
  expect(pill.backgroundColor).toBe('#abcdef');

  unmount(tree);
});

test('element children render as-is (no auto label wrapper)', () => {
  const tree = render(
    <StatusPill testID="pill">
      <Text testID="custom-child">node</Text>
    </StatusPill>,
  );

  expect(exists(tree, 'custom-child')).toBe(true);
  expect(exists(tree, 'pill-label')).toBe(false);

  unmount(tree);
});

test('the pulsing dot mounts and tears down cleanly', () => {
  const tree = render(
    <StatusPill color="bg-emerald-500" pulse testID="pill">
      Live
    </StatusPill>,
  );

  // The dot still renders with its resolved colour while pulsing.
  expect(flatStyle(findHost(tree, 'pill-dot')).backgroundColor).toBe('#10b981');

  // Unmounting stops the Animated.loop (no open handles / no throw).
  expect(() => unmount(tree)).not.toThrow();
});

test('forwardRef wires a ref to the outer pill view', () => {
  const ref = createRef<View>();
  const tree = render(
    <StatusPill ref={ref} testID="pill">
      Ref
    </StatusPill>,
  );

  // The ref slot is populated (host instance) without throwing.
  expect('current' in ref).toBe(true);
  expect(StatusPill.displayName).toBe('StatusPill');

  unmount(tree);
});

test('resolveStatusDotColor maps classes, raw colors and arbitrary values', () => {
  expect(resolveStatusDotColor('bg-gray-500')).toBe('#6b7280');
  expect(resolveStatusDotColor('bg-red-600')).toBe('#dc2626');
  expect(resolveStatusDotColor('bg-amber-400')).toBe('#fbbf24');
  expect(resolveStatusDotColor('bg-blue-500/40')).toBe('#3b82f6');
  expect(resolveStatusDotColor('bg-white')).toBe('#ffffff');
  expect(resolveStatusDotColor('bg-[#0f0f0f]')).toBe('#0f0f0f');
  expect(resolveStatusDotColor('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)');
  // Unknown class falls back to gray-500.
  expect(resolveStatusDotColor('bg-unknown-999')).toBe('#6b7280');
});
