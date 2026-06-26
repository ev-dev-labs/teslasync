import React from 'react';
import {StyleSheet, TextInput} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

import {Input} from '../src/web-parity/components/ui/Input';
import {colors} from '../src/theme/tokens';

/**
 * Native parity contract for Input.
 *
 * The web component is a labelled form <input> with a required-marker <Label>, an
 * optional field-level <HelpIcon> tooltip, leading/trailing adornments, size
 * variants, an inline error <p>, and a hint <p>. The native port renders the
 * field as a <TextInput>, folds the "required" screen-reader text into the
 * control's accessibilityLabel, swaps the hover Tooltip for a press-to-reveal
 * help popover, and keeps the size/error/hint/adornment semantics. These tests
 * assert that behaviour.
 */

type Tree = ReactTestRenderer.ReactTestRenderer;

function render(node: React.ReactElement): Tree {
  let tree!: Tree;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(node);
  });
  return tree;
}

function getInput(tree: Tree) {
  return tree.root.findByType(TextInput);
}

function flattenInputStyle(tree: Tree): Record<string, unknown> {
  return StyleSheet.flatten(getInput(tree).props.style) as Record<
    string,
    unknown
  >;
}

function present(tree: Tree, props: Record<string, unknown>): boolean {
  return tree.root.findAllByProps(props).length > 0;
}

test('renders the label and forwards value/placeholder to the TextInput', () => {
  const tree = render(
    <Input label="Email" value="me@x.com" placeholder="you@example.com" />,
  );

  const input = getInput(tree);
  expect(input.props.value).toBe('me@x.com');
  expect(input.props.placeholder).toBe('you@example.com');
  // Label drives the accessible name; no required suffix here.
  expect(input.props.accessibilityLabel).toBe('Email');
  expect(JSON.stringify(tree.toJSON())).toContain('Email');

  ReactTestRenderer.act(() => tree.unmount());
});

test('required folds the screen-reader text into the label and shows a marker', () => {
  const tree = render(<Input label="Email" required />);

  const input = getInput(tree);
  expect(input.props.accessibilityLabel).toBe('Email, required');
  // Visible required asterisk rendered.
  expect(JSON.stringify(tree.toJSON())).toContain('*');

  ReactTestRenderer.act(() => tree.unmount());
});

test('an error renders the message, paints the error border, and hides the hint', () => {
  const tree = render(
    <Input label="Email" error="Invalid email" hint="We never share it" />,
  );

  const flat = JSON.stringify(tree.toJSON());
  expect(flat).toContain('Invalid email');
  // Hint is suppressed while an error is showing.
  expect(flat).not.toContain('We never share it');
  // Error border + accessibilityHint surfacing the message.
  expect(flattenInputStyle(tree).borderColor).toBe(colors.danger);
  expect(getInput(tree).props.accessibilityHint).toBe('Invalid email');

  ReactTestRenderer.act(() => tree.unmount());
});

test('the hint renders when there is no error', () => {
  const tree = render(<Input label="Email" hint="We never share it" />);

  expect(JSON.stringify(tree.toJSON())).toContain('We never share it');
  expect(getInput(tree).props.accessibilityHint).toBe('We never share it');

  ReactTestRenderer.act(() => tree.unmount());
});

test('a leading icon and trailing suffix pad the input and a string icon is muted', () => {
  const tree = render(<Input label="Search" icon="GO" suffix={<></>} />);

  const flat = flattenInputStyle(tree);
  expect(flat.paddingLeft).toBe(40);
  expect(flat.paddingRight).toBe(40);
  // String icon rendered (wrapped in muted AppText).
  expect(JSON.stringify(tree.toJSON())).toContain('GO');

  ReactTestRenderer.act(() => tree.unmount());
});

test('the help affordance toggles an inline popover on press', () => {
  const tree = render(
    <Input label="Email" help={{content: 'Use your work address'}} />,
  );

  // Help trigger present, popover not yet rendered.
  expect(present(tree, {testID: 'email-help-trigger'})).toBe(true);
  expect(present(tree, {nativeID: 'email-help'})).toBe(false);

  ReactTestRenderer.act(() => {
    tree.root.findByProps({testID: 'email-help-trigger'}).props.onPress();
  });

  // Popover revealed after the press.
  expect(present(tree, {nativeID: 'email-help'})).toBe(true);

  ReactTestRenderer.act(() => tree.unmount());
});

test('disabled maps to a non-editable, dimmed, a11y-disabled field', () => {
  const tree = render(<Input label="Email" disabled />);

  const input = getInput(tree);
  expect(input.props.editable).toBe(false);
  expect(input.props.accessibilityState).toEqual({disabled: true});
  expect(flattenInputStyle(tree).opacity).toBe(0.5);

  ReactTestRenderer.act(() => tree.unmount());
});

test('size="auto" folds to a 44pt min touch height', () => {
  const tree = render(<Input label="Email" size="auto" />);

  expect(flattenInputStyle(tree).minHeight).toBe(44);

  ReactTestRenderer.act(() => tree.unmount());
});

test('focusing paints the accent border and still calls the caller onFocus', () => {
  const onFocus = jest.fn();
  const tree = render(<Input label="Email" onFocus={onFocus} />);

  ReactTestRenderer.act(() => {
    getInput(tree).props.onFocus({nativeEvent: {}});
  });

  expect(onFocus).toHaveBeenCalledTimes(1);
  expect(flattenInputStyle(tree).borderColor).toBe(colors.accent);

  ReactTestRenderer.act(() => tree.unmount());
});

test('extra props like onChangeText are spread through to the native input', () => {
  const onChangeText = jest.fn();
  const tree = render(<Input label="Email" onChangeText={onChangeText} />);

  ReactTestRenderer.act(() => {
    getInput(tree).props.onChangeText('typed');
  });

  expect(onChangeText).toHaveBeenCalledWith('typed');

  ReactTestRenderer.act(() => tree.unmount());
});
