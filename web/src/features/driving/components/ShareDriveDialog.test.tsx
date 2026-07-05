/**
 * ShareDriveDialog contract tests.
 *
 * The dialog is a two-mode share manager for a single drive:
 *   1. Create mode — title + speed/telemetry toggles + expiry select → POST
 *      /drives/{id}/share, then flips to a one-time link-result view.
 *   2. Result mode — shows the generated public URL with copy / open / "create
 *      another" affordances.
 * Below both, an always-rendered "Active Share Links" section reads GET
 * /drives/{id}/shares and exposes per-share copy + revoke (DELETE /shares/{tok}).
 *
 * These tests exercise every facet: closed vs open render, the exact POST
 * payload (defaults, custom values, whitespace-trimmed title, the "Never"
 * branch that omits expires_in_days), the success → result transition and its
 * reset, the null-safety branch when the API omits `token`, the failure path
 * (no unhandled rejection, form survives), the pending/loading affordance, and
 * the four states of the existing-shares list (loading, error, empty, list)
 * including expired / no-expiry / untitled rendering and revoke.
 *
 * Network is driven entirely through the mocked `@/api/client` `request`
 * (the same seam CreateApiKeyModal.test / FeedbackModal.test use) routed by
 * path + method, so nothing touches the real network. react-i18next is stubbed
 * so t(key, fallback, vars) resolves to the fallback with {{var}} interpolation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

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
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import { request } from '@/api/client';
import { ToastProvider } from '@/components/feedback/Toast';
import { ShareDriveDialog } from './ShareDriveDialog';
import type { ShareToken, CreateShareResponse } from '@/types/sharing';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

const DRIVE_ID = 'drive-42';
const ORIGIN = window.location.origin;
const LIST_PATH = `/drives/${DRIVE_ID}/shares`;
const CREATE_PATH = `/drives/${DRIVE_ID}/share`;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeCreateResponse(over: Partial<CreateShareResponse> = {}): CreateShareResponse {
  return { token: 'tok_abc', url: `${ORIGIN}/s/tok_abc`, id: 1, ...over };
}

function makeShare(over: Partial<ShareToken> = {}): ShareToken {
  return {
    id: 1,
    token: 'tok_1',
    drive_id: 42,
    created_by: 'user@example.com',
    title: 'Sunday drive',
    description: null,
    include_map: true,
    include_telemetry: false,
    include_speed: true,
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
        <ShareDriveDialog driveId={DRIVE_ID} open={props.open ?? true} onClose={onClose} />
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

describe('ShareDriveDialog — create mode', () => {
  it('renders nothing when closed', async () => {
    const { onClose } = renderDialog({ open: false });
    // The hooks still run, so the list GET fires; flush it to stay in act().
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith(LIST_PATH, expect.anything()));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Generate Link')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders the create form with toggles, expiry options and a generate button', async () => {
    renderDialog();

    const dialog = await screen.findByRole('dialog', { name: 'Share Drive' });
    expect(within(dialog).getByText(/Generate a public link/i)).toBeInTheDocument();

    // Two switches, defaulting to speed-on / telemetry-off.
    const speed = within(dialog).getByRole('switch', { name: 'Include speed data' });
    const telemetry = within(dialog).getByRole('switch', {
      name: 'Include detailed telemetry (battery, power)',
    });
    expect(speed).toHaveAttribute('aria-checked', 'true');
    expect(telemetry).toHaveAttribute('aria-checked', 'false');

    // Expiry select defaults to 30 days and offers all four windows.
    const select = within(dialog).getByLabelText('Link expires after') as HTMLSelectElement;
    expect(select.value).toBe('30');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      '7 days',
      '30 days',
      '90 days',
      'Never',
    ]);

    expect(within(dialog).getByRole('button', { name: /Generate Link/i })).toBeInTheDocument();
  });

  it('POSTs the default payload (speed on, telemetry off, 30-day expiry, no title)', async () => {
    renderDialog();
    await screen.findByText('No active share links yet.');

    fireEvent.click(screen.getByRole('button', { name: /Generate Link/i }));

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith(CREATE_PATH, expect.anything()));
    expect(lastCreateBody()).toEqual({
      include_speed: true,
      include_telemetry: false,
      expires_in_days: 30,
    });
  });

  it('POSTs the trimmed title + toggled telemetry + chosen expiry', async () => {
    renderDialog();
    await screen.findByText('No active share links yet.');

    fireEvent.change(screen.getByLabelText('Share title'), { target: { value: '  SF to LA  ' } });
    fireEvent.click(
      screen.getByRole('switch', { name: 'Include detailed telemetry (battery, power)' }),
    );
    fireEvent.change(screen.getByLabelText('Link expires after'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate Link/i }));

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith(CREATE_PATH, expect.anything()));
    expect(lastCreateBody()).toEqual({
      title: 'SF to LA',
      include_speed: true,
      include_telemetry: true,
      expires_in_days: 7,
    });
  });

  it('omits expires_in_days when "Never" is chosen and drops a whitespace-only title', async () => {
    renderDialog();
    await screen.findByText('No active share links yet.');

    fireEvent.change(screen.getByLabelText('Share title'), { target: { value: '   ' } });
    fireEvent.change(screen.getByLabelText('Link expires after'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate Link/i }));

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith(CREATE_PATH, expect.anything()));
    const body = lastCreateBody();
    expect('expires_in_days' in body).toBe(false);
    expect('title' in body).toBe(false);
    expect(body).toEqual({ include_speed: true, include_telemetry: false });
  });

  it('reveals the share URL on success and can return to the form', async () => {
    routeRequest({ createShare: () => Promise.resolve(makeCreateResponse({ token: 'tok_new' })) });
    renderDialog();
    await screen.findByText('No active share links yet.');

    fireEvent.click(screen.getByRole('button', { name: /Generate Link/i }));

    // Result view: the public URL + copy/open affordances.
    expect(await screen.findByDisplayValue(`${ORIGIN}/s/tok_new`)).toBeInTheDocument();
    expect(screen.getByText('Share link created!')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Link' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open link in a new tab' })).toBeInTheDocument();

    // "Create another link" flips back to the form.
    fireEvent.click(screen.getByRole('button', { name: 'Create another link' }));
    expect(screen.getByRole('button', { name: /Generate Link/i })).toBeInTheDocument();
    expect(screen.queryByText('Share link created!')).not.toBeInTheDocument();
  });

  it('stays on the form when the response omits a token (null-safety)', async () => {
    // A malformed success (no token) must not build a broken "/s/undefined" link.
    routeRequest({ createShare: () => Promise.resolve({ id: 9, url: 'x' }) });
    renderDialog();
    await screen.findByText('No active share links yet.');

    fireEvent.click(screen.getByRole('button', { name: /Generate Link/i }));

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith(CREATE_PATH, expect.anything()));
    expect(screen.queryByText('Share link created!')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generate Link/i })).toBeInTheDocument();
  });

  it('keeps the form usable when creation fails (no unhandled rejection)', async () => {
    routeRequest({ createShare: () => Promise.reject(new Error('network down')) });
    renderDialog();
    await screen.findByText('No active share links yet.');

    const generate = screen.getByRole('button', { name: /Generate Link/i });
    fireEvent.click(generate);

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith(CREATE_PATH, expect.anything()));
    // Failure keeps us on the form and re-enables the button for a retry.
    await waitFor(() => expect(generate).not.toHaveAttribute('aria-busy', 'true'));
    expect(generate).toBeEnabled();
    expect(screen.queryByText('Share link created!')).not.toBeInTheDocument();
  });

  it('shows a busy/disabled generate button while the create is in flight', async () => {
    const d = deferred<CreateShareResponse>();
    routeRequest({ createShare: () => d.promise });
    renderDialog();
    await screen.findByText('No active share links yet.');

    const generate = screen.getByRole('button', { name: /Generate Link/i });
    fireEvent.click(generate);

    await waitFor(() => expect(generate).toHaveAttribute('aria-busy', 'true'));
    expect(generate).toBeDisabled();

    await act(async () => {
      d.resolve(makeCreateResponse({ token: 'tok_done' }));
      await d.promise;
    });
    expect(await screen.findByDisplayValue(`${ORIGIN}/s/tok_done`)).toBeInTheDocument();
  });

  it('resets to a fresh form when reopened after a share was created', async () => {
    routeRequest({ createShare: () => Promise.resolve(makeCreateResponse({ token: 'tok_reset' })) });

    function Harness() {
      const [open, setOpen] = useState(true);
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      return (
        <QueryClientProvider client={client}>
          <ToastProvider>
            <button type="button" onClick={() => setOpen(true)}>
              reopen
            </button>
            <ShareDriveDialog driveId={DRIVE_ID} open={open} onClose={() => setOpen(false)} />
          </ToastProvider>
        </QueryClientProvider>
      );
    }

    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: /Generate Link/i }));
    await screen.findByDisplayValue(`${ORIGIN}/s/tok_reset`);

    // Close via the modal's X, then reopen — the result view must be gone.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'reopen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Share Drive' });
    expect(within(dialog).getByRole('button', { name: /Generate Link/i })).toBeInTheDocument();
    expect(screen.queryByText('Share link created!')).not.toBeInTheDocument();
  });

  it('calls onClose when the modal close button is pressed', async () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    await screen.findByText('No active share links yet.');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ShareDriveDialog — existing shares list', () => {
  it('shows a loading spinner while the list is fetching', async () => {
    const d = deferred<ShareToken[]>();
    routeRequest({ listShares: () => d.promise });
    renderDialog();

    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument();

    await act(async () => {
      d.resolve([]);
      await d.promise;
    });
    expect(await screen.findByText('No active share links yet.')).toBeInTheDocument();
  });

  it('shows an alert when the list request fails', async () => {
    routeRequest({ listShares: () => Promise.reject(new Error('boom')) });
    renderDialog();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load your existing share links. Please try again.');
  });

  it('shows an empty state when there are no shares', async () => {
    routeRequest({ listShares: () => Promise.resolve([]) });
    renderDialog();

    expect(await screen.findByText('No active share links yet.')).toBeInTheDocument();
  });

  it('renders an active share with its views, expiry, copy and revoke controls', async () => {
    routeRequest({ listShares: () => Promise.resolve([makeShare({ title: 'Sunday drive', views: 3 })]) });
    renderDialog();

    const title = await screen.findByText('Sunday drive');
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

  it('handles a null-title, no-expiry, zero-view share safely', async () => {
    routeRequest({
      listShares: () =>
        Promise.resolve([makeShare({ title: null, expires_at: null, views: 0 })]),
    });
    renderDialog();

    const title = await screen.findByText('Untitled share');
    expect(screen.getByText('No expiry')).toBeInTheDocument();
    expect((title.closest('div') as HTMLElement)).toHaveTextContent('0 views');
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
