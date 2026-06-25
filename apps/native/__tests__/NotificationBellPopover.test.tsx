import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {NotificationBellPopover} from '../src/web-parity/components/layout/NotificationBellPopover';

/**
 * Native parity contract for NotificationBellPopover.
 *
 * The web component is a header bell + unread-count badge that opens a
 * latest-10-unread triage panel (portaled, bbox-anchored, focus-trapped) with a
 * "Mark all read" mutation and a "View all" escape hatch. The native port keeps
 * the bell trigger + badge, renders the panel as a <Modal> popover (children
 * mount only while open), and routes navigation through an onNavigate(to)
 * callback. These tests assert the behaviour the web suite would: badge clamp,
 * the trigger toggling the panel, list rows + "View all" navigating to
 * /notifications/inbox, the { all: true } bulk mutation + its empty no-op guard,
 * the navigateOnTrigger mobile-fallback, and the loading/error/empty states.
 *
 * The five data hooks are mocked so the suite is deterministic and network-free.
 */

type Tree = ReactTestRenderer.ReactTestRenderer;

const mockHookState: {
  count: number;
  logs: Array<Record<string, unknown>>;
  isLoading: boolean;
  error: unknown;
  rules: Array<Record<string, unknown>>;
  vehicles: Array<Record<string, unknown>>;
  mutate: jest.Mock;
  isPending: boolean;
} = {
  count: 0,
  logs: [],
  isLoading: false,
  error: null,
  rules: [],
  vehicles: [],
  mutate: jest.fn(),
  isPending: false,
};

jest.mock('../src/web-parity/api/hooks/useNotifications', () => ({
  useUnreadCount: () => ({data: mockHookState.count}),
  useUnreadNotifications: () => ({
    data: mockHookState.logs,
    isLoading: mockHookState.isLoading,
    error: mockHookState.error,
  }),
  useAlertRules: () => ({data: mockHookState.rules}),
  useBulkMarkRead: () => ({
    mutate: mockHookState.mutate,
    isPending: mockHookState.isPending,
  }),
}));

jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: () => ({data: mockHookState.vehicles}),
}));

function render(node: React.ReactElement): Tree {
  let tree!: Tree;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(node);
  });
  return tree;
}

// React Native yields a composite + host instance for a testID; grab the first.
function byTestId(tree: Tree, id: string) {
  return tree.root.findAllByProps({testID: id})[0];
}

function presentCount(tree: Tree, id: string): number {
  return tree.root.findAllByProps({testID: id}).length > 0 ? 1 : 0;
}

function press(tree: Tree, id: string): void {
  ReactTestRenderer.act(() => {
    byTestId(tree, id).props.onPress();
  });
}

beforeEach(() => {
  mockHookState.count = 0;
  mockHookState.logs = [];
  mockHookState.isLoading = false;
  mockHookState.error = null;
  mockHookState.rules = [];
  mockHookState.vehicles = [];
  mockHookState.mutate = jest.fn();
  mockHookState.isPending = false;
});

test('renders the bell trigger with no badge when there are no unread', () => {
  const tree = render(<NotificationBellPopover />);

  expect(presentCount(tree, 'notification-bell-trigger')).toBe(1);
  expect(presentCount(tree, 'notification-bell-badge')).toBe(0);
  expect(byTestId(tree, 'notification-bell-trigger').props.accessibilityState).toEqual({
    expanded: false,
  });

  ReactTestRenderer.act(() => tree.unmount());
});

test('shows the unread badge and clamps counts over 99 to 99+', () => {
  mockHookState.count = 150;
  const tree = render(<NotificationBellPopover />);

  expect(presentCount(tree, 'notification-bell-badge')).toBe(1);
  expect(JSON.stringify(tree.toJSON())).toContain('99+');
  // The aria-label mirrors the web {{count}} unread interpolation.
  expect(byTestId(tree, 'notification-bell-trigger').props.accessibilityLabel).toBe(
    '150 unread notifications',
  );

  ReactTestRenderer.act(() => tree.unmount());
});

test('the trigger toggles the popover panel open', () => {
  mockHookState.count = 2;
  mockHookState.logs = [
    {id: 1, alert_id: null, title: 'Battery low', message: '', created_at: ''},
  ];
  const tree = render(<NotificationBellPopover />);

  // Closed -> Modal renders null, so the panel is absent.
  expect(presentCount(tree, 'notification-bell-panel')).toBe(0);

  press(tree, 'notification-bell-trigger');

  expect(byTestId(tree, 'notification-bell-trigger').props.accessibilityState).toEqual({
    expanded: true,
  });
  expect(presentCount(tree, 'notification-bell-panel')).toBe(1);
  expect(presentCount(tree, 'bell-popover-list')).toBe(1);
  expect(presentCount(tree, 'bell-popover-row-1')).toBe(1);

  ReactTestRenderer.act(() => tree.unmount());
});

test('navigateOnTrigger jumps straight to the inbox without opening the panel', () => {
  mockHookState.count = 5;
  const onNavigate = jest.fn();
  const tree = render(
    <NotificationBellPopover navigateOnTrigger onNavigate={onNavigate} />,
  );

  press(tree, 'notification-bell-trigger');

  expect(onNavigate).toHaveBeenCalledTimes(1);
  expect(onNavigate).toHaveBeenCalledWith('/notifications/inbox');
  expect(presentCount(tree, 'notification-bell-panel')).toBe(0);

  ReactTestRenderer.act(() => tree.unmount());
});

test('row tap and "View all" both navigate to the inbox and close the panel', () => {
  mockHookState.count = 1;
  mockHookState.logs = [
    {id: 7, alert_id: null, title: 'Charge complete', message: 'Done', created_at: ''},
  ];
  const onNavigate = jest.fn();
  const tree = render(<NotificationBellPopover onNavigate={onNavigate} />);

  press(tree, 'notification-bell-trigger');
  press(tree, 'bell-popover-row-7');

  expect(onNavigate).toHaveBeenLastCalledWith('/notifications/inbox');
  // navigateAndClose closes the popover -> Modal unmounts its children.
  expect(presentCount(tree, 'notification-bell-panel')).toBe(0);

  press(tree, 'notification-bell-trigger');
  press(tree, 'notification-bell-view-all');
  expect(onNavigate).toHaveBeenLastCalledWith('/notifications/inbox');

  ReactTestRenderer.act(() => tree.unmount());
});

test('"Mark all read" fires the { all: true } bulk mutation when there are logs', () => {
  mockHookState.count = 3;
  mockHookState.logs = [
    {id: 1, alert_id: 9, title: 'A', message: '', created_at: ''},
    {id: 2, alert_id: null, title: 'B', message: '', created_at: ''},
  ];
  mockHookState.rules = [{id: 9, severity: 'critical', vehicle_id: 4}];
  mockHookState.vehicles = [{id: 4, display_name: 'Model 3'}];
  const tree = render(<NotificationBellPopover />);

  press(tree, 'notification-bell-trigger');

  const markAll = byTestId(tree, 'notification-bell-mark-all-read');
  expect(markAll.props.disabled).toBe(false);

  press(tree, 'notification-bell-mark-all-read');
  expect(mockHookState.mutate).toHaveBeenCalledTimes(1);
  expect(mockHookState.mutate).toHaveBeenCalledWith({all: true});

  // The joined vehicle name renders in the row meta.
  expect(JSON.stringify(tree.toJSON())).toContain('Model 3');

  ReactTestRenderer.act(() => tree.unmount());
});

test('"Mark all read" is disabled and a no-op when the preview is empty', () => {
  mockHookState.count = 0;
  mockHookState.logs = [];
  const tree = render(<NotificationBellPopover />);

  press(tree, 'notification-bell-trigger');

  const markAll = byTestId(tree, 'notification-bell-mark-all-read');
  expect(markAll.props.disabled).toBe(true);

  // Even if the press handler fires, the length===0 guard makes it a no-op.
  press(tree, 'notification-bell-mark-all-read');
  expect(mockHookState.mutate).not.toHaveBeenCalled();

  ReactTestRenderer.act(() => tree.unmount());
});

test('renders the loading, error, and empty states from the hook flags', () => {
  // Loading (no logs yet) -> spinner copy.
  mockHookState.isLoading = true;
  const loadingTree = render(<NotificationBellPopover />);
  press(loadingTree, 'notification-bell-trigger');
  expect(JSON.stringify(loadingTree.toJSON())).toContain('Loading');
  ReactTestRenderer.act(() => loadingTree.unmount());

  // Error -> error copy.
  mockHookState.isLoading = false;
  mockHookState.error = new Error('boom');
  const errorTree = render(<NotificationBellPopover />);
  press(errorTree, 'notification-bell-trigger');
  expect(JSON.stringify(errorTree.toJSON())).toContain('Could not load notifications');
  ReactTestRenderer.act(() => errorTree.unmount());

  // Empty -> "all caught up" copy.
  mockHookState.error = null;
  mockHookState.logs = [];
  const emptyTree = render(<NotificationBellPopover />);
  press(emptyTree, 'notification-bell-trigger');
  expect(JSON.stringify(emptyTree.toJSON())).toContain('No unread notifications right now.');
  ReactTestRenderer.act(() => emptyTree.unmount());
});
