import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {WebhookChannelsSection} from '../src/web-parity/features/settings/components/WebhookChannelsSection';

/**
 * Native parity contract for WebhookChannelsSection.
 *
 * The web component is the Webhook notification channels Settings section: a
 * header with an "Add webhook" CTA, a loading spinner, a load-error message, an
 * empty state, a list of webhook rows (enabled/disabled + method badges, URL, a
 * Test/Edit/Delete action cluster, and a last-test-result panel), an add/edit
 * form modal with a live HMAC signature preview, and a delete confirm dialog.
 * These tests mock the six ported notification-channel query/mutation hooks and
 * assert the branch rendering, the Add → form-modal transition, the Test write
 * path, and the Delete → confirm → delete write path.
 */

const mockUseWebhookChannels = jest.fn();
const mockUseDeleteChannel = jest.fn();
const mockUseToggleChannel = jest.fn();
const mockUseTestWebhookChannel = jest.fn();
const mockUseSaveChannel = jest.fn();
const mockUseWebhookSignaturePreview = jest.fn();

const mockDeleteMutate = jest.fn();
const mockToggleMutate = jest.fn();
const mockTestMutate = jest.fn();
const mockSaveMutate = jest.fn();

jest.mock('../src/web-parity/api/hooks/useNotificationChannels', () => ({
  useWebhookChannels: (...args: unknown[]) => mockUseWebhookChannels(...args),
  useDeleteChannel: (...args: unknown[]) => mockUseDeleteChannel(...args),
  useToggleChannel: (...args: unknown[]) => mockUseToggleChannel(...args),
  useTestWebhookChannel: (...args: unknown[]) =>
    mockUseTestWebhookChannel(...args),
  useSaveChannel: (...args: unknown[]) => mockUseSaveChannel(...args),
  useWebhookSignaturePreview: (...args: unknown[]) =>
    mockUseWebhookSignaturePreview(...args),
}));

// FadeIn wraps children in an Animated.View whose useNativeDriver timer would
// fire after the Jest env tears down. The animation is irrelevant to the parity
// assertions, so render children directly.
jest.mock('../src/web-parity/components/motion/FadeIn', () => {
  const ReactLocal = require('react');
  return {
    FadeIn: ({children}: {children: unknown}) =>
      ReactLocal.createElement(ReactLocal.Fragment, null, children),
  };
});

type Tree = ReactTestRenderer.ReactTestRenderer;

interface WebhookChannel {
  id: number;
  name: string;
  kind: 'webhook';
  enabled: boolean;
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  headers: Record<string, string>;
  body_template: string;
  created_at: string;
  updated_at: string;
}

const SAMPLE: WebhookChannel = {
  id: 5,
  name: 'Discord alerts',
  kind: 'webhook',
  enabled: true,
  url: 'https://discord.com/api/webhooks/abc',
  method: 'POST',
  headers: {},
  body_template: '',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

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

// RN copies testID onto BOTH the composite and the host instance, so count only
// host instances (typeof type === 'string') to get the real DOM-equivalent tally.
function hostCount(tree: Tree, testID: string): number {
  return tree.root.findAll(
    n => n.props?.testID === testID && typeof n.type === 'string',
  ).length;
}

function pressByTestID(tree: Tree, testID: string): void {
  const host = tree.root
    .findAll(n => n.props?.testID === testID)
    .find(n => typeof n.props?.onPress === 'function');
  if (!host) {
    throw new Error(`no pressable with testID="${testID}"`);
  }
  ReactTestRenderer.act(() => {
    host.props.onPress();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseWebhookChannels.mockReturnValue({
    data: [SAMPLE],
    isLoading: false,
    error: null,
  });
  mockUseDeleteChannel.mockReturnValue({
    mutate: mockDeleteMutate,
    isPending: false,
  });
  mockUseToggleChannel.mockReturnValue({
    mutate: mockToggleMutate,
    isPending: false,
    variables: undefined,
  });
  mockUseTestWebhookChannel.mockReturnValue({
    mutate: mockTestMutate,
    isPending: false,
    variables: undefined,
  });
  mockUseSaveChannel.mockReturnValue({
    mutate: mockSaveMutate,
    isPending: false,
  });
  mockUseWebhookSignaturePreview.mockReturnValue({
    mutateAsync: jest.fn().mockResolvedValue({signature: 'deadbeef'}),
    isPending: false,
  });
});

test('renders the header title, subtitle, and the Add webhook CTA', () => {
  const tree = render(<WebhookChannelsSection />);

  const body = json(tree);
  expect(body).toContain('Webhook channels');
  expect(body).toContain('Forward TeslaSync notifications to Discord');
  expect(body).toContain('Add webhook');
  // Section container preserved.
  expect(hostCount(tree, 'webhook-channels-section')).toBe(1);

  ReactTestRenderer.act(() => tree.unmount());
});

test('renders a webhook row with the enabled badge, method badge, and URL', () => {
  const tree = render(<WebhookChannelsSection />);

  expect(hostCount(tree, 'webhook-row-5')).toBe(1);

  const body = json(tree);
  expect(body).toContain('Discord alerts');
  expect(body).toContain('Enabled');
  // method badge uppercased.
  expect(body).toContain('POST');
  expect(body).toContain('https://discord.com/api/webhooks/abc');

  ReactTestRenderer.act(() => tree.unmount());
});

test('loading state hides the list', () => {
  mockUseWebhookChannels.mockReturnValue({
    data: [],
    isLoading: true,
    error: null,
  });

  const tree = render(<WebhookChannelsSection />);

  expect(hostCount(tree, 'webhook-row-5')).toBe(0);
  // The docs box always renders, so the section is still mounted.
  expect(hostCount(tree, 'webhook-channels-section')).toBe(1);

  ReactTestRenderer.act(() => tree.unmount());
});

test('error state shows the load-error message', () => {
  mockUseWebhookChannels.mockReturnValue({
    data: [],
    isLoading: false,
    error: new Error('boom'),
  });

  const tree = render(<WebhookChannelsSection />);

  expect(json(tree)).toContain('Failed to load webhook channels: boom');
  expect(hostCount(tree, 'webhook-row-5')).toBe(0);

  ReactTestRenderer.act(() => tree.unmount());
});

test('empty state shows the placeholder when there are no webhooks', () => {
  mockUseWebhookChannels.mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
  });

  const tree = render(<WebhookChannelsSection />);

  expect(json(tree)).toContain('No webhooks yet');

  ReactTestRenderer.act(() => tree.unmount());
});

test('pressing Add opens the webhook form modal', () => {
  const tree = render(<WebhookChannelsSection />);
  expect(hostCount(tree, 'webhook-form-modal')).toBe(0);

  pressByTestID(tree, 'webhook-add');

  expect(hostCount(tree, 'webhook-form-modal')).toBe(1);
  // The add-mode form title (not the edit title).
  expect(json(tree)).toContain('Add webhook');

  ReactTestRenderer.act(() => tree.unmount());
});

test('pressing Test on a row calls testMut.mutate with the channel id', () => {
  const tree = render(<WebhookChannelsSection />);

  pressByTestID(tree, 'webhook-test-5');

  expect(mockTestMutate).toHaveBeenCalledTimes(1);
  expect(mockTestMutate.mock.calls[0][0]).toEqual({id: 5});

  ReactTestRenderer.act(() => tree.unmount());
});

test('Delete opens the confirm dialog and confirming calls deleteMut.mutate with the id', () => {
  const tree = render(<WebhookChannelsSection />);
  expect(hostCount(tree, 'webhook-confirm-dialog')).toBe(0);

  pressByTestID(tree, 'webhook-delete-5');
  expect(hostCount(tree, 'webhook-confirm-dialog')).toBe(1);

  pressByTestID(tree, 'webhook-confirm-confirm');
  expect(mockDeleteMutate).toHaveBeenCalledTimes(1);
  expect(mockDeleteMutate.mock.calls[0][0]).toBe(5);

  ReactTestRenderer.act(() => tree.unmount());
});
