import React from 'react';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

import {
  ConfirmDialog,
  clearAllSilenced,
  isSilenced,
  silence,
} from '../src/web-parity/components/ui/ConfirmDialog';

type Renderer = ReactTestRenderer.ReactTestRenderer;

function render(element: React.ReactElement): Renderer {
  let tree: Renderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(element);
  });
  return tree!;
}

function countHost(tree: Renderer, testID: string): number {
  return tree.root.findAll(
    (node: ReactTestInstance) =>
      typeof node.type === 'string' && node.props.testID === testID,
  ).length;
}

function find(tree: Renderer, testID: string): ReactTestInstance {
  return tree.root.find(
    (node: ReactTestInstance) => node.props.testID === testID,
  );
}

function callProp(
  tree: Renderer,
  testID: string,
  prop: string,
  ...args: unknown[]
): void {
  const target = tree.root.find(
    (node: ReactTestInstance) =>
      node.props.testID === testID && typeof node.props[prop] === 'function',
  );
  ReactTestRenderer.act(() => {
    target.props[prop](...args);
  });
}

function isDisabled(node: ReactTestInstance): boolean {
  return (
    node.props.disabled === true ||
    node.props.accessibilityState?.disabled === true
  );
}

beforeEach(() => {
  clearAllSilenced();
});

test('renders the title, message and action labels when open', () => {
  const tree = render(
    <ConfirmDialog
      cancelLabel="Keep"
      confirmLabel="Delete"
      message="This cannot be undone."
      onCancel={jest.fn()}
      onConfirm={jest.fn()}
      open
      title="Delete vehicle"
    />,
  );

  expect(countHost(tree, 'confirm-dialog')).toBe(1);
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('Delete vehicle');
  expect(json).toContain('This cannot be undone.');
  expect(json).toContain('Delete');
  expect(json).toContain('Keep');
});

test('confirm and cancel fire their callbacks', () => {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  const tree = render(
    <ConfirmDialog
      message="Proceed?"
      onCancel={onCancel}
      onConfirm={onConfirm}
      open
      title="Confirm"
      variant="warning"
    />,
  );

  callProp(tree, 'confirm-dialog-confirm', 'onPress');
  expect(onConfirm).toHaveBeenCalledTimes(1);

  callProp(tree, 'confirm-dialog-cancel', 'onPress');
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test('typed-confirmation gate disables confirm until the string matches', () => {
  const onConfirm = jest.fn();
  const tree = render(
    <ConfirmDialog
      message="Type DELETE to continue."
      onCancel={jest.fn()}
      onConfirm={onConfirm}
      open
      requireTypedConfirmation="DELETE"
      title="Wipe database"
    />,
  );

  // Confirm starts disabled; typing the wrong value keeps it disabled.
  expect(isDisabled(find(tree, 'confirm-dialog-confirm'))).toBe(true);
  callProp(tree, 'confirm-dialog-input', 'onChangeText', 'delete');
  expect(isDisabled(find(tree, 'confirm-dialog-confirm'))).toBe(true);

  // Exact match enables the confirm button and lets it fire.
  callProp(tree, 'confirm-dialog-input', 'onChangeText', 'DELETE');
  expect(isDisabled(find(tree, 'confirm-dialog-confirm'))).toBe(false);
  callProp(tree, 'confirm-dialog-confirm', 'onPress');
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

test('loading disables both buttons and swallows the backdrop dismiss', () => {
  const onCancel = jest.fn();
  const tree = render(
    <ConfirmDialog
      loading
      message="Working…"
      onCancel={onCancel}
      onConfirm={jest.fn()}
      open
      title="Please wait"
    />,
  );

  expect(isDisabled(find(tree, 'confirm-dialog-confirm'))).toBe(true);
  expect(isDisabled(find(tree, 'confirm-dialog-cancel'))).toBe(true);

  // Backdrop press is a no-op while loading.
  const backdrop = tree.root.findAll(
    (node: ReactTestInstance) =>
      typeof node.props.onPress === 'function' &&
      node.props.accessibilityElementsHidden === true,
  )[0];
  ReactTestRenderer.act(() => {
    backdrop.props.onPress();
  });
  expect(onCancel).not.toHaveBeenCalled();
});

test('silenceKey is ignored for the danger variant (no checkbox)', () => {
  const tree = render(
    <ConfirmDialog
      message="Destructive."
      onCancel={jest.fn()}
      onConfirm={jest.fn()}
      open
      silenceKey="remove-widget"
      title="Danger"
      variant="danger"
    />,
  );
  expect(countHost(tree, 'confirm-dialog-silence-toggle')).toBe(0);
});

test('"Don\'t ask again" persists the silence choice on confirm', () => {
  const onConfirm = jest.fn();
  const tree = render(
    <ConfirmDialog
      message="Remove this widget?"
      onCancel={jest.fn()}
      onConfirm={onConfirm}
      open
      silenceKey="remove-widget"
      title="Remove widget"
      variant="warning"
    />,
  );

  expect(countHost(tree, 'confirm-dialog-silence-toggle')).toBe(1);
  expect(isSilenced('remove-widget')).toBe(false);

  callProp(tree, 'confirm-dialog-silence-toggle', 'onPress');
  callProp(tree, 'confirm-dialog-confirm', 'onPress');

  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(isSilenced('remove-widget')).toBe(true);
});

test('a previously silenced action auto-resolves and renders nothing', () => {
  silence('remove-widget');
  const onConfirm = jest.fn();
  const tree = render(
    <ConfirmDialog
      message="Remove this widget?"
      onCancel={jest.fn()}
      onConfirm={onConfirm}
      open
      silenceKey="remove-widget"
      title="Remove widget"
      variant="warning"
    />,
  );

  // Dialog is suppressed entirely and the confirm callback auto-fires.
  expect(countHost(tree, 'confirm-dialog')).toBe(0);
  expect(onConfirm).toHaveBeenCalledTimes(1);
});
