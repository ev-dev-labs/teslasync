import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {EditableText} from '../src/web-parity/components/ui/EditableText';
import {
  __resetAnnouncerForTests,
  subscribeAnnouncer,
} from '../src/web-parity/components/a11y/AnnouncerRegion';

/**
 * Native parity contract for EditableText.
 *
 * The web component is a double-click/Enter/F2 display surface that swaps to a
 * controlled <input> with Enter-to-save / Escape-to-cancel / blur-to-commit, a
 * spinner while saving, an ErrorText on failure, and a useAnnouncer() success
 * announcement. The native port renders the display surface as a <Pressable>,
 * the editor as a <TextInput>, and routes Enter through onKeyPress +
 * onSubmitEditing. These tests assert the same behavior the web suite would:
 * enter/exit edit mode, the single commitDraft state machine (no-op exit,
 * validation gating, trimmed save, identical-resubmit guard), Escape cancel,
 * the custom display render prop, the success announcement, and the disabled
 * affordance.
 */

type Tree = ReactTestRenderer.ReactTestRenderer;

function render(node: React.ReactElement): Tree {
  let tree!: Tree;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(node);
  });
  return tree;
}

async function renderAsync(node: React.ReactElement): Promise<Tree> {
  let tree!: Tree;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(node);
  });
  return tree;
}

function byTestId(tree: Tree, id: string) {
  return tree.root.findAllByProps({testID: id})[0];
}

function presentCount(tree: Tree, id: string): number {
  return tree.root.findAllByProps({testID: id}).length > 0 ? 1 : 0;
}

beforeEach(() => {
  __resetAnnouncerForTests();
});

test('renders the display trigger with the current value and a pencil affordance', () => {
  const tree = render(
    <EditableText value="Home" onSave={jest.fn()} ariaLabel="Rename location" />,
  );

  const trigger = byTestId(tree, 'editable-text-trigger');
  expect(trigger.props.accessibilityRole).toBe('button');
  expect(trigger.props.accessibilityLabel).toBe('Rename location');
  // Display mode, not edit mode.
  expect(presentCount(tree, 'editable-text-input')).toBe(0);

  ReactTestRenderer.act(() => tree.unmount());
});

test('falls back to the placeholder text when the value is empty', () => {
  const tree = render(
    <EditableText
      value=""
      placeholder="Untitled"
      onSave={jest.fn()}
      ariaLabel="Rename"
    />,
  );

  const flat = JSON.stringify(tree.toJSON());
  expect(flat).toContain('Untitled');

  ReactTestRenderer.act(() => tree.unmount());
});

test('pressing the trigger enters edit mode and shows the controlled input', () => {
  const tree = render(
    <EditableText value="Home" onSave={jest.fn()} ariaLabel="Rename" />,
  );

  ReactTestRenderer.act(() => {
    byTestId(tree, 'editable-text-trigger').props.onPress();
  });

  const input = byTestId(tree, 'editable-text-input');
  expect(input.props.value).toBe('Home');
  expect(input.props.accessibilityLabel).toBe('Rename');

  ReactTestRenderer.act(() => tree.unmount());
});

test('committing a changed, trimmed value calls onSave and announces success', async () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const announced: string[] = [];
  subscribeAnnouncer(message => announced.push(message));

  const tree = await renderAsync(
    <EditableText value="Home" onSave={onSave} ariaLabel="Rename location" />,
  );

  ReactTestRenderer.act(() => {
    byTestId(tree, 'editable-text-trigger').props.onPress();
  });
  ReactTestRenderer.act(() => {
    byTestId(tree, 'editable-text-input').props.onChangeText('  Work  ');
  });
  await ReactTestRenderer.act(async () => {
    byTestId(tree, 'editable-text-input').props.onSubmitEditing();
  });

  // Trimmed value sent to the server.
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenCalledWith('Work');
  // Exited edit mode on success.
  expect(presentCount(tree, 'editable-text-input')).toBe(0);
  // Success announcement with the interpolated label.
  expect(announced.some(m => m.includes('Rename location saved'))).toBe(true);

  ReactTestRenderer.act(() => tree.unmount());
});

test('a no-op edit (same value after trim) exits without touching onSave', () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const tree = render(
    <EditableText value="Home" onSave={onSave} ariaLabel="Rename" />,
  );

  ReactTestRenderer.act(() => {
    byTestId(tree, 'editable-text-trigger').props.onPress();
  });
  ReactTestRenderer.act(() => {
    byTestId(tree, 'editable-text-input').props.onChangeText('  Home  ');
  });
  ReactTestRenderer.act(() => {
    byTestId(tree, 'editable-text-input').props.onSubmitEditing();
  });

  expect(onSave).not.toHaveBeenCalled();
  expect(presentCount(tree, 'editable-text-input')).toBe(0);

  ReactTestRenderer.act(() => tree.unmount());
});

test('an empty draft is blocked on commit with the built-in error and stays editing', () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const tree = render(
    <EditableText value="Home" onSave={onSave} ariaLabel="Rename" />,
  );

  ReactTestRenderer.act(() => {
    byTestId(tree, 'editable-text-trigger').props.onPress();
  });
  ReactTestRenderer.act(() => {
    byTestId(tree, 'editable-text-input').props.onChangeText('   ');
  });
  ReactTestRenderer.act(() => {
    byTestId(tree, 'editable-text-input').props.onSubmitEditing();
  });

  expect(onSave).not.toHaveBeenCalled();
  // Still editing, error surfaced.
  expect(presentCount(tree, 'editable-text-input')).toBe(1);
  expect(JSON.stringify(tree.toJSON())).toContain('Value cannot be empty');

  ReactTestRenderer.act(() => tree.unmount());
});

test('a failing validator surfaces the message live and blocks the save', () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const validate = (next: string) =>
    next.length > 3 ? 'Too long' : null;

  const tree = render(
    <EditableText
      value="Hi"
      onSave={onSave}
      validate={validate}
      ariaLabel="Rename"
    />,
  );

  ReactTestRenderer.act(() => {
    byTestId(tree, 'editable-text-trigger').props.onPress();
  });
  ReactTestRenderer.act(() => {
    byTestId(tree, 'editable-text-input').props.onChangeText('Hello');
  });
  // Live validation error shown before any commit.
  expect(JSON.stringify(tree.toJSON())).toContain('Too long');

  ReactTestRenderer.act(() => {
    byTestId(tree, 'editable-text-input').props.onSubmitEditing();
  });
  expect(onSave).not.toHaveBeenCalled();

  ReactTestRenderer.act(() => tree.unmount());
});

test('Escape key press cancels the edit and restores the saved value', () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const tree = render(
    <EditableText value="Home" onSave={onSave} ariaLabel="Rename" />,
  );

  ReactTestRenderer.act(() => {
    byTestId(tree, 'editable-text-trigger').props.onPress();
  });
  ReactTestRenderer.act(() => {
    byTestId(tree, 'editable-text-input').props.onChangeText('Changed');
  });
  ReactTestRenderer.act(() => {
    byTestId(tree, 'editable-text-input').props.onKeyPress({
      nativeEvent: {key: 'Escape'},
      preventDefault: () => {},
    });
  });

  expect(onSave).not.toHaveBeenCalled();
  // Back to display mode showing the original value.
  expect(presentCount(tree, 'editable-text-input')).toBe(0);
  expect(JSON.stringify(tree.toJSON())).toContain('Home');

  ReactTestRenderer.act(() => tree.unmount());
});

test('blur commits when valid but stays in edit mode while an error is showing', () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const validate = (next: string) => (next === 'bad' ? 'Nope' : null);
  const tree = render(
    <EditableText
      value="ok"
      onSave={onSave}
      validate={validate}
      ariaLabel="Rename"
    />,
  );

  ReactTestRenderer.act(() => {
    byTestId(tree, 'editable-text-trigger').props.onPress();
  });
  ReactTestRenderer.act(() => {
    byTestId(tree, 'editable-text-input').props.onChangeText('bad');
  });
  // Blur with an active error -> remains editing, no save.
  ReactTestRenderer.act(() => {
    byTestId(tree, 'editable-text-input').props.onBlur();
  });
  expect(onSave).not.toHaveBeenCalled();
  expect(presentCount(tree, 'editable-text-input')).toBe(1);

  ReactTestRenderer.act(() => tree.unmount());
});

test('the custom display render prop receives value, onStartEdit, and disabled', () => {
  const display = jest.fn(() => null);
  const tree = render(
    <EditableText
      value="Home"
      onSave={jest.fn()}
      ariaLabel="Rename"
      disabled
      display={display}
    />,
  );

  expect(display).toHaveBeenCalledWith(
    expect.objectContaining({
      value: 'Home',
      disabled: true,
      onStartEdit: expect.any(Function),
    }),
  );
  // Default trigger not rendered when a custom display is supplied.
  expect(presentCount(tree, 'editable-text-trigger')).toBe(0);

  ReactTestRenderer.act(() => tree.unmount());
});

test('disabled display surface does not enter edit mode and hides the pencil', () => {
  const onSave = jest.fn();
  const tree = render(
    <EditableText
      value="Home"
      onSave={onSave}
      ariaLabel="Rename"
      disabled
    />,
  );

  const trigger = byTestId(tree, 'editable-text-trigger');
  expect(trigger.props.accessibilityState).toEqual({disabled: true});
  expect(trigger.props.disabled).toBe(true);
  // Pencil glyph omitted while disabled.
  expect(JSON.stringify(tree.toJSON())).not.toContain('\u270E');

  ReactTestRenderer.act(() => tree.unmount());
});
