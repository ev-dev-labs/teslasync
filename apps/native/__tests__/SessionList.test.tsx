import React from 'react';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

import {SessionList} from '../src/web-parity/features/system/components/chatbot/SessionList';
import type {ChatSessionInfo} from '../src/web-parity/api/types';

type Renderer = ReactTestRenderer.ReactTestRenderer;

const SESSION_A: ChatSessionInfo = {
  id: 's1',
  title: 'Trip planning',
  first_message: 'Help me plan a road trip',
  message_count: 3,
  last_message_at: '2026-06-26T08:00:00Z',
  created_at: '2026-06-20T00:00:00Z',
};

const SESSION_B: ChatSessionInfo = {
  id: 's2',
  title: null,
  first_message:
    'What is my battery health and how can I improve it over the next several months of ownership',
  message_count: 1,
  last_message_at: null,
  created_at: null,
};

const SESSION_C: ChatSessionInfo = {
  id: 's3',
  title: null,
  first_message: null,
  message_count: 0,
  last_message_at: null,
  created_at: null,
};

let currentTree: Renderer | null = null;

function countTestID(tree: Renderer, testID: string): number {
  return tree.root.findAll(
    (node: ReactTestInstance) =>
      typeof node.type === 'string' && node.props.testID === testID,
  ).length;
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

function hasText(tree: Renderer, text: string): boolean {
  return JSON.stringify(tree.toJSON()).includes(text);
}

interface Handlers {
  onSelect: jest.Mock;
  onNewChat: jest.Mock;
  onRename: jest.Mock;
  onDelete: jest.Mock;
}

function makeHandlers(): Handlers {
  return {
    onSelect: jest.fn(),
    onNewChat: jest.fn(),
    onRename: jest.fn(),
    onDelete: jest.fn(),
  };
}

function render(
  props: Partial<React.ComponentProps<typeof SessionList>> & Handlers,
): Renderer {
  let tree!: Renderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SessionList
        activeSessionId={props.activeSessionId ?? ''}
        isLoading={props.isLoading}
        onDelete={props.onDelete}
        onNewChat={props.onNewChat}
        onRename={props.onRename}
        onSelect={props.onSelect}
        sessions={props.sessions ?? []}
      />,
    );
  });
  currentTree = tree;
  return tree;
}

afterEach(() => {
  if (currentTree) {
    ReactTestRenderer.act(() => {
      currentTree?.unmount();
    });
    currentTree = null;
  }
});

describe('SessionList (native parity)', () => {
  it('renders the panel + new-chat button and fires onNewChat', () => {
    const handlers = makeHandlers();
    const tree = render({...handlers, sessions: []});

    expect(countTestID(tree, 'session-list-root')).toBe(1);
    expect(countTestID(tree, 'session-list-new-chat')).toBe(1);
    expect(hasText(tree, 'New Chat')).toBe(true);
    expect(hasText(tree, 'Sessions')).toBe(true);

    callProp(tree, 'session-list-new-chat', 'onPress');
    expect(handlers.onNewChat).toHaveBeenCalledTimes(1);
  });

  it('shows the loading line only while loading with no sessions', () => {
    const handlers = makeHandlers();
    const tree = render({...handlers, sessions: [], isLoading: true});

    expect(countTestID(tree, 'session-list-loading')).toBe(1);
    expect(hasText(tree, 'Loading…')).toBe(true);
    expect(countTestID(tree, 'session-list-empty')).toBe(0);
  });

  it('shows the empty state when there are no sessions', () => {
    const handlers = makeHandlers();
    const tree = render({...handlers, sessions: [], isLoading: false});

    expect(countTestID(tree, 'session-list-empty')).toBe(1);
    expect(hasText(tree, 'No conversations yet')).toBe(true);
  });

  it('resolves the display title (override / first message / untitled) and meta', () => {
    const handlers = makeHandlers();
    const tree = render({
      ...handlers,
      sessions: [SESSION_A, SESSION_B, SESSION_C],
      activeSessionId: 's1',
    });

    // explicit title override
    expect(hasText(tree, 'Trip planning')).toBe(true);
    // first message truncated to 60 chars + ellipsis
    const truncated = `${SESSION_B.first_message!.slice(0, 60)}…`;
    expect(hasText(tree, truncated)).toBe(true);
    // no title + no first message → untitled fallback
    expect(hasText(tree, 'Untitled conversation')).toBe(true);
    // message count interpolation + empty last_message_at label
    expect(hasText(tree, '3 msgs')).toBe(true);
    expect(hasText(tree, 'Empty')).toBe(true);
  });

  it('fires onSelect when a row is pressed', () => {
    const handlers = makeHandlers();
    const tree = render({
      ...handlers,
      sessions: [SESSION_A, SESSION_B],
      activeSessionId: 's1',
    });

    callProp(tree, 'session-list-select-s2', 'onPress');
    expect(handlers.onSelect).toHaveBeenCalledWith('s2');
  });

  it('long-press opens the inline rename editor and saves the trimmed title', () => {
    const handlers = makeHandlers();
    const tree = render({
      ...handlers,
      sessions: [SESSION_A],
      activeSessionId: 's1',
    });

    expect(countTestID(tree, 'session-list-rename-input')).toBe(0);

    callProp(tree, 'session-list-select-s1', 'onLongPress');
    expect(countTestID(tree, 'session-list-rename-input')).toBe(1);

    callProp(tree, 'session-list-rename-input', 'onChangeText', '  Weekend trip  ');
    callProp(tree, 'session-list-rename-input', 'onSubmitEditing');

    expect(handlers.onRename).toHaveBeenCalledWith('s1', 'Weekend trip');
    // editor closes after commit
    expect(countTestID(tree, 'session-list-rename-input')).toBe(0);
  });

  it('does not call onRename when the draft is blank', () => {
    const handlers = makeHandlers();
    const tree = render({
      ...handlers,
      sessions: [SESSION_A],
      activeSessionId: 's1',
    });

    callProp(tree, 'session-list-select-s1', 'onLongPress');
    callProp(tree, 'session-list-rename-input', 'onChangeText', '   ');
    callProp(tree, 'session-list-rename-input', 'onSubmitEditing');

    expect(handlers.onRename).not.toHaveBeenCalled();
    expect(countTestID(tree, 'session-list-rename-input')).toBe(0);
  });

  it('cancels the rename on Escape without saving', () => {
    const handlers = makeHandlers();
    const tree = render({
      ...handlers,
      sessions: [SESSION_A],
      activeSessionId: 's1',
    });

    callProp(tree, 'session-list-select-s1', 'onLongPress');
    callProp(tree, 'session-list-rename-input', 'onChangeText', 'Discard me');
    callProp(tree, 'session-list-rename-input', 'onKeyPress', {
      nativeEvent: {key: 'Escape'},
    });

    expect(handlers.onRename).not.toHaveBeenCalled();
    expect(countTestID(tree, 'session-list-rename-input')).toBe(0);
  });

  it('confirms a delete through the dialog and fires onDelete', () => {
    const handlers = makeHandlers();
    const tree = render({
      ...handlers,
      sessions: [SESSION_A],
      activeSessionId: 's1',
    });

    callProp(tree, 'session-list-delete-s1', 'onPress');
    expect(hasText(tree, 'Delete conversation?')).toBe(true);

    callProp(tree, 'confirm-dialog-confirm', 'onPress');
    expect(handlers.onDelete).toHaveBeenCalledWith('s1');
  });
});
