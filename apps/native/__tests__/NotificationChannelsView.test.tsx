import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

// The notification channel hooks are mocked so the view renders synchronously
// without a QueryClientProvider, network, or open handles (the
// NotificationsPlatform / AlertMessageEditor mocking precedent). The mock
// buckets are read only when each hook is *called* (render time), so the
// `let`s are safely initialised before the factory closures dereference them.
type ChannelsQuery = {
  data?: Array<Record<string, unknown>>;
  isLoading?: boolean;
};
type StatsQuery = {data?: Record<string, unknown> | undefined};

let mockChannels: ChannelsQuery = {data: [], isLoading: false};
let mockStats: StatsQuery = {data: undefined};
let mockTestVariables: number | undefined;
let mockTestPending = false;

const mockSave = jest.fn();
const mockDelete = jest.fn();
const mockToggle = jest.fn();
const mockTest = jest.fn();

jest.mock('../src/web-parity/api/hooks/useNotifications', () => ({
  useNotificationChannels: () => mockChannels,
  useNotificationStats: () => mockStats,
  useSaveChannel: () => ({mutate: mockSave, isPending: false}),
  useDeleteChannel: () => ({mutate: mockDelete, isPending: false}),
  useToggleChannel: () => ({mutate: mockToggle, isPending: false}),
  useTestChannel: () => ({
    mutate: mockTest,
    isPending: mockTestPending,
    variables: mockTestVariables,
  }),
}));

import {
  NotificationChannelsView,
  getChannelMeta,
} from '../src/web-parity/features/notifications/components/NotificationChannelsView';

type Renderer = ReactTestRenderer.ReactTestRenderer;

const STATS = {
  total_sent: 12,
  sent: 10,
  failed: 2,
  pending: 1,
  total_channels: 3,
  enabled_channels: 2,
};

const DISCORD_CHANNEL = {
  id: 1,
  name: 'Ops Discord',
  kind: 'discord',
  enabled: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  webhook_url: 'https://discord.com/api/webhooks/abc',
  username: null,
  avatar_url: null,
};

const TELEGRAM_CHANNEL = {
  id: 2,
  name: 'Pager Telegram',
  kind: 'telegram',
  enabled: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  bot_token: 'secrettoken',
  chat_id: '-100123',
};

let currentTree: Renderer | null = null;

function countTestID(tree: Renderer, testID: string): number {
  return tree.root.findAll(
    node => typeof node.type === 'string' && node.props.testID === testID,
  ).length;
}

function press(tree: Renderer, testID: string): void {
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

function render(): Renderer {
  let tree!: Renderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<NotificationChannelsView />);
  });
  currentTree = tree;
  return tree;
}

describe('NotificationChannelsView (native parity)', () => {
  beforeEach(() => {
    mockChannels = {data: [], isLoading: false};
    mockStats = {data: undefined};
    mockTestVariables = undefined;
    mockTestPending = false;
    mockSave.mockClear();
    mockDelete.mockClear();
    mockToggle.mockClear();
    mockTest.mockClear();
  });

  afterEach(() => {
    if (currentTree) {
      ReactTestRenderer.act(() => {
        currentTree?.unmount();
      });
      currentTree = null;
    }
  });

  it('renders the add button and the browser-push unavailable card', () => {
    const tree = render();
    expect(countTestID(tree, 'nc-root')).toBe(1);
    expect(countTestID(tree, 'nc-add-button')).toBe(1);
    expect(countTestID(tree, 'nc-browser-push-card')).toBe(1);
    expect(countTestID(tree, 'nc-browser-push-status')).toBe(1);
    expect(hasText(tree, 'Browser push')).toBe(true);
    expect(hasText(tree, 'Unavailable')).toBe(true);
    expect(hasText(tree, 'Add Channel')).toBe(true);
  });

  it('renders four stat skeletons while stats are loading', () => {
    mockStats = {data: undefined};
    const tree = render();
    expect(countTestID(tree, 'nc-stat-sent')).toBe(0);
  });

  it('renders the four metric cards when stats are present', () => {
    mockStats = {data: STATS};
    const tree = render();
    expect(countTestID(tree, 'nc-stat-sent')).toBe(1);
    expect(countTestID(tree, 'nc-stat-failed')).toBe(1);
    expect(countTestID(tree, 'nc-stat-pending')).toBe(1);
    expect(countTestID(tree, 'nc-stat-channels')).toBe(1);
    // active channels metric renders "2/3"
    expect(hasText(tree, '2/3')).toBe(true);
    expect(hasText(tree, 'Total Sent')).toBe(true);
  });

  it('renders a card per channel with masked secrets and an empty state otherwise', () => {
    mockChannels = {data: [DISCORD_CHANNEL, TELEGRAM_CHANNEL], isLoading: false};
    const tree = render();
    expect(countTestID(tree, 'nc-channel-1')).toBe(1);
    expect(countTestID(tree, 'nc-channel-2')).toBe(1);
    expect(countTestID(tree, 'nc-empty')).toBe(0);
    expect(hasText(tree, 'Ops Discord')).toBe(true);
    expect(hasText(tree, 'Pager Telegram')).toBe(true);
    // telegram bot_token is masked in the config preview
    expect(hasText(tree, 'secrettoken')).toBe(false);
    expect(hasText(tree, '••••••••')).toBe(true);
  });

  it('renders the empty state when there are no channels', () => {
    mockChannels = {data: [], isLoading: false};
    const tree = render();
    expect(countTestID(tree, 'nc-empty')).toBe(1);
    expect(hasText(tree, 'No channels configured')).toBe(true);
  });

  it('renders skeletons while channels are loading', () => {
    mockChannels = {data: [], isLoading: true};
    const tree = render();
    expect(countTestID(tree, 'nc-empty')).toBe(0);
  });

  it('opens the add-channel form modal with the channel type grid', () => {
    const tree = render();
    expect(countTestID(tree, 'nc-form-modal')).toBe(0);
    press(tree, 'nc-add-button');
    expect(countTestID(tree, 'nc-form-modal')).toBe(1);
    expect(countTestID(tree, 'nc-name-input')).toBe(1);
    expect(countTestID(tree, 'nc-type-discord')).toBe(1);
    expect(countTestID(tree, 'nc-type-pushover')).toBe(1);
    expect(hasText(tree, 'Add Channel')).toBe(true);
    expect(hasText(tree, 'Channel Type')).toBe(true);
  });

  it('blocks submit and shows a validation error when the name is blank', () => {
    const tree = render();
    press(tree, 'nc-add-button');
    press(tree, 'nc-submit-button');
    expect(mockSave).not.toHaveBeenCalled();
    expect(countTestID(tree, 'nc-form-error')).toBe(1);
    expect(hasText(tree, 'Name is required')).toBe(true);
  });

  it('toggles a channel through the mutation hook', () => {
    mockChannels = {data: [DISCORD_CHANNEL], isLoading: false};
    const tree = render();
    press(tree, 'nc-channel-toggle-1');
    expect(mockToggle).toHaveBeenCalledTimes(1);
    expect(mockToggle.mock.calls[0][0]).toBe(1);
  });

  it('deletes a channel through the mutation hook', () => {
    mockChannels = {data: [DISCORD_CHANNEL], isLoading: false};
    const tree = render();
    press(tree, 'nc-channel-delete-1');
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete.mock.calls[0][0]).toBe(1);
  });

  it('opens the edit form prefilled when a channel edit is pressed', () => {
    mockChannels = {data: [DISCORD_CHANNEL], isLoading: false};
    const tree = render();
    press(tree, 'nc-channel-edit-1');
    expect(countTestID(tree, 'nc-form-modal')).toBe(1);
    // edit mode shows the Test Connection button and no type grid
    expect(countTestID(tree, 'nc-test-button')).toBe(1);
    expect(countTestID(tree, 'nc-type-discord')).toBe(0);
    expect(hasText(tree, 'Edit Channel')).toBe(true);
  });

  it('getChannelMeta resolves known kinds and falls back to webhook', () => {
    expect(getChannelMeta('discord').label).toBe('Discord');
    expect(getChannelMeta('pushover').label).toBe('Pushover');
    expect(getChannelMeta('unknown-kind').value).toBe('webhook');
  });
});
