import React from 'react';
import { TextInput } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

import { FlagEditDrawer } from '../src/web-parity/features/admin/components/feature-flags/FlagEditDrawer';

/**
 * Native parity contract for FlagEditDrawer.
 *
 * The web component is the Feature Flags edit/create drawer: a key <Input>
 * (read-only when editing), a free-form JSON value <Textarea> whose parse state
 * gates Save + surfaces an error, and a required `reason` <Input>; Save fires
 * onSave({key,value,reason}) with trimmed key/reason and the parsed JSON value.
 * The native port renders the drawer as a <Modal> (children mount only while
 * open), keeps every piece of state + the parse/gating logic, and swaps the DOM
 * Button/Textarea for native primitives. These tests assert that behaviour.
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

function inputs(tree: Tree) {
  return tree.root.findAllByType(TextInput);
}

function setText(tree: Tree, index: number, text: string): void {
  ReactTestRenderer.act(() => {
    inputs(tree)[index].props.onChangeText(text);
  });
}

// The rendered RN Pressable type reference differs from the imported symbol, so
// locate a button by its visible text and walk up to the nearest pressable
// ancestor (the instance carrying onPress).
function buttonWithText(tree: Tree, text: string) {
  const matches = tree.root.findAll(
    n => n.props != null && n.props.children === text,
  );
  for (const node of matches) {
    let cur = node.parent;
    while (cur) {
      if (typeof cur.props?.onPress === 'function') {
        return cur;
      }
      cur = cur.parent;
    }
  }
  return undefined;
}

test('create mode shows the "Create flag" title and gates Save on an empty value', () => {
  const tree = render(
    <FlagEditDrawer
      initial={null}
      onClose={jest.fn()}
      onSave={jest.fn()}
      open
      saving={false}
    />,
  );

  expect(json(tree)).toContain('Create flag');
  // Empty value seed -> "Value is required." + Save disabled.
  expect(json(tree)).toContain('Value is required.');
  expect(buttonWithText(tree, 'Save flag')?.props.disabled).toBe(true);

  ReactTestRenderer.act(() => tree.unmount());
});

test('edit mode seeds the key + JSON value, locks the key, and shows the immutable note', () => {
  const tree = render(
    <FlagEditDrawer
      initial={{ key: 'feature.x', value: { a: 1 } }}
      onClose={jest.fn()}
      onSave={jest.fn()}
      open
      saving={false}
    />,
  );

  // The interpolated drawer title renders verbatim (asserted on the node so the
  // inner quotes survive — JSON.stringify would escape them).
  expect(
    tree.root.findAll(n => n.props?.children === 'Edit flag "feature.x"')
      .length,
  ).toBeGreaterThan(0);
  // Key field seeded + read-only (editable=false), value seeded as pretty JSON.
  const [keyField, valueField] = inputs(tree);
  expect(keyField.props.value).toBe('feature.x');
  expect(keyField.props.editable).toBe(false);
  expect(valueField.props.value).toBe(JSON.stringify({ a: 1 }, null, 2));
  expect(json(tree)).toContain('immutable once created');

  ReactTestRenderer.act(() => tree.unmount());
});

test('invalid JSON surfaces the parse error and keeps Save disabled', () => {
  const tree = render(
    <FlagEditDrawer
      initial={null}
      onClose={jest.fn()}
      onSave={jest.fn()}
      open
      saving={false}
    />,
  );

  // Valid key + reason, but the value is not JSON.
  setText(tree, 0, 'feature.flag');
  setText(tree, 1, 'not json');
  setText(tree, 2, 'because');

  expect(json(tree)).toContain('Invalid JSON:');
  expect(buttonWithText(tree, 'Save flag')?.props.disabled).toBe(true);

  ReactTestRenderer.act(() => tree.unmount());
});

test('a complete, valid form enables Save and emits the trimmed onSave payload', () => {
  const onSave = jest.fn();
  const tree = render(
    <FlagEditDrawer
      initial={null}
      onClose={jest.fn()}
      onSave={onSave}
      open
      saving={false}
    />,
  );

  setText(tree, 0, '  feature.flag  ');
  setText(tree, 1, '  {"enabled": true}  ');
  setText(tree, 2, '  because  ');

  const save = buttonWithText(tree, 'Save flag');
  expect(save?.props.disabled).toBe(false);

  ReactTestRenderer.act(() => {
    save?.props.onPress();
  });

  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenCalledWith({
    key: 'feature.flag',
    value: { enabled: true },
    reason: 'because',
  });

  ReactTestRenderer.act(() => tree.unmount());
});

test('Cancel calls onClose', () => {
  const onClose = jest.fn();
  const tree = render(
    <FlagEditDrawer
      initial={null}
      onClose={onClose}
      onSave={jest.fn()}
      open
      saving={false}
    />,
  );

  ReactTestRenderer.act(() => {
    buttonWithText(tree, 'Cancel')?.props.onPress();
  });

  expect(onClose).toHaveBeenCalledTimes(1);

  ReactTestRenderer.act(() => tree.unmount());
});

test('saving sets the busy state and disables both actions', () => {
  const onSave = jest.fn();
  const tree = render(
    <FlagEditDrawer
      initial={{ key: 'feature.x', value: { a: 1 } }}
      onClose={jest.fn()}
      onSave={onSave}
      open
      saving
    />,
  );

  // Loading busy-state + both buttons disabled, and Save is a no-op.
  const save = buttonWithText(tree, 'Save flag');
  const cancel = buttonWithText(tree, 'Cancel');
  expect(save?.props.accessibilityState?.busy).toBe(true);
  expect(save?.props.disabled).toBe(true);
  expect(cancel?.props.disabled).toBe(true);

  ReactTestRenderer.act(() => {
    save?.props.onPress?.();
  });
  expect(onSave).not.toHaveBeenCalled();

  ReactTestRenderer.act(() => tree.unmount());
});
