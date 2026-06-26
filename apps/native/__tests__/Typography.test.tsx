import React from 'react';
import {StyleSheet, Text as RNText} from 'react-native';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

import {
  Caption,
  Code,
  ErrorText,
  Heading,
  HelperText,
  Label,
  MetricLabel,
  MetricValue,
  PageTitle,
  PanelTitle,
  SectionTitle,
  Subhead,
  Text,
  typography,
} from '../src/web-parity/components/ui/Typography';

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

test('Heading defaults to the section role', () => {
  const tree = render(<Heading testID="h">Section</Heading>);

  const node = findHost(tree, 'h');
  const style = flatStyle(node);
  expect(style.fontSize).toBe(18);
  expect(style.lineHeight).toBe(28);
  expect(style.fontWeight).toBe('600');
  expect(style.letterSpacing).toBe(-0.45);
  expect(style.color).toBe('#ffffff');
  // The h1-h4 semantics collapse to an accessibility header role.
  expect(node.props.accessibilityRole).toBe('header');
  expect(String(node.props.children)).toBe('Section');
});

test('Heading level=page applies the pageTitle role', () => {
  const tree = render(
    <Heading level="page" testID="h">
      Page
    </Heading>,
  );

  const style = flatStyle(findHost(tree, 'h'));
  expect(style.fontSize).toBe(20);
  expect(style.fontWeight).toBe('700');
  expect(style.letterSpacing).toBe(-0.5);
  expect(style.color).toBe('#ffffff');
});

test('Heading panel/sub levels map to their roles', () => {
  const panel = render(
    <Heading level="panel" testID="h">
      Panel
    </Heading>,
  );
  expect(flatStyle(findHost(panel, 'h'))).toMatchObject({
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  });

  const sub = render(
    <Heading level="sub" testID="h">
      Sub
    </Heading>,
  );
  expect(flatStyle(findHost(sub, 'h'))).toMatchObject({
    fontSize: 14,
    fontWeight: '500',
    color: '#9ca3af',
  });
});

test('Heading `as` overrides the rendered component', () => {
  function Custom(props: {testID?: string; children?: React.ReactNode}) {
    return <RNText {...props} />;
  }

  const tree = render(
    <Heading as={Custom} testID="custom">
      X
    </Heading>,
  );

  // The custom component received the composed role style + header role.
  const node = findHost(tree, 'custom');
  expect(flatStyle(node).fontSize).toBe(18);
  expect(node.props.accessibilityRole).toBe('header');
});

test('Text applies a pre-composed variant role', () => {
  const tree = render(
    <Text testID="t" variant="bodySm">
      Body
    </Text>,
  );

  expect(flatStyle(findHost(tree, 't'))).toMatchObject({
    fontSize: 12,
    lineHeight: 16,
    color: '#9ca3af',
  });
});

test('Text composes granular size / weight / color tokens when variant is unset', () => {
  const tree = render(
    <Text color="muted" size="lg" testID="t" weight="bold">
      Compose
    </Text>,
  );

  const style = flatStyle(findHost(tree, 't'));
  expect(style.fontSize).toBe(18);
  expect(style.lineHeight).toBe(28);
  expect(style.fontWeight).toBe('700');
  expect(style.color).toBe('#8a95a6');
});

test('Text mono switches to the monospace family', () => {
  const tree = render(
    <Text mono size="sm" testID="t">
      mono
    </Text>,
  );

  const style = flatStyle(findHost(tree, 't'));
  expect(style.fontFamily).toBe(typography.family.mono.fontFamily);
  expect(style.fontSize).toBe(14);
});

test('Text variant wins over granular tokens', () => {
  const tree = render(
    <Text size="3xl" testID="t" variant="caption">
      caption
    </Text>,
  );

  // variant=caption (12px) ignores the size=3xl (30px) granular token.
  expect(flatStyle(findHost(tree, 't')).fontSize).toBe(12);
});

test('style override is merged last', () => {
  const tree = render(
    <Text style={{color: '#abcdef', marginTop: 5}} testID="t" variant="body">
      Styled
    </Text>,
  );

  const style = flatStyle(findHost(tree, 't'));
  expect(style.marginTop).toBe(5);
  expect(style.color).toBe('#abcdef');
});

test('convenience headings render their roles', () => {
  const page = render(<PageTitle testID="x">P</PageTitle>);
  expect(flatStyle(findHost(page, 'x')).fontSize).toBe(20);

  const section = render(<SectionTitle testID="x">S</SectionTitle>);
  expect(flatStyle(findHost(section, 'x')).fontSize).toBe(18);

  const panel = render(<PanelTitle testID="x">Pa</PanelTitle>);
  expect(flatStyle(findHost(panel, 'x')).fontSize).toBe(16);

  const sub = render(<Subhead testID="x">Su</Subhead>);
  expect(flatStyle(findHost(sub, 'x')).fontSize).toBe(14);
});

test('Caption / HelperText render the muted text roles', () => {
  const caption = render(<Caption testID="x">c</Caption>);
  expect(flatStyle(findHost(caption, 'x'))).toMatchObject({
    fontSize: 12,
    color: '#8a95a6',
  });

  const helper = render(<HelperText testID="x">h</HelperText>);
  expect(flatStyle(findHost(helper, 'x'))).toMatchObject({
    fontSize: 12,
    color: '#8a95a6',
  });
});

test('ErrorText uses the rose role and an alert accessibility role', () => {
  const tree = render(<ErrorText testID="x">err</ErrorText>);

  const node = findHost(tree, 'x');
  expect(flatStyle(node).color).toBe('#fda4af');
  expect(node.props.accessibilityRole).toBe('alert');
});

test('Label is uppercase with wide tracking', () => {
  const tree = render(<Label testID="x">label</Label>);

  const style = flatStyle(findHost(tree, 'x'));
  expect(style.textTransform).toBe('uppercase');
  expect(style.letterSpacing).toBe(0.6);
  expect(style.fontSize).toBe(12);
  expect(style.color).toBe('#8a95a6');
});

test('MetricValue uses tabular numerals and tight tracking', () => {
  const tree = render(<MetricValue testID="x">42</MetricValue>);

  const style = flatStyle(findHost(tree, 'x'));
  expect(style.fontSize).toBe(24);
  expect(style.fontWeight).toBe('700');
  expect(style.letterSpacing).toBe(-0.6);
  expect(style.fontVariant).toEqual(['tabular-nums']);
});

test('MetricLabel is the 10px uppercase micro label', () => {
  const tree = render(<MetricLabel testID="x">kWh</MetricLabel>);

  const style = flatStyle(findHost(tree, 'x'));
  expect(style.fontSize).toBe(10);
  expect(style.textTransform).toBe('uppercase');
  expect(style.color).toBe('#8a95a6');
});

test('Code renders with the monospace family', () => {
  const tree = render(<Code testID="x">x = 1</Code>);

  const style = flatStyle(findHost(tree, 'x'));
  expect(style.fontFamily).toBe(typography.family.mono.fontFamily);
  expect(style.fontSize).toBe(12);
  expect(style.color).toBe('#ffffff');
});

test('typography token map exposes the resolved role/size/weight/color scales', () => {
  expect(typography.role.pageTitle.color).toBe('#ffffff');
  expect(typography.role.error.color).toBe('#fda4af');
  expect(typography.size['2xs']).toEqual({fontSize: 10, lineHeight: 14});
  expect(typography.size['3xl']).toEqual({fontSize: 30, lineHeight: 36});
  expect(typography.weight.semibold.fontWeight).toBe('600');
  expect(typography.color.disabled.color).toBe('rgba(255, 255, 255, 0.4)');
  expect(typography.family.sans).toEqual({});
});
