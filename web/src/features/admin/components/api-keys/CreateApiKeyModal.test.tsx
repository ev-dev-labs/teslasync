/**
 * CreateApiKeyModal contract tests.
 *
 * The dialog is a two-phase key-creation flow:
 *   1. Form phase   — name + permission → POST /api-keys.
 *   2. Reveal phase — one-time masked/copyable display of the generated secret,
 *                     which is reset whenever the dialog closes so a stale
 *                     secret can never leak into the next open.
 *
 * These tests exercise every facet: closed vs open render, the disabled-until-
 * named guard, name trimming + permission selection on submit, the loading
 * state, the reveal + copy affordances, the failure path, the null-safety
 * branch when the API omits `key`, and the reset-on-close guarantee.
 *
 * Network is driven entirely through the mocked `@/api/client` `request`
 * (the same seam APIKeysPage.test / RbacMatrixPage use) so nothing touches the
 * real network. `apiUrl` is preserved from the real module so <MaskedValue>'s
 * fire-and-forget reveal-audit POST has a harmless target (global.fetch is
 * stubbed regardless).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>;
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) =>
              name in o ? String(o[name]) : `{{${name}}}`,
            );
          }
          return fallbackOrOpts;
        }
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>;
          if (typeof o.defaultValue === 'string') return o.defaultValue;
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return {
    ...actual,
    request: vi.fn(),
  };
});

import { request } from '@/api/client';
import { ToastProvider } from '@/components/feedback/Toast';
import { CreateApiKeyModal } from './CreateApiKeyModal';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

const SECRET = 'sk_live_secret_value';
const BULLET = '\u2022';

/** A generated-key POST response shape: an APIKey plus the one-time `key`. */
function createdResponse(key: string | null = SECRET) {
  return {
    id: 'new',
    name: 'CI Bot',
    keyPrefix: 'sk_live_ci',
    permissions: 'read' as const,
    createdAt: '2026-01-01T00:00:00Z',
    lastUsedAt: null,
    expiresAt: null,
    key,
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderModal(props: { open?: boolean; onClose?: () => void } = {}) {
  const onClose = props.onClose ?? vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <CreateApiKeyModal open={props.open ?? true} onClose={onClose} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
}

/** Read the <code> node inside the masked-value primitive. */
function maskedCode(): HTMLElement {
  const el = screen.getByTestId('masked-value').querySelector('code');
  if (!el) throw new Error('masked-value <code> not found');
  return el as HTMLElement;
}

const writeText = vi.fn(() => Promise.resolve());

beforeEach(() => {
  mockedRequest.mockReset();
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  global.fetch = vi.fn(() => Promise.resolve(new Response('{}'))) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CreateApiKeyModal', () => {
  it('renders nothing when closed', () => {
    renderModal({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('New API Key')).not.toBeInTheDocument();
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('renders the create form with all permission options when open', () => {
    renderModal();

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('New API Key')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Name')).toBeInTheDocument();

    const select = within(dialog).getByLabelText('Permissions') as HTMLSelectElement;
    // Default permission is the least-privileged "read".
    expect(select.value).toBe('read');
    const optionLabels = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(optionLabels).toEqual(['Read', 'Read-Write', 'Admin']);
  });

  it('keeps Generate disabled until a non-whitespace name is entered', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    const generate = within(dialog).getByRole('button', { name: 'Generate Key' });
    const nameInput = within(dialog).getByLabelText('Name');

    expect(generate).toBeDisabled();

    // Whitespace-only names do not count as a real name.
    fireEvent.change(nameInput, { target: { value: '   ' } });
    expect(generate).toBeDisabled();

    fireEvent.change(nameInput, { target: { value: 'CI Bot' } });
    expect(generate).toBeEnabled();
  });

  it('POSTs the trimmed name + selected permission then reveals the secret', async () => {
    mockedRequest.mockResolvedValue(createdResponse());
    renderModal();

    const dialog = screen.getByRole('dialog');
    // Surrounding whitespace must be trimmed before it hits the API.
    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: '  CI Bot  ' },
    });
    fireEvent.change(within(dialog).getByLabelText('Permissions'), {
      target: { value: 'admin' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Generate Key' }));

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        '/api-keys',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'CI Bot', permissions: 'admin' }),
        }),
      ),
    );

    // Phase 2: the one-time reveal replaces the form.
    expect(await screen.findByText('API Key Created')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate Key' })).not.toBeInTheDocument();
    expect(
      screen.getByText("Copy this key now — it won't be shown again."),
    ).toBeInTheDocument();
  });

  it('shows a loading state on Generate while the create request is in flight', async () => {
    const d = deferred<ReturnType<typeof createdResponse>>();
    mockedRequest.mockReturnValue(d.promise);
    renderModal();

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'CI Bot' } });
    const generate = within(dialog).getByRole('button', { name: 'Generate Key' });
    fireEvent.click(generate);

    // While pending the button is busy + disabled (guards against double-submit).
    await waitFor(() => expect(generate).toHaveAttribute('aria-busy', 'true'));
    expect(generate).toBeDisabled();
    expect(screen.queryByText('API Key Created')).not.toBeInTheDocument();

    // Flush the request so the reveal phase renders and teardown is clean.
    await act(async () => {
      d.resolve(createdResponse());
      await d.promise;
    });
    expect(await screen.findByText('API Key Created')).toBeInTheDocument();
  });

  it('masks the generated secret by default and reveals it on toggle', async () => {
    mockedRequest.mockResolvedValue(createdResponse());
    renderModal();

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'CI Bot' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Generate Key' }));

    await screen.findByText('API Key Created');

    // Masked form hides the raw secret behind bullets.
    const code = maskedCode();
    expect(code.textContent).not.toBe(SECRET);
    expect(code.textContent).toContain(BULLET);

    fireEvent.click(screen.getByRole('button', { name: 'Reveal value' }));
    expect(maskedCode().textContent).toBe(SECRET);
  });

  it('copies the raw secret to the clipboard from the reveal panel', async () => {
    mockedRequest.mockResolvedValue(createdResponse());
    renderModal();

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'CI Bot' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Generate Key' }));

    await screen.findByText('API Key Created');
    fireEvent.click(screen.getByRole('button', { name: 'Copy API key' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SECRET));
  });

  it('stays on the form when the API response omits the key (null-safety)', async () => {
    // A malformed success (no secret) must NOT flip to a broken empty reveal.
    mockedRequest.mockResolvedValue(createdResponse(null));
    renderModal();

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'CI Bot' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Generate Key' }));

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith('/api-keys', expect.objectContaining({ method: 'POST' })),
    );
    // No reveal transition — the form survives.
    expect(screen.queryByText('API Key Created')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate Key' })).toBeInTheDocument();
  });

  it('keeps the form and re-enables Generate when creation fails', async () => {
    mockedRequest.mockRejectedValue(new Error('network down'));
    renderModal();

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'CI Bot' } });
    const generate = within(dialog).getByRole('button', { name: 'Generate Key' });
    fireEvent.click(generate);

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith('/api-keys', expect.objectContaining({ method: 'POST' })),
    );
    // Failure keeps us on the form and lets the user retry (not stuck busy).
    await waitFor(() => expect(generate).not.toHaveAttribute('aria-busy', 'true'));
    expect(generate).toBeEnabled();
    expect(screen.queryByText('API Key Created')).not.toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    renderModal({ onClose });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('resets its state on close so a stale secret never leaks into the next open', async () => {
    mockedRequest.mockResolvedValue(createdResponse());

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
            <CreateApiKeyModal open={open} onClose={() => setOpen(false)} />
          </ToastProvider>
        </QueryClientProvider>
      );
    }

    render(<Harness />);

    // Create a key and land on the reveal panel.
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'CI Bot' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Key' }));
    await screen.findByText('API Key Created');

    // Done closes the dialog (and resets internal state).
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Reopening shows a FRESH form — no stale secret, empty name.
    fireEvent.click(screen.getByRole('button', { name: 'reopen' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('New API Key')).toBeInTheDocument();
    expect(screen.queryByText('API Key Created')).not.toBeInTheDocument();
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('');
  });
});
