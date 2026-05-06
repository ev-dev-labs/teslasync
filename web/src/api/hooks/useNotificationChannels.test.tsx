// Phase-46 / Prompt 37 — useNotificationChannels hook tests.
//
// The hook layer re-exports generic channel CRUD from
// `useNotifications` and adds three webhook-specific helpers:
//
//   - useWebhookChannels()       — derived list filtered to kind=webhook
//   - useTestWebhookChannel()    — POST /notifications/{id}/webhook-test
//   - useWebhookSignaturePreview() — POST /notifications/webhooks/preview-signature
//
// These tests exercise the contract each hook exposes — request
// path, request body, response shape pass-through — without
// duplicating the integration tests that the WebhookChannelsSection
// component test already covers end-to-end.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return {
    ...actual,
    request: vi.fn(),
  };
});

import { request } from '@/api/client';
import {
  useWebhookChannels,
  useTestWebhookChannel,
  useWebhookSignaturePreview,
} from './useNotificationChannels';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockedRequest.mockReset();
});

describe('useWebhookChannels', () => {
  it('filters the full channels list down to kind=webhook', async () => {
    mockedRequest.mockImplementation((path: string) => {
      if (path === '/notifications') {
        return Promise.resolve([
          {
            id: 1,
            kind: 'webhook',
            name: 'Discord',
            enabled: true,
            url: 'https://discord.com/api/webhooks/x',
            method: 'POST',
            headers: {},
            body_template: '',
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
          {
            id: 2,
            kind: 'discord',
            name: 'Old Discord',
            enabled: true,
            webhook_url: 'https://discord.com/api/webhooks/y',
            username: null,
            avatar_url: null,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
          {
            id: 3,
            kind: 'webhook',
            name: 'Slack',
            enabled: false,
            url: 'https://hooks.slack.com/services/z',
            method: 'POST',
            headers: {},
            body_template: '',
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ]);
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const { result } = renderHook(() => useWebhookChannels(), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toHaveLength(2);
    });
    expect(result.current.data.map((w) => w.id)).toEqual([1, 3]);
  });

  it('returns an empty array when there are no webhooks', async () => {
    mockedRequest.mockImplementation((path: string) => {
      if (path === '/notifications') return Promise.resolve([]);
      throw new Error(`unexpected path: ${path}`);
    });
    const { result } = renderHook(() => useWebhookChannels(), { wrapper });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.data).toEqual([]);
  });
});

describe('useTestWebhookChannel', () => {
  it('POSTs to /notifications/{id}/webhook-test with no body when title/message are blank', async () => {
    mockedRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/notifications/55/webhook-test' && init?.method === 'POST') {
        // No body should have been attached.
        expect(init.body).toBeUndefined();
        return Promise.resolve({
          success: true,
          status_code: 204,
          latency_ms: 12,
        });
      }
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${path}`);
    });

    const { result } = renderHook(() => useTestWebhookChannel(), { wrapper });
    await act(async () => {
      const res = await result.current.mutateAsync({ id: 55 });
      expect(res.success).toBe(true);
      expect(res.status_code).toBe(204);
    });
  });

  it('POSTs the title/message JSON body when supplied', async () => {
    mockedRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/notifications/77/webhook-test' && init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        expect(body).toEqual({ title: 'Hello', message: 'World' });
        return Promise.resolve({
          success: true,
          status_code: 200,
          latency_ms: 33,
        });
      }
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${path}`);
    });

    const { result } = renderHook(() => useTestWebhookChannel(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 77, title: 'Hello', message: 'World' });
    });
  });

  it('skips empty/whitespace-only title and message fields', async () => {
    mockedRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/notifications/88/webhook-test' && init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        expect(body).toEqual({ title: 'kept' });
        return Promise.resolve({
          success: false,
          status_code: 0,
          latency_ms: 0,
          error: 'oops',
        });
      }
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${path}`);
    });

    const { result } = renderHook(() => useTestWebhookChannel(), { wrapper });
    await act(async () => {
      const res = await result.current.mutateAsync({
        id: 88,
        title: 'kept',
        message: '   ',
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe('oops');
    });
  });
});

describe('useWebhookSignaturePreview', () => {
  it('POSTs the secret/body pair and returns the server signature', async () => {
    mockedRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/notifications/webhooks/preview-signature' && init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        expect(body).toEqual({ secret: 'shh', body: '{"x":1}' });
        return Promise.resolve({ signature: 'sha256=abcd' });
      }
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${path}`);
    });

    const { result } = renderHook(() => useWebhookSignaturePreview(), { wrapper });
    await act(async () => {
      const res = await result.current.mutateAsync({ secret: 'shh', body: '{"x":1}' });
      expect(res.signature).toBe('sha256=abcd');
    });
  });

  it('propagates server errors via the mutation onError path', async () => {
    mockedRequest.mockImplementation(() => Promise.reject(new Error('boom')));

    const { result } = renderHook(() => useWebhookSignaturePreview(), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ secret: 's', body: '' }),
      ).rejects.toThrow(/boom/);
    });
  });
});
