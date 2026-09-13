/**
 * ShareSessionDialog contract tests.
 *
 * Mirrors ShareDriveDialog.test.tsx for charging sessions: the dialog POSTs
 * /charging/{id}/share (telemetry toggle = charge curve + cost, no
 * speed/map toggles), flips to a one-time link-result view, and manages the
 * existing-links list from GET /charging/{id}/shares with per-share copy +
 * revoke (DELETE /shares/{tok}).
 *
 * Network is driven entirely through the mocked `@/api/client` `request`
 * routed by path + method. react-i18next is stubbed so t(key, fallback,
 * vars) resolves to the fallback with {{var}} interpolation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: Record<string, unknown>) => {
        let fallback = key;
        let vars: Record<string, unknown> | undefined;
        if (typeof fallbackOrOpts === 'string') {
          fallback = fallbackOrOpts;
          vars = opts;
        } else if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>;
          if (typeof o.defaultValue === 'string') fallback = o.defaultValue;
          vars = o;
        }
        if (vars) {
          return Object.entries(vars).reduce<string>(
            (acc, [k, v]) => acc.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v)),
            fallback,
          );
        }
        return fallback;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

import { request } from '@/api/client';
import { ToastProvider } from '@/components/feedback/Toast';
import { ShareSessionDialog } from './ShareSessionDialog';
import type { ShareToken, CreateShareResponse } from '@/types/sharing';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

const SESSION_ID = '9';
const ORIGIN = window.location.origin;
const LIST_PATH = `/charging/${SESSION_ID}/shares`;
const CREATE_PATH = `/charging/${SESSION_ID}/share`;

function makeCreateResponse(over: Partial<CreateShareResponse> = {}): CreateShareResponse {
  return { token: 'tok_abc', url: `${ORIGIN}/s/tok_abc`, id: 1, ...over };
}

function makeShare(over: Partial<ShareToken> = {}): ShareToken {
  return {
    id: 1,
    token: 'tok_1',
    charging_session_id: 9,
    created_by: 'user@example.com',
    title: 'Baker stop',
    description: null,
    include_map: false,
    include_telemetry: false,
    include_speed: false,
    views: 3,
    expires_at: '2999-01-01T00:00:00Z',
    created_at: '2020-01-01T00:00:00Z',
    ...over,
  };
}

type Handlers = {
  listShares?: () => Promise<unknown>;
  createShare?: (body: Record<string, unknown>) => Promise<unknown>;
  revokeShare?: (token: string) => Promise<unknown>;
};

/** Route the single `request` mock by path + method to the two endpoints. */
function routeRequest(handlers: Handlers = {}) {
  mockedRequest.mockImplementation((path: string, opts?: RequestInit) => {
    const method = (opts?.method ?? 'GET').toUpperCase();
    if (method === 'GET' && path === LIST_PATH) {
      return handlers.listShares ? handlers.listShares() : Promise.resolve([]);
    }
    if (method === 'POST' && path === CREATE_PATH) {
      const body = opts?.body ? (JSON.parse(String(opts.body)) as Record<string, unknown>) : {};
      return handlers.createShare ? handlers.createShare(body) : Promise.resolve(makeCreateResponse());
    }
    if (method === 'DELETE' && path.startsWith('/shares/')) {
      const token = path.replace('/shares/', '');
      return handlers.revokeShare ? handlers.revokeShare(token) : Promise.resolve({ status: 'revoked' });
    }
    return Promise.reject(new Error(`unhandled request: ${method} ${path}`));
  });
}

function renderDialog(props: { open?: boolean; onClose?: () => void } = {}) {
  const onClose = props.onClose ?? vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ShareSessionDialog sessionId={SESSION_ID} open={props.open ?? true} onClose={onClose} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...utils, onClose, client };
}

/** The parsed POST body of the last create call. */
function lastCreateBody(): Record<string, unknown> {
  const call = mockedRequest.mock.calls.find(
    (c) => c[0] === CREATE_PATH && (c[1] as RequestInit | undefined)?.method === 'POST',
  );
  if (!call) throw new Error('create POST was never issued');
  return JSON.parse(String((call[1] as RequestInit).body));
}

beforeEach(() => {
  mockedRequest.mockReset();
  routeRequest();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ShareSessionDialog — create mode', () => {
  it('renders nothing when closed', async () => {
    const { onClose } = renderDialog({ open: false });
    // The hooks still run, so the list GET fires; flush it to stay in act().
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith(LIST_PATH, expect.anything()));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Generate Link')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders one curve toggle and no speed toggle', async () => {
    renderDialog();

    const dialog = await screen.findByRole('dialog', { name: 'Share Charging Session' });
    const telemetry = within(dialog).getByRole('switch', { name: 'Include charge curve and cost' });
    expect(telemetry).toHaveAttribute('aria-checked', 'false');
    expect(within(dialog).queryByRole('switch', { name: /speed/i })).not.toBeInTheDocument();
  });

  it('POSTs the default payload (telemetry off, 30-day expiry, no title)', async () => {
    renderDialog();
    await screen.findByText('No active share links yet.');

    fireEvent.click(screen.getByRole('button', { name: /Generate Link/i }));

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith(CREATE_PATH, expect.anything()));
    expect(lastCreateBody()).toEqual({
      include_telemetry: false,
      expires_in_days: 30,
    });
  });

  it('POSTs the trimmed title + toggled curve + chosen expiry', async () => {
    renderDialog();
    await screen.findByText('No active share links yet.');

    fireEvent.change(screen.getByLabelText('Share title'), { target: { value: '  Baker stop  ' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Include charge curve and cost' }));
    fireEvent.change(screen.getByLabelText('Link expires after'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate Link/i }));

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith(CREATE_PATH, expect.anything()));
    expect(lastCreateBody()).toEqual({
      title: 'Baker stop',
      include_telemetry: true,
      expires_in_days: 7,
    });
  });

  it('reveals the share URL on success and can return to the form', async () => {
    routeRequest({ createShare: () => Promise.resolve(makeCreateResponse({ token: 'tok_new' })) });
    renderDialog();
    await screen.findByText('No active share links yet.');

    fireEvent.click(screen.getByRole('button', { name: /Generate Link/i }));

    expect(await screen.findByDisplayValue(`${ORIGIN}/s/tok_new`)).toBeInTheDocument();
    expect(screen.getByText('Share link created!')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create another link' }));
    expect(screen.getByRole('button', { name: /Generate Link/i })).toBeInTheDocument();
    expect(screen.queryByText('Share link created!')).not.toBeInTheDocument();
  });

  it('keeps the form usable when creation fails (no unhandled rejection)', async () => {
    routeRequest({ createShare: () => Promise.reject(new Error('network down')) });
    renderDialog();
    await screen.findByText('No active share links yet.');

    const generate = screen.getByRole('button', { name: /Generate Link/i });
    fireEvent.click(generate);

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith(CREATE_PATH, expect.anything()));
    await waitFor(() => expect(generate).not.toHaveAttribute('aria-busy', 'true'));
    expect(generate).toBeEnabled();
    expect(screen.queryByText('Share link created!')).not.toBeInTheDocument();
  });
});

describe('ShareSessionDialog — existing shares list', () => {
  it('renders an active share with views, expiry and revoke controls', async () => {
    routeRequest({ listShares: () => Promise.resolve([makeShare({ title: 'Baker stop', views: 3 })]) });
    renderDialog();

    const title = await screen.findByText('Baker stop');
    const info = title.closest('div') as HTMLElement;
    expect(info).toHaveTextContent('3 views');
    expect(info).toHaveTextContent(/Expires/);

    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
  });

  it('labels an out-of-date share as Expired', async () => {
    routeRequest({
      listShares: () => Promise.resolve([makeShare({ expires_at: '2000-01-01T00:00:00Z' })]),
    });
    renderDialog();

    expect(await screen.findByText('Expired')).toBeInTheDocument();
    expect(screen.queryByText(/^Expires/)).not.toBeInTheDocument();
  });

  it('issues a DELETE to /shares/{token} when a share is revoked', async () => {
    routeRequest({
      listShares: () => Promise.resolve([makeShare({ token: 'tok_kill', title: 'Kill me' })]),
    });
    renderDialog();

    await screen.findByText('Kill me');
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        '/shares/tok_kill',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });
});
