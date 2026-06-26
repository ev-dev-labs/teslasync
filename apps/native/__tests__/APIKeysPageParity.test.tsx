import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  useApiKeys,
  useCreateApiKey,
  useDeleteApiKey,
  useRevokeApiKey,
  type APIKey,
} from '../src/web-parity/api/hooks/useAdmin';
import APIKeysPage from '../src/web-parity/features/admin/pages/APIKeysPage';

jest.mock('../src/web-parity/api/hooks/useAdmin', () => ({
  useApiKeys: jest.fn(),
  useCreateApiKey: jest.fn(),
  useDeleteApiKey: jest.fn(),
  useRevokeApiKey: jest.fn(),
}));

const mockUseApiKeys = useApiKeys as unknown as jest.Mock;
const mockUseCreateApiKey = useCreateApiKey as unknown as jest.Mock;
const mockUseDeleteApiKey = useDeleteApiKey as unknown as jest.Mock;
const mockUseRevokeApiKey = useRevokeApiKey as unknown as jest.Mock;

type JsonNode =
  | string
  | number
  | null
  | undefined
  | {children?: JsonNode | JsonNode[]}
  | JsonNode[];

// Interpolated JSX text (e.g. `Created {date}`) renders as several adjacent
// text segments, so flatten every text leaf into one string before asserting.
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
  return {mutate: jest.fn(), isPending: false, ...overrides};
}

function queryStub(data: APIKey[] | undefined, isLoading: boolean) {
  return {data, isLoading};
}

async function render(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<APIKeysPage />);
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}

beforeEach(() => {
  mockUseCreateApiKey.mockReturnValue(mutationStub());
  mockUseDeleteApiKey.mockReturnValue(mutationStub());
  mockUseRevokeApiKey.mockReturnValue(mutationStub());
});

afterEach(() => {
  jest.clearAllMocks();
});

test('renders the page title and a centered spinner while keys are loading', async () => {
  mockUseApiKeys.mockReturnValue(queryStub(undefined, true));

  const tree = await render();
  const raw = rawOf(tree);

  expect(textOf(tree)).toContain('API Keys');
  expect(raw).toContain('api-keys-page');
  expect(raw).toContain('api-keys-loading');
  // While loading the body (list/empty) is gated off, exactly like web.
  expect(raw).not.toContain('api-keys-list');
  expect(raw).not.toContain('api-keys-empty');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('renders the EmptyState when no API keys exist', async () => {
  mockUseApiKeys.mockReturnValue(queryStub([], false));

  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('api-keys-empty');
  expect(text).toContain('No API keys');
  expect(text).toContain(
    'Create an API key to enable programmatic access to TeslaSync data and controls.',
  );

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('renders each key with its name, permission label, and row actions', async () => {
  const keys: APIKey[] = [
    {
      id: 'key-1',
      name: 'Production Reader',
      keyPrefix: 'sk_live_abcd',
      permissions: 'read',
      createdAt: '2026-01-02T03:04:05Z',
      lastUsedAt: '2026-02-03T04:05:06Z',
      expiresAt: null,
    },
  ];
  mockUseApiKeys.mockReturnValue(queryStub(keys, false));

  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('api-keys-list');
  expect(raw).toContain('api-key-row-key-1');
  expect(text).toContain('Production Reader');
  expect(text).toContain('Read');
  expect(text).toContain('sk_live_abcd');
  expect(text).toContain('Created');
  expect(text).toContain('Last used');
  // Non-expired key shows both the revoke and delete affordances.
  expect(raw).toContain('api-key-revoke-key-1');
  expect(raw).toContain('api-key-delete-key-1');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('marks an expired key and hides its revoke action', async () => {
  const keys: APIKey[] = [
    {
      id: 'key-old',
      name: 'Legacy Token',
      keyPrefix: 'sk_live_old0',
      permissions: 'admin',
      createdAt: '2020-01-01T00:00:00Z',
      lastUsedAt: null,
      expiresAt: '2020-06-01T00:00:00Z',
    },
  ];
  mockUseApiKeys.mockReturnValue(queryStub(keys, false));

  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(text).toContain('Expired');
  expect(text).toContain('Admin');
  // Expired keys can still be deleted but not revoked.
  expect(raw).toContain('api-key-delete-key-old');
  expect(raw).not.toContain('api-key-revoke-key-old');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});
