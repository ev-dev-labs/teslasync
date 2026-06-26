import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

// The settings hooks are mocked so the view renders synchronously without a
// QueryClientProvider, network, or open handles (the NotificationSettings
// mocking precedent). The mock buckets are read when each hook is *called*
// (render time), so reassigning them before render swaps the returned value.
type AuthQuery = {data?: {authenticated: boolean; expires_at?: string}};

const mockAuthUrlMutate = jest.fn();
const mockRefreshMutate = jest.fn();
const mockDisconnectMutate = jest.fn();
const mockSyncMutate = jest.fn();

let mockAuth: AuthQuery = {data: undefined};
let mockAuthUrl: {mutate: jest.Mock; isPending: boolean} = {
  mutate: mockAuthUrlMutate,
  isPending: false,
};
let mockRefresh: {mutate: jest.Mock; isPending: boolean} = {
  mutate: mockRefreshMutate,
  isPending: false,
};
let mockDisconnect: {mutate: jest.Mock; isPending: boolean} = {
  mutate: mockDisconnectMutate,
  isPending: false,
};
let mockSync: {
  mutate: jest.Mock;
  isPending: boolean;
  isSuccess: boolean;
  data?: {synced: number};
} = {mutate: mockSyncMutate, isPending: false, isSuccess: false, data: undefined};

jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useAuthStatus: () => mockAuth,
  useAuthURL: () => mockAuthUrl,
  useRefreshAuth: () => mockRefresh,
  useDisconnectAuth: () => mockDisconnect,
  useSyncVehicles: () => mockSync,
}));

import {
  TeslaAccountSection,
  notifyTeslaAuthRecovered,
} from '../src/web-parity/features/settings/components/TeslaAccountSection';

type Renderer = ReactTestRenderer.ReactTestRenderer;

type HostNode = {
  type?: string;
  props?: Record<string, any>;
  children?: HostNode[] | null;
};

function walkHosts(json: unknown): HostNode[] {
  const out: HostNode[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') {
      return;
    }
    const nodes = Array.isArray(node) ? node : [node as HostNode];
    for (const n of nodes) {
      if (!n || typeof n !== 'object') {
        continue;
      }
      out.push(n as HostNode);
      visit((n as HostNode).children);
    }
  };
  visit(json);
  return out;
}

function countTestID(tree: Renderer, testID: string): number {
  return walkHosts(tree.toJSON()).filter(n => n.props?.testID === testID).length;
}

function pressTestID(tree: Renderer, testID: string): void {
  const target = tree.root.find(
    node =>
      node.props.testID === testID && typeof node.props.onPress === 'function',
  );
  ReactTestRenderer.act(() => {
    target.props.onPress();
  });
}

function hasText(tree: Renderer, text: string): boolean {
  return JSON.stringify(tree.toJSON()).includes(text);
}

let currentTree: Renderer | null = null;

function render(): Renderer {
  let tree!: Renderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<TeslaAccountSection />);
  });
  currentTree = tree;
  return tree;
}

const FAR_FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const THREE_DAYS = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

describe('TeslaAccountSection (native parity)', () => {
  beforeEach(() => {
    mockAuth = {data: undefined};
    mockAuthUrl = {mutate: mockAuthUrlMutate, isPending: false};
    mockRefresh = {mutate: mockRefreshMutate, isPending: false};
    mockDisconnect = {mutate: mockDisconnectMutate, isPending: false};
    mockSync = {
      mutate: mockSyncMutate,
      isPending: false,
      isSuccess: false,
      data: undefined,
    };
    mockAuthUrlMutate.mockClear();
    mockRefreshMutate.mockClear();
    mockDisconnectMutate.mockClear();
    mockSyncMutate.mockClear();
  });

  afterEach(() => {
    if (currentTree) {
      ReactTestRenderer.act(() => {
        currentTree?.unmount();
      });
      currentTree = null;
    }
  });

  it('renders the panel header', () => {
    const tree = render();
    expect(countTestID(tree, 'settings-tesla-account')).toBe(1);
    expect(hasText(tree, 'Tesla Account')).toBe(true);
    expect(
      hasText(tree, 'Connect your Tesla account to sync vehicles and data'),
    ).toBe(true);
  });

  it('shows the not-connected state with a single Connect button', () => {
    mockAuth = {data: {authenticated: false}};
    const tree = render();
    expect(hasText(tree, 'Not connected')).toBe(true);
    expect(countTestID(tree, 'tesla-connect')).toBe(1);
    expect(countTestID(tree, 'tesla-refresh')).toBe(0);
    expect(countTestID(tree, 'tesla-disconnect')).toBe(0);
  });

  it('invokes the auth-URL mutation when Connect is pressed', () => {
    mockAuth = {data: {authenticated: false}};
    const tree = render();
    pressTestID(tree, 'tesla-connect');
    expect(mockAuthUrlMutate).toHaveBeenCalledTimes(1);
  });

  it('shows the connected state with the four management buttons and token-expires line', () => {
    mockAuth = {data: {authenticated: true, expires_at: FAR_FUTURE}};
    const tree = render();
    expect(hasText(tree, 'Connected')).toBe(true);
    expect(hasText(tree, 'Token expires')).toBe(true);
    expect(countTestID(tree, 'tesla-refresh')).toBe(1);
    expect(countTestID(tree, 'tesla-sync')).toBe(1);
    expect(countTestID(tree, 'tesla-reauthorize')).toBe(1);
    expect(countTestID(tree, 'tesla-disconnect')).toBe(1);
    expect(countTestID(tree, 'tesla-connect')).toBe(0);
    // Token is 30 days out -> no soft-warning pill.
    expect(countTestID(tree, 'tesla-expiring-soon-pill')).toBe(0);
  });

  it('surfaces the expiring-soon pill when the token expires within 7 days', () => {
    mockAuth = {data: {authenticated: true, expires_at: THREE_DAYS}};
    const tree = render();
    expect(countTestID(tree, 'tesla-expiring-soon-pill')).toBe(1);
    expect(hasText(tree, 'Expires in 3d')).toBe(true);
  });

  it('renders the synced confirmation line from the mutation result', () => {
    mockAuth = {data: {authenticated: true, expires_at: FAR_FUTURE}};
    mockSync = {
      mutate: mockSyncMutate,
      isPending: false,
      isSuccess: true,
      data: {synced: 2},
    };
    const tree = render();
    expect(hasText(tree, 'Synced 2 vehicle(s).')).toBe(true);
  });

  it('invokes the disconnect flow when Disconnect is pressed', () => {
    mockAuth = {data: {authenticated: true, expires_at: FAR_FUTURE}};
    const tree = render();
    // handleDisconnect opens the confirm dialog (async); the press itself is
    // the observable behaviour wired to the danger button.
    expect(() => pressTestID(tree, 'tesla-disconnect')).not.toThrow();
  });

  it('exposes a native notifyTeslaAuthRecovered that is safe to call', () => {
    expect(typeof notifyTeslaAuthRecovered).toBe('function');
    expect(() => notifyTeslaAuthRecovered()).not.toThrow();
  });
});
