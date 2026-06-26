import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  useDeleteChannel,
  useSaveChannel,
  useTestWebhookChannel,
  useToggleChannel,
  useWebhookChannels,
  useWebhookSignaturePreview,
  type NotificationChannelWebhook,
} from '../src/web-parity/api/hooks/useNotificationChannels';
import WebhooksPage from '../src/web-parity/features/notifications/pages/WebhooksPage';

jest.mock('../src/web-parity/api/hooks/useNotificationChannels', () => ({
  useWebhookChannels: jest.fn(),
  useSaveChannel: jest.fn(),
  useDeleteChannel: jest.fn(),
  useToggleChannel: jest.fn(),
  useTestWebhookChannel: jest.fn(),
  useWebhookSignaturePreview: jest.fn(),
}));

const mockUseWebhookChannels = useWebhookChannels as unknown as jest.Mock;
const mockUseSaveChannel = useSaveChannel as unknown as jest.Mock;
const mockUseDeleteChannel = useDeleteChannel as unknown as jest.Mock;
const mockUseToggleChannel = useToggleChannel as unknown as jest.Mock;
const mockUseTestWebhookChannel = useTestWebhookChannel as unknown as jest.Mock;
const mockUseWebhookSignaturePreview =
  useWebhookSignaturePreview as unknown as jest.Mock;

type JsonNode =
  | string
  | number
  | null
  | undefined
  | {children?: JsonNode | JsonNode[]}
  | JsonNode[];

// Interpolated JSX text renders as several adjacent text segments, so flatten
// every text leaf into one string before asserting.
function flattenText(node: JsonNode): string {
  if (node == null) {
    return '';
  }
  if (typeof node === 'string') {
    return node;
  }
  if (typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(flattenText).join('');
  }
  return flattenText(node.children);
}

function textOf(tree: ReactTestRenderer.ReactTestRenderer | undefined): string {
  return flattenText(tree?.toJSON() as JsonNode);
}

function rawOf(tree: ReactTestRenderer.ReactTestRenderer | undefined): string {
  return JSON.stringify(tree?.toJSON());
}

function mutationStub(overrides: Record<string, unknown> = {}) {
  return {mutate: jest.fn(), isPending: false, variables: undefined, ...overrides};
}

function channelsStub(
  data: NotificationChannelWebhook[] | undefined,
  isLoading: boolean,
  error: Error | null = null,
) {
  return {data, isLoading, error};
}

function webhook(
  overrides: Partial<NotificationChannelWebhook> &
    Pick<NotificationChannelWebhook, 'id' | 'name' | 'url'>,
): NotificationChannelWebhook {
  return {
    kind: 'webhook',
    enabled: true,
    method: 'POST',
    headers: {},
    body_template: '',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as NotificationChannelWebhook;
}

async function render(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<WebhooksPage />);
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}

beforeEach(() => {
  mockUseSaveChannel.mockReturnValue(mutationStub());
  mockUseDeleteChannel.mockReturnValue(mutationStub());
  mockUseToggleChannel.mockReturnValue(mutationStub());
  mockUseTestWebhookChannel.mockReturnValue(mutationStub());
  mockUseWebhookSignaturePreview.mockReturnValue({
    mutateAsync: jest.fn().mockResolvedValue({signature: ''}),
    isPending: false,
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

test('renders the page header (title + subtitle) and a spinner while channels load', async () => {
  mockUseWebhookChannels.mockReturnValue(channelsStub(undefined, true));

  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  // usePageTitle('Webhooks') becomes the on-screen header.
  expect(text).toContain('Webhooks');
  expect(text).toContain(
    'Custom HTTPS endpoints that receive HMAC-signed event payloads.',
  );
  expect(raw).toContain('webhooks-page');
  expect(raw).toContain('webhook-channels-section');
  expect(raw).toContain('webhook-channels-loading');
  // While loading, the list/empty body is gated off, exactly like web.
  expect(raw).not.toContain('webhook-channels-list');
  expect(raw).not.toContain('webhook-channels-empty');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('renders the EmptyState and an add affordance when no webhooks exist', async () => {
  mockUseWebhookChannels.mockReturnValue(channelsStub([], false));

  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('webhook-channels-empty');
  expect(text).toContain('No webhooks yet');
  expect(text).toContain(
    'Add a webhook to forward TeslaSync events to your favourite chat or automation tool.',
  );
  // The "Add webhook" header button is always present.
  expect(raw).toContain('webhook-add');
  expect(raw).toContain('webhook-empty-add');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('renders the load-error message when the channels query fails', async () => {
  mockUseWebhookChannels.mockReturnValue(
    channelsStub(undefined, false, new Error('boom')),
  );

  const tree = await render();
  const text = textOf(tree);

  expect(text).toContain('Failed to load webhook channels: boom');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('renders each webhook row sorted by name with status, method, URL, and actions', async () => {
  const channels = [
    webhook({
      id: 2,
      name: 'Zulip ops',
      url: 'https://zulip.example.com/api/webhook',
      enabled: false,
      method: 'PUT',
    }),
    webhook({
      id: 1,
      name: 'Discord alerts',
      url: 'https://discord.com/api/webhooks/abc',
      enabled: true,
      method: 'POST',
    }),
  ];
  mockUseWebhookChannels.mockReturnValue(channelsStub(channels, false));

  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('webhook-channels-list');
  expect(raw).toContain('webhook-row-1');
  expect(raw).toContain('webhook-row-2');

  // Names, the enabled/disabled badge text, the upper-cased method badge, URLs.
  expect(text).toContain('Discord alerts');
  expect(text).toContain('Zulip ops');
  expect(text).toContain('Enabled');
  expect(text).toContain('Disabled');
  expect(text).toContain('POST');
  expect(text).toContain('PUT');
  expect(text).toContain('https://discord.com/api/webhooks/abc');

  // Per-row Test / Edit / Delete affordances.
  expect(raw).toContain('webhook-test-1');
  expect(raw).toContain('webhook-edit-1');
  expect(raw).toContain('webhook-delete-1');

  // The payload-variables docs block renders beneath the list.
  expect(text).toContain('Available payload variables');
  expect(text).toContain('Webhook receivers get a JSON envelope with these fields:');

  // The add/edit form modal and delete confirm dialog stay closed (and so their
  // content is not rendered) until the user opens them — matching the web Modal.
  expect(raw).not.toContain('webhook-form-modal');
  expect(raw).not.toContain('webhook-delete-dialog');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});
