import React from 'react';
import {Text} from 'react-native';
import {Alert} from 'react-native';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';

// triggerQuickBackup is mocked so the mutation runs without a network/fetch or
// open handles, mirroring the web BackupActionsCard.test.tsx contract.
let mockTrigger: jest.Mock;

jest.mock('../src/web-parity/api/devtools', () => ({
  triggerQuickBackup: (...args: unknown[]) => mockTrigger(...args),
}));

import {BackupActionsCard} from '../src/web-parity/features/system/components/status/BackupActionsCard';

type Renderer = ReactTestRenderer.ReactTestRenderer;

let currentTree: Renderer | null = null;
let currentClient: QueryClient | null = null;
let alertSpy: jest.SpyInstance;

function makeClient(): QueryClient {
  // gcTime: Infinity short-circuits the query-core GC timer (isValidTimeout
  // rejects Infinity), so no setTimeout is left open under --detectOpenHandles.
  return new QueryClient({
    defaultOptions: {
      mutations: {retry: false, gcTime: Infinity},
      queries: {retry: false, gcTime: Infinity},
    },
  });
}

function render(
  props: React.ComponentProps<typeof BackupActionsCard>,
): Renderer {
  const client = makeClient();
  currentClient = client;
  let tree!: Renderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <QueryClientProvider client={client}>
        <BackupActionsCard {...props} />
      </QueryClientProvider>,
    );
  });
  currentTree = tree;
  return tree;
}

function findByTestID(tree: Renderer, testID: string): ReactTestInstance {
  return tree.root.find(
    (node: ReactTestInstance) => node.props.testID === testID,
  );
}

function hasText(tree: Renderer, text: string): boolean {
  return JSON.stringify(tree.toJSON()).includes(text);
}

beforeEach(() => {
  mockTrigger = jest.fn();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  if (currentTree) {
    ReactTestRenderer.act(() => {
      currentTree?.unmount();
    });
    currentTree = null;
  }
  if (currentClient) {
    currentClient.clear();
    currentClient = null;
  }
  alertSpy.mockRestore();
});

describe('BackupActionsCard (native parity)', () => {
  it('renders the children and the action + manage controls', () => {
    const tree = render({
      children: <Text testID="content">existing rows</Text>,
    });

    expect(findByTestID(tree, 'content')).toBeDefined();
    expect(findByTestID(tree, 'backup-actions-run-button')).toBeDefined();
    expect(hasText(tree, 'Run quick backup now')).toBe(true);
    expect(findByTestID(tree, 'backup-actions-manage-link')).toBeDefined();
    expect(hasText(tree, 'Manage backups')).toBe(true);
  });

  it('routes the manage link to /backup via the navigation bridge', () => {
    const onNavigate = jest.fn();
    const tree = render({
      children: <Text>rows</Text>,
      onNavigate,
    });

    ReactTestRenderer.act(() => {
      findByTestID(tree, 'backup-actions-manage-link').props.onPress();
    });

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('/backup');
  });

  it('triggers the backup mutation on press and shows a success toast', async () => {
    mockTrigger.mockResolvedValue({id: 99, status: 'started'});
    const tree = render({children: <Text>rows</Text>});

    await ReactTestRenderer.act(async () => {
      findByTestID(tree, 'backup-actions-run-button').props.onPress();
    });

    expect(mockTrigger).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith('Quick backup started', undefined);
  });

  it('disables the button while the mutation is pending', async () => {
    let resolveFn: (v: unknown) => void = () => {};
    mockTrigger.mockReturnValue(
      new Promise(resolve => {
        resolveFn = resolve;
      }),
    );
    const tree = render({children: <Text>rows</Text>});

    await ReactTestRenderer.act(async () => {
      findByTestID(tree, 'backup-actions-run-button').props.onPress();
      // react-query schedules its pending-state notification via setTimeout(0)
      // (notifyManager defaultScheduler), so drain the macrotask queue to let
      // the isPending re-render commit before asserting.
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const btn = findByTestID(tree, 'backup-actions-run-button');
    expect(btn.props.disabled).toBe(true);
    expect(btn.props.accessibilityState.disabled).toBe(true);
    expect(hasText(tree, 'Starting')).toBe(true);

    await ReactTestRenderer.act(async () => {
      resolveFn({id: 1, status: 'started'});
    });
  });

  it('surfaces a friendly error when the mutation fails', async () => {
    mockTrigger.mockRejectedValue(new Error('disk full'));
    const tree = render({children: <Text>rows</Text>});

    await ReactTestRenderer.act(async () => {
      findByTestID(tree, 'backup-actions-run-button').props.onPress();
    });

    expect(alertSpy).toHaveBeenCalledWith('Backup failed: disk full', undefined);
  });
});
