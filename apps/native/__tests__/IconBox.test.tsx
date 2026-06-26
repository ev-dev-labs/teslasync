import React, {useContext} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

import {
  IconBox,
  IconBoxTintContext,
  neonColorMap,
  useIconBoxTint,
} from '../src/web-parity/components/ui/IconBox';

type Renderer = ReactTestRenderer.ReactTestRenderer;

function render(element: React.ReactElement): Renderer {
  let tree: Renderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(element);
  });
  return tree!;
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

test('default IconBox renders a 40px cyan box (md / cyan)', () => {
  const tree = render(
    <IconBox testID="box">
      <Text testID="glyph">x</Text>
    </IconBox>,
  );

  const style = flatStyle(findHost(tree, 'box'));
  expect(style.width).toBe(40);
  expect(style.height).toBe(40);
  expect(style.borderRadius).toBe(12);
  expect(style.borderWidth).toBe(1);
  expect(style.flexShrink).toBe(0);
  expect(style.alignItems).toBe('center');
  expect(style.justifyContent).toBe('center');
  expect(style.backgroundColor).toBe(neonColorMap.cyan.bg);
  expect(style.borderColor).toBe(neonColorMap.cyan.ring);
});

test('resolves explicit color + size against neonColorMap / iconBoxSize', () => {
  const tree = render(
    <IconBox color="green" size="sm" testID="box">
      <Text>x</Text>
    </IconBox>,
  );

  const style = flatStyle(findHost(tree, 'box'));
  expect(style.width).toBe(32);
  expect(style.height).toBe(32);
  expect(style.borderRadius).toBe(8);
  expect(style.backgroundColor).toBe(neonColorMap.green.bg);
  expect(style.borderColor).toBe(neonColorMap.green.ring);
});

test('lg size maps to a 48px box with radius 12', () => {
  const tree = render(
    <IconBox color="amber" size="lg" testID="box">
      <Text>x</Text>
    </IconBox>,
  );

  const style = flatStyle(findHost(tree, 'box'));
  expect(style.width).toBe(48);
  expect(style.height).toBe(48);
  expect(style.borderRadius).toBe(12);
  expect(style.backgroundColor).toBe(neonColorMap.amber.bg);
});

test('the style override escape hatch is applied last', () => {
  const tree = render(
    <IconBox style={{marginTop: 7, backgroundColor: '#123456'}} testID="box">
      <Text>x</Text>
    </IconBox>,
  );

  const style = flatStyle(findHost(tree, 'box'));
  expect(style.marginTop).toBe(7);
  expect(style.backgroundColor).toBe('#123456');
});

test('string children are auto-wrapped in a tinted glyph', () => {
  const tree = render(<IconBox color="red">A</IconBox>);

  const tinted = tree.root.find((node: ReactTestInstance) => {
    if (typeof node.type !== 'string') {
      return false;
    }
    const style = StyleSheet.flatten(node.props.style) as Record<
      string,
      unknown
    >;
    return style?.color === neonColorMap.red.text;
  });
  expect(tinted).toBeDefined();
  expect(JSON.stringify(tinted.props.children)).toContain('A');
});

test('useIconBoxTint exposes the resolved tint to icon children', () => {
  let observed: string | undefined;

  function Probe() {
    observed = useIconBoxTint();
    return null;
  }

  render(
    <IconBox color="purple">
      <Probe />
    </IconBox>,
  );

  expect(observed).toBe(neonColorMap.purple.text);
});

test('IconBoxTintContext defaults to the cyan tint outside any box', () => {
  let observed: string | undefined;

  function Probe() {
    observed = useContext(IconBoxTintContext);
    return null;
  }

  render(
    <View>
      <Probe />
    </View>,
  );

  expect(observed).toBe(neonColorMap.cyan.text);
});
