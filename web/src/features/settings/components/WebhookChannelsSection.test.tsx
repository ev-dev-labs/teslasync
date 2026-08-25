// WebhookChannelsSection tests.
//
// Mock surface: the test stubs `request()` from `@/api/client` so the
// hook layer (`useNotificationChannels`, `useTestWebhookChannel`,
// `useWebhookSignaturePreview`, `useSaveChannel`, `useDeleteChannel`,
// `useToggleChannel`) all flow through one router-style switch.
//
// The component is intentionally rendered inside ToastProvider +
// QueryClientProvider so the shared mutation toast helper resolves
// without crashing — same pattern as SettingsExportImport.test.tsx.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return {
    ...actual,
    request: vi.fn(),
  };
});

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback =
          typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined;
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined);
        let result = fallback ?? key;
        if (opts) {
          for (const [k, v] of Object.entries(opts)) {
            result = result.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
          }
        }
        return result;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import { request } from '@/api/client';
import { ToastProvider } from '@/components/feedback/Toast';
import { WebhookChannelsSection } from './WebhookChannelsSection';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

interface FakeWebhook {
  id: number;
  kind: 'webhook';
  name: string;
  enabled: boolean;
  url: string;
  method: 'POST' | 'PUT';
  headers: Record<string, string>;
  body_template: string;
  created_at: string;
  updated_at: string;
}

const baseWebhook = (overrides: Partial<FakeWebhook> = {}): FakeWebhook => ({
  id: 42,
  kind: 'webhook',
  name: 'Discord #alerts',
  enabled: true,
  url: 'https://discord.com/api/webhooks/abc/def',
  method: 'POST',
  headers: {},
  body_template: '',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  ...overrides,
});

function renderSection() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <WebhookChannelsSection />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedRequest.mockReset();
});

describe('WebhookChannelsSection — list', () => {
  it('renders the empty state when there are no webhooks', async () => {
    mockedRequest.mockImplementation((path: string) => {
      if (path === '/notifications') return Promise.resolve([]);
      throw new Error(`unexpected path: ${path}`);
    });

    renderSection();

    await waitFor(() => {
      expect(
        screen.getByText('No webhooks yet'),
      ).toBeInTheDocument();
    });
  });

  it('lists existing webhook channels', async () => {
    mockedRequest.mockImplementation((path: string) => {
      if (path === '/notifications') {
        return Promise.resolve([
          baseWebhook({ id: 1, name: 'Discord' }),
          baseWebhook({ id: 2, name: 'Slack', enabled: false }),
          // A non-webhook channel must be filtered out by useWebhookChannels.
          {
            id: 99,
            kind: 'discord',
            name: 'Old Discord',
            enabled: true,
            webhook_url: 'https://discord.com/api/webhooks/xxx',
            username: null,
            avatar_url: null,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ]);
      }
      throw new Error(`unexpected path: ${path}`);
    });

    renderSection();

    await waitFor(() => {
      expect(screen.getByTestId('webhook-row-1')).toBeInTheDocument();
      expect(screen.getByTestId('webhook-row-2')).toBeInTheDocument();
    });
    // The non-webhook channel must NOT render.
    expect(screen.queryByText('Old Discord')).not.toBeInTheDocument();
  });
});

describe('WebhookChannelsSection — add modal', () => {
  it('opens the add modal and posts a save', async () => {
    mockedRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/notifications' && (!init || init.method === undefined || init.method === 'GET')) {
        return Promise.resolve([]);
      }
      if (path === '/notifications' && init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        expect(body.kind).toBe('webhook');
        expect(body.name).toBe('Test webhook');
        expect(body.url).toBe('https://example.com/hook');
        expect(body.method).toBe('POST');
        return Promise.resolve(baseWebhook({ id: 7, name: body.name, url: body.url }));
      }
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${path}`);
    });

    renderSection();

    await waitFor(() => {
      expect(screen.getByText('No webhooks yet')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('webhook-add'));

    await waitFor(() => {
      expect(screen.getByTestId('webhook-form-modal')).toBeInTheDocument();
    });

    const modal = screen.getByTestId('webhook-form-modal');
    fireEvent.change(within(modal).getByTestId('webhook-form-name'), {
      target: { value: 'Test webhook' },
    });
    fireEvent.change(within(modal).getByTestId('webhook-form-url'), {
      target: { value: 'https://example.com/hook' },
    });
    fireEvent.click(within(modal).getByTestId('webhook-form-submit'));

    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledWith(
        '/notifications',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('rejects submission when URL does not start with http(s)', async () => {
    mockedRequest.mockImplementation(() => Promise.resolve([]));

    renderSection();

    fireEvent.click(await screen.findByTestId('webhook-add'));
    const modal = await screen.findByTestId('webhook-form-modal');
    fireEvent.change(within(modal).getByTestId('webhook-form-name'), {
      target: { value: 'Bad' },
    });
    fireEvent.change(within(modal).getByTestId('webhook-form-url'), {
      target: { value: 'ftp://example.com' },
    });
    fireEvent.click(within(modal).getByTestId('webhook-form-submit'));

    await waitFor(() => {
      expect(
        within(modal).getByText(/URL must start with http/i),
      ).toBeInTheDocument();
    });
    // No POST should have been issued.
    expect(
      mockedRequest.mock.calls.filter(
        ([path, init]: [string, RequestInit | undefined]) =>
          path === '/notifications' && init?.method === 'POST',
      ),
    ).toHaveLength(0);
  });

  it('requires confirmation before closing a dirty webhook draft', async () => {
    mockedRequest.mockImplementation((path: string) => {
      if (path === '/notifications') return Promise.resolve([]);
      throw new Error(`unexpected path: ${path}`);
    });
    renderSection();
    fireEvent.click(await screen.findByTestId('webhook-add'));
    const modal = await screen.findByTestId('webhook-form-modal');
    fireEvent.change(within(modal).getByTestId('webhook-form-name'), {
      target: { value: 'Unsaved webhook' },
    });

    fireEvent.click(within(modal).getByTestId('webhook-form-cancel'));
    const confirm = await screen.findByRole('dialog', { name: 'Unsaved changes' });
    expect(screen.getByTestId('webhook-form-modal')).toBeInTheDocument();

    fireEvent.click(within(confirm).getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => {
      expect(screen.queryByTestId('webhook-form-modal')).not.toBeInTheDocument();
    });
  });
});

describe('WebhookChannelsSection — test action', () => {
  it('fires a webhook test and renders the structured result', async () => {
    mockedRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/notifications') return Promise.resolve([baseWebhook({ id: 11 })]);
      if (path === '/notifications/11/webhook-test' && init?.method === 'POST') {
        return Promise.resolve({
          success: true,
          status_code: 204,
          latency_ms: 87,
          body_preview: 'ok',
          truncated: false,
          signature: 'sha256=deadbeef',
        });
      }
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${path}`);
    });

    renderSection();

    await waitFor(() => {
      expect(screen.getByTestId('webhook-row-11')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('webhook-test-11'));

    await waitFor(() => {
      expect(screen.getByTestId('webhook-test-result-11')).toBeInTheDocument();
    });
    const result = screen.getByTestId('webhook-test-result-11');
    expect(within(result).getByText('Success')).toBeInTheDocument();
    expect(within(result).getByText(/Status 204/)).toBeInTheDocument();
    expect(within(result).getByText(/87 ms/)).toBeInTheDocument();
    expect(within(result).getByText('sha256=deadbeef')).toBeInTheDocument();
  });

  it('renders the failure path when the test endpoint returns success=false', async () => {
    mockedRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/notifications') return Promise.resolve([baseWebhook({ id: 12 })]);
      if (path === '/notifications/12/webhook-test' && init?.method === 'POST') {
        return Promise.resolve({
          success: false,
          status_code: 500,
          latency_ms: 23,
          error: 'upstream 500',
        });
      }
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${path}`);
    });

    renderSection();
    fireEvent.click(await screen.findByTestId('webhook-test-12'));

    await waitFor(() => {
      const result = screen.getByTestId('webhook-test-result-12');
      expect(within(result).getByText('Failed')).toBeInTheDocument();
      expect(within(result).getByText(/upstream 500/)).toBeInTheDocument();
    });
  });
});

describe('WebhookChannelsSection — delete', () => {
  it('opens confirm and DELETEs on confirm', async () => {
    mockedRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/notifications' && (!init || init.method === undefined)) {
        return Promise.resolve([baseWebhook({ id: 21, name: 'Doomed' })]);
      }
      if (path === '/notifications/21' && init?.method === 'DELETE') {
        return Promise.resolve(undefined);
      }
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${path}`);
    });

    renderSection();

    await waitFor(() => {
      expect(screen.getByTestId('webhook-row-21')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('webhook-delete-21'));

    // The ConfirmDialog renders inside a role="dialog". Scope the
    // confirm-button lookup to that dialog so we don't collide with
    // the row's "Delete webhook" icon button (same accessible name).
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /delete webhook/i }));

    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledWith(
        '/notifications/21',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });
});

describe('WebhookChannelsSection — signature preview', () => {
  it('hits the preview-signature endpoint after the user types a secret', async () => {
    let previewCalls = 0;
    mockedRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/notifications') return Promise.resolve([]);
      if (
        path === '/notifications/webhooks/preview-signature' &&
        init?.method === 'POST'
      ) {
        previewCalls += 1;
        const body = JSON.parse(init.body as string);
        expect(body.secret).toBe('shhhh');
        return Promise.resolve({ signature: 'sha256=cafebabecafebabe' });
      }
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${path}`);
    });

    renderSection();

    fireEvent.click(await screen.findByTestId('webhook-add'));
    const modal = await screen.findByTestId('webhook-form-modal');

    fireEvent.change(within(modal).getByTestId('webhook-form-secret'), {
      target: { value: 'shhhh' },
    });

    // The component debounces the preview by 300ms. Wait for the call
    // and the rendered signature with a generous timeout so a slow
    // CI machine + jsdom microtask scheduling don't flake.
    await waitFor(
      () => {
        expect(previewCalls).toBeGreaterThanOrEqual(1);
        expect(
          within(modal).getByText('sha256=cafebabecafebabe'),
        ).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it('does not call the preview endpoint when secret is empty', async () => {
    mockedRequest.mockImplementation((path: string) => {
      if (path === '/notifications') return Promise.resolve([]);
      throw new Error(`unexpected path: ${path}`);
    });

    renderSection();
    fireEvent.click(await screen.findByTestId('webhook-add'));
    const modal = await screen.findByTestId('webhook-form-modal');

    // The signature preview helper text should be present, with no
    // calls to the preview endpoint.
    expect(
      within(modal).getByText(/Add a signing secret to preview/i),
    ).toBeInTheDocument();
    expect(
      mockedRequest.mock.calls.filter(
        ([path]: [string]) => path === '/notifications/webhooks/preview-signature',
      ),
    ).toHaveLength(0);
  });
});
