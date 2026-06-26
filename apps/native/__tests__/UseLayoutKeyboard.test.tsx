import React from 'react';

import ReactTestRenderer from 'react-test-renderer';

import {
  createDashboardKeydownHandler,
  emitToggleKeyboardShortcuts,
  getRegisteredShortcuts,
  isKeyboardEventTargetAvailable,
  subscribeToggleKeyboardShortcuts,
  useLayoutKeyboard,
  _resetShortcutRegistry,
  type KeyboardOptions,
  type SavedDashboard,
  type ShortcutKeyEvent,
} from '../src/web-parity/features/dashboard/hooks/useLayoutKeyboard';

/**
 * Native parity contract for useLayoutKeyboard.
 *
 * The web module is a non-visual behaviour hook: it registers the dashboard's
 * cheatsheet entries and wires `window` keydown shortcuts (E / Esc / ? /
 * Ctrl+Z|Y / Alt+1..9). React Native exposes no global keydown stream, so the
 * port preserves the full key-handling logic in the exported, DOM-free
 * createDashboardKeydownHandler (driven here by synthetic events), keeps the
 * shortcut-registry register/unregister lifecycle, swaps the web CustomEvent
 * for the native emit/subscribe signal, and surfaces the keydown source as an
 * explicit "unavailable" state. These tests assert that behaviour 1:1.
 */

type Tree = ReactTestRenderer.ReactTestRenderer;

function dash(id: string): SavedDashboard {
  return {
    id,
    name: id,
    widgets: [],
    layouts: {},
    createdAt: '',
    updatedAt: '',
  };
}

function makeOptions(overrides: Partial<KeyboardOptions> = {}): KeyboardOptions {
  return {
    editMode: false,
    setEditMode: jest.fn(),
    canUndo: false,
    canRedo: false,
    onUndo: jest.fn(),
    onRedo: jest.fn(),
    dashboards: [],
    switchDashboard: jest.fn(),
    ...overrides,
  };
}

function keyEvent(overrides: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent {
  return {
    key: '',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target: null,
    preventDefault: jest.fn(),
    ...overrides,
  };
}

function HookHost({options}: {options: KeyboardOptions}): null {
  useLayoutKeyboard(options);
  return null;
}

function render(node: React.ReactElement): Tree {
  let tree!: Tree;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(node);
  });
  return tree;
}

beforeEach(() => {
  _resetShortcutRegistry();
});

describe('createDashboardKeydownHandler', () => {
  test('ignores events whose focus target is a form input or contenteditable', () => {
    const opts = makeOptions({editMode: false});
    const handler = createDashboardKeydownHandler(opts);

    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      const e = keyEvent({key: 'e', target: {tagName}});
      handler(e);
      expect(e.preventDefault).not.toHaveBeenCalled();
    }
    const editable = keyEvent({key: 'e', target: {isContentEditable: true}});
    handler(editable);

    expect(opts.setEditMode).not.toHaveBeenCalled();
    expect(editable.preventDefault).not.toHaveBeenCalled();
  });

  test('Alt+1..9 switches to the dashboard at that 1-based index', () => {
    const opts = makeOptions({dashboards: [dash('a'), dash('b'), dash('c')]});
    const handler = createDashboardKeydownHandler(opts);

    const e = keyEvent({key: '2', altKey: true});
    handler(e);

    expect(opts.switchDashboard).toHaveBeenCalledWith('b');
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
  });

  test('Alt+number out of range, or with extra modifiers, does not switch', () => {
    const opts = makeOptions({dashboards: [dash('a'), dash('b')]});
    const handler = createDashboardKeydownHandler(opts);

    handler(keyEvent({key: '3', altKey: true})); // > dashboards.length
    handler(keyEvent({key: '0', altKey: true})); // < 1
    handler(keyEvent({key: '1', altKey: true, ctrlKey: true})); // extra modifier

    expect(opts.switchDashboard).not.toHaveBeenCalled();
  });

  test('E toggles edit mode; Shift+E is ignored', () => {
    const offToOn = makeOptions({editMode: false});
    const onHandler = createDashboardKeydownHandler(offToOn);
    const eOn = keyEvent({key: 'e'});
    onHandler(eOn);
    expect(offToOn.setEditMode).toHaveBeenCalledWith(true);
    expect(eOn.preventDefault).toHaveBeenCalledTimes(1);

    const onToOff = makeOptions({editMode: true});
    const offHandler = createDashboardKeydownHandler(onToOff);
    offHandler(keyEvent({key: 'E'}));
    expect(onToOff.setEditMode).toHaveBeenCalledWith(false);

    const shifted = makeOptions({editMode: false});
    const shiftHandler = createDashboardKeydownHandler(shifted);
    const shiftEvent = keyEvent({key: 'E', shiftKey: true});
    shiftHandler(shiftEvent);
    expect(shifted.setEditMode).not.toHaveBeenCalled();
    expect(shiftEvent.preventDefault).not.toHaveBeenCalled();
  });

  test('Escape exits edit mode only when already editing', () => {
    const editing = makeOptions({editMode: true});
    const editingHandler = createDashboardKeydownHandler(editing);
    const esc = keyEvent({key: 'Escape'});
    editingHandler(esc);
    expect(editing.setEditMode).toHaveBeenCalledWith(false);
    expect(esc.preventDefault).toHaveBeenCalledTimes(1);

    const viewing = makeOptions({editMode: false});
    const viewingHandler = createDashboardKeydownHandler(viewing);
    const escView = keyEvent({key: 'Escape'});
    viewingHandler(escView);
    expect(viewing.setEditMode).not.toHaveBeenCalled();
    expect(escView.preventDefault).not.toHaveBeenCalled();
  });

  test('? and Shift+/ fire the toggle-keyboard-shortcuts signal', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToggleKeyboardShortcuts(listener);

    const handler = createDashboardKeydownHandler(makeOptions());

    const question = keyEvent({key: '?'});
    handler(question);
    expect(question.preventDefault).toHaveBeenCalledTimes(1);

    const slash = keyEvent({key: '/', shiftKey: true});
    handler(slash);
    expect(slash.preventDefault).toHaveBeenCalledTimes(1);

    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  test('Ctrl/Cmd+Z undoes and Ctrl+Y / Ctrl+Shift+Z redoes, only in edit mode', () => {
    const opts = makeOptions({editMode: true, canUndo: true, canRedo: true});
    const handler = createDashboardKeydownHandler(opts);

    handler(keyEvent({key: 'z', ctrlKey: true}));
    expect(opts.onUndo).toHaveBeenCalledTimes(1);

    handler(keyEvent({key: 'z', metaKey: true})); // Cmd+Z
    expect(opts.onUndo).toHaveBeenCalledTimes(2);

    handler(keyEvent({key: 'y', ctrlKey: true}));
    handler(keyEvent({key: 'z', ctrlKey: true, shiftKey: true}));
    expect(opts.onRedo).toHaveBeenCalledTimes(2);
  });

  test('undo/redo do nothing without edit mode, modifiers, or capability', () => {
    const notEditing = makeOptions({editMode: false, canUndo: true});
    createDashboardKeydownHandler(notEditing)(keyEvent({key: 'z', ctrlKey: true}));
    expect(notEditing.onUndo).not.toHaveBeenCalled();

    const noModifier = makeOptions({editMode: true, canUndo: true});
    createDashboardKeydownHandler(noModifier)(keyEvent({key: 'z'}));
    expect(noModifier.onUndo).not.toHaveBeenCalled();

    const cannotUndo = makeOptions({editMode: true, canUndo: false});
    createDashboardKeydownHandler(cannotUndo)(keyEvent({key: 'z', ctrlKey: true}));
    expect(cannotUndo.onUndo).not.toHaveBeenCalled();
  });
});

describe('useLayoutKeyboard registry lifecycle', () => {
  test('registers the base entry, expands with edit mode and multiple dashboards, and cleans up on unmount', () => {
    const tree = render(
      <HookHost options={makeOptions({editMode: false, dashboards: [dash('a')]})} />,
    );
    expect(getRegisteredShortcuts().map(s => s.id)).toEqual([
      'dashboard.toggleEdit',
    ]);

    ReactTestRenderer.act(() => {
      tree.update(
        <HookHost
          options={makeOptions({
            editMode: true,
            dashboards: [dash('a'), dash('b')],
          })}
        />,
      );
    });
    expect(getRegisteredShortcuts().map(s => s.id).sort()).toEqual([
      'dashboard.exitEdit',
      'dashboard.redo',
      'dashboard.switch',
      'dashboard.toggleEdit',
      'dashboard.undo',
    ]);

    ReactTestRenderer.act(() => {
      tree.unmount();
    });
    expect(getRegisteredShortcuts()).toHaveLength(0);
  });

  test('registered entries preserve keys, group, scope, and route match', () => {
    render(<HookHost options={makeOptions({editMode: true})} />);
    const toggle = getRegisteredShortcuts().find(s => s.id === 'dashboard.toggleEdit');
    const undo = getRegisteredShortcuts().find(s => s.id === 'dashboard.undo');

    expect(toggle).toBeDefined();
    expect(toggle?.keys).toEqual(['E']);
    expect(toggle?.group).toBe('Dashboard');
    expect(toggle?.scope).toBe('route');
    expect(toggle?.routeMatch).toBeInstanceOf(RegExp);
    expect((toggle?.routeMatch as RegExp).test('/')).toBe(true);
    expect(undo?.keys).toEqual(['Ctrl', 'Z']);
  });
});

describe('native keydown-source unavailability', () => {
  test('reports the keydown source as unavailable and mounts without throwing', () => {
    expect(isKeyboardEventTargetAvailable()).toBe(false);
    expect(() =>
      render(<HookHost options={makeOptions()} />),
    ).not.toThrow();
  });
});

describe('toggle-keyboard-shortcuts signal', () => {
  test('notifies subscribers until they unsubscribe', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToggleKeyboardShortcuts(listener);

    emitToggleKeyboardShortcuts();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    emitToggleKeyboardShortcuts();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
