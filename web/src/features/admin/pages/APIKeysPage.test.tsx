/**
 * APIKeysPage contract tests.
 *
 * The page fans a single `useApiKeys()` query out into three data surfaces
 * (KPI band, key inventory, access-levels panel) plus create / revoke / delete
 * mutations. These tests exercise every branch and interaction:
 *
 *   1. Loaded — KPI counts, key cards, count caption, access-levels + guidance.
 *   2. Empty  — EmptyStates render and the KPI band shows a truthful `0`.
 *   3. Error  — BOTH data panels surface <QueryError> AND the KPI band shows
 *               the `'—'` placeholder rather than a fabricated `0` (regression
 *               guard for the KPI error-state fix).
 *   4. Loading — skeletons render while the query is pending.
 *   5. Create  — the dialog opens, cancels, and on submit POSTs the trimmed
 *                name + permission then reveals the one-time secret.
 *   6. Revoke  — an active key POSTs `/api-keys/:id/revoke`.
 *   7. Delete  — a key opens a confirm dialog naming it, then DELETEs on confirm
 *                and closes the dialog.
 *
 * Network is driven entirely through the mocked `@/api/client` `request`
 * (the same seam RbacMatrixPage / FleetTelemetryCoveragePage use) so nothing
 * touches the real network. `isApiError` is preserved from the real module so
 * <QueryError> falls to its generic network branch for a plain Error.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const operationalMode = vi.hoisted(() => ({
  canWrite: true,
  writeBlockReason: null as string | null,
}));

vi.mock('@/hooks/useOperationalMode', () => ({
  useOperationalMode: () => operationalMode,
}));

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
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
import APIKeysPage from './APIKeysPage';
import type { APIKey } from '@/types/admin';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

function makeKey(overrides: Partial<APIKey> = {}): APIKey {
  return {
    id: 'k1',
    name: 'Falcon',
    keyPrefix: 'sk_live_falcon',
    permissions: 'read',
    createdAt: '2026-01-01T00:00:00Z',
    lastUsedAt: '2026-06-01T00:00:00Z',
    expiresAt: null,
    ...overrides,
  };
}

/** Three keys spanning every summary axis: 3 total / 2 active / 1 expired / 1 admin. */
function threeKeys(): APIKey[] {
  return [
    makeKey({ id: 'k1', name: 'Falcon', permissions: 'read' }),
    makeKey({ id: 'k2', name: 'Nova', permissions: 'admin' }),
    makeKey({
      id: 'k3',
      name: 'Roadster',
      permissions: 'read-write',
      expiresAt: '2020-01-01T00:00:00Z', // in the past → expired
    }),
  ];
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

/** Route the single `request` mock by path + method so mutations + refetch work. */
function installRequest(
  keys: APIKey[],
  created: (APIKey & { key: string }) | null = null,
) {
  mockedRequest.mockImplementation((path: string, opts?: { method?: string }) => {
    const method = opts?.method ?? 'GET';
    if (path === '/api-keys' && method === 'GET') return Promise.resolve(keys);
    if (path === '/api-keys' && method === 'POST') {
      return Promise.resolve(
        created ?? { ...makeKey({ id: 'new', name: 'CI Bot' }), key: 'sk_live_secret_value' },
      );
    }
    if (method === 'POST' && /^\/api-keys\/[^/]+\/revoke$/.test(path)) {
      return Promise.resolve(undefined);
    }
    if (method === 'DELETE' && /^\/api-keys\/[^/]+$/.test(path)) {
      return Promise.resolve(undefined);
    }
    return Promise.reject(new Error(`unexpected request ${method} ${path}`));
  });
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <APIKeysPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The MetricCard root text ("<label><value>") for a given KPI label. */
function kpiCardText(label: string): string {
  return screen.getByText(label).closest('div')?.textContent ?? '';
}

beforeEach(() => {
  mockedRequest.mockReset();
  operationalMode.canWrite = true;
  operationalMode.writeBlockReason = null;
});

describe('APIKeysPage', () => {
  it('renders KPI counts, key inventory, and access levels when keys load', async () => {
    installRequest(threeKeys());
    renderPage();

    // Key inventory populates once the query resolves.
    expect(await screen.findByText('Falcon')).toBeInTheDocument();
    expect(screen.getByText('Nova')).toBeInTheDocument();
    expect(screen.getByText('Roadster')).toBeInTheDocument();

    // KPI band reflects the single-pass summary.
    expect(kpiCardText('Total Keys')).toContain('3');
    expect(kpiCardText('Active')).toContain('2');
    expect(kpiCardText('Admin Access')).toContain('1');

    // Header count caption + supporting panels.
    expect(screen.getByText('3 total')).toBeInTheDocument();
    expect(screen.getByText('Access Levels')).toBeInTheDocument();
    expect(screen.getByText('About API Keys')).toBeInTheDocument();

    // The expired key surfaces both a KPI "Expired" label AND an inline badge.
    expect(screen.getAllByText('Expired').length).toBeGreaterThanOrEqual(2);
  });

  it('renders the read-only explanation outside the disabled create action', async () => {
    operationalMode.canWrite = false;
    operationalMode.writeBlockReason =
      'Reconnect before making operational changes.';
    installRequest([]);
    renderPage();

    await screen.findByText('No API keys');
    const createButton = screen.getByRole('button', { name: 'Create Key' });
    const noticeTitle = screen.getByText('API key management is read-only');

    expect(createButton).toBeDisabled();
    expect(createButton).toHaveAttribute(
      'title',
      'Reconnect before making operational changes.',
    );
    expect(noticeTitle.closest('button')).toBeNull();
    expect(
      screen.getByText('Reconnect before making operational changes.'),
    ).toBeInTheDocument();
  });

  it('shows empty states and a truthful zero KPI when there are no keys', async () => {
    installRequest([]);
    renderPage();

    expect(await screen.findByText('No API keys')).toBeInTheDocument();
    expect(
      screen.getByText('Permission usage appears once you create a key.'),
    ).toBeInTheDocument();

    // Empty is real data — the KPI legitimately reads 0 (not the em-dash).
    expect(kpiCardText('Total Keys')).toContain('0');
    expect(screen.queryByText('Falcon')).not.toBeInTheDocument();
  });

  it('surfaces errors in both panels and em-dash KPIs instead of fabricated zeros', async () => {
    mockedRequest.mockRejectedValue(new Error('network down'));
    renderPage();

    // Both the hero inventory and the access-levels panel render <QueryError>.
    await waitFor(() =>
      expect(screen.getAllByRole('alert').length).toBe(2),
    );
    expect(screen.getAllByText("Can't reach server").length).toBe(2);

    // Regression guard: the KPI band must not lie with "0" on a failed load.
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(kpiCardText('Total Keys')).toContain('—');
    expect(kpiCardText('Total Keys')).not.toContain('0');
  });

  it('renders skeletons while the query is pending', async () => {
    const d = deferred<APIKey[]>();
    mockedRequest.mockReturnValue(d.promise);

    const { container } = renderPage();

    // Loading branch: skeletons render, real KPI values do not yet.
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryByText('Total Keys')).not.toBeInTheDocument();
    expect(screen.queryByText('No API keys')).not.toBeInTheDocument();

    // Flush the query so React Query teardown is clean.
    d.resolve([]);
    expect(await screen.findByText('No API keys')).toBeInTheDocument();
  });

  it('opens the Create Key dialog and closes it on Cancel', async () => {
    installRequest([]);
    renderPage();

    await screen.findByText('No API keys');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create Key' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('New API Key')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('creates a key: POSTs the trimmed name + permission then reveals the secret', async () => {
    installRequest([], { ...makeKey({ id: 'new', name: 'CI Bot' }), key: 'sk_live_secret_value' });
    renderPage();

    await screen.findByText('No API keys');
    fireEvent.click(screen.getByRole('button', { name: 'Create Key' }));

    const dialog = await screen.findByRole('dialog');
    // Whitespace around the name must be trimmed before it hits the API.
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
          requiresLiveMode: true,
          body: JSON.stringify({ name: 'CI Bot', permissions: 'admin' }),
        }),
      ),
    );

    // Phase 2 of the dialog: the one-time secret reveal replaces the form.
    expect(await screen.findByText('API Key Created')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate Key' })).not.toBeInTheDocument();
  });

  it('revokes an active key via POST /api-keys/:id/revoke', async () => {
    installRequest(threeKeys());
    renderPage();

    await screen.findByText('Falcon');
    fireEvent.click(screen.getByRole('button', { name: 'Revoke key Falcon' }));

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith('/api-keys/k1/revoke', {
        method: 'POST',
        requiresLiveMode: true,
      }),
    );
  });

  it('deletes a key after a naming confirmation via DELETE /api-keys/:id', async () => {
    installRequest(threeKeys());
    renderPage();

    await screen.findByText('Nova');
    fireEvent.click(screen.getByRole('button', { name: 'Delete key Nova' }));

    // Confirmation names the exact key being destroyed.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Nova/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith('/api-keys/k2', {
        method: 'DELETE',
        requiresLiveMode: true,
      }),
    );
    // The dialog closes on success (deleteTarget cleared in onSuccess).
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });
});
