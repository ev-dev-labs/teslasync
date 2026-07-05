/**
 * BrowserTabSignalsPanel tests.
 *
 * The panel owns two boolean preferences (`tab_badge_enabled`,
 * `critical_flash_enabled`) that ride on the shared `/settings` endpoint. It is
 * self-contained: it fetches its own settings, renders its own loading / error /
 * empty states, and writes back the FULL settings object (server does a
 * full-replace upsert) whenever a toggle flips.
 *
 * We mock `@/api/client`'s `request` — keeping the real `ApiError`/`isApiError`
 * — and let the real `useSettings` / `useSaveSettings` hooks flow through it so
 * the assertions pin the exact wire shape (path + method + body) the SPA emits.
 * `react-i18next` is stubbed to echo the inline English fallbacks so the copy is
 * deterministic. Network is never touched.
 *
 * Facets covered:
 *   1. Loading — skeleton, no toggles yet.
 *   2. Happy path — heading, both switches, hint, accessible names.
 *   3. Value mapping — false renders OFF; a MISSING field defaults to ON
 *      (the documented backend-default behaviour).
 *   4. Write path — flipping a switch PUTs the full settings object with only
 *      the one field changed (badge and flash independently).
 *   5. Lost-update guard (the real bug) — a second toggle while a save is still
 *      in flight is ignored, so the first change is never reverted by a stale
 *      full-replace. Surfaces `aria-busy` + a "Saving…" status.
 *   6. Error — QueryError renders and its Retry recovers into the toggles.
 *   7. Empty — a null settings payload degrades to an EmptyState, never a blank
 *      or dead panel.
 *   8. className passthrough.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// ── i18n: echo the inline fallback string, interpolating {{var}} options ──
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
  };
});

// ── request(): the single seam every hook rides. ApiError/isApiError stay real
// so QueryError branches by status exactly as in production. ──
vi.mock('@/api/client', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

import { request, ApiError } from '@/api/client';
import { ToastProvider } from '@/components/feedback/Toast';
import { BrowserTabSignalsPanel } from './BrowserTabSignalsPanel';

const mockedRequest = request as unknown as Mock;

// A representative settings row. Only the two tab fields matter functionally;
// the rest ride along so we can assert the panel echoes the WHOLE object back
// on save (the full-replace-upsert contract).
const BASE = {
  unit_of_length: 'km',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
  language: 'en',
  theme: 'neon-cyan',
  mode: 'dark',
  quiet_hours_enabled: false,
  tab_badge_enabled: true,
  critical_flash_enabled: true,
};

const cloneBase = () => ({ ...BASE });

interface RequestOverrides {
  get?: () => Promise<unknown>;
  put?: (options: RequestInit) => Promise<unknown>;
}

function setupRequest(overrides: RequestOverrides = {}) {
  const getFn = overrides.get ?? (() => Promise.resolve(cloneBase()));
  const putFn =
    overrides.put ??
    ((options: RequestInit) =>
      Promise.resolve(JSON.parse(String(options.body ?? '{}'))));
  mockedRequest.mockImplementation((path: string, options?: RequestInit) => {
    if (path === '/settings') {
      const method = options?.method ?? 'GET';
      if (method === 'GET') return getFn();
      if (method === 'PUT') return putFn(options ?? {});
    }
    return Promise.resolve({});
  });
}

function getCalls() {
  return mockedRequest.mock.calls.filter(
    (c) => c[0] === '/settings' && (c[1]?.method ?? 'GET') === 'GET',
  );
}

function putBodies() {
  return mockedRequest.mock.calls
    .filter((c) => c[0] === '/settings' && c[1]?.method === 'PUT')
    .map((c) => JSON.parse(String(c[1]?.body ?? '{}')));
}

function renderPanel(props?: { className?: string }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ToastProvider>
          <BrowserTabSignalsPanel {...props} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const BADGE_LABEL = 'Show unread count in browser tab';
const FLASH_LABEL = 'Flash tab title on critical alerts';

beforeEach(() => {
  mockedRequest.mockReset();
});

describe('BrowserTabSignalsPanel — loading', () => {
  it('shows a skeleton (no toggles) while settings are in flight', () => {
    setupRequest({ get: () => new Promise<unknown>(() => {}) }); // never resolves
    const { container } = renderPanel();

    // Heading is always present; the body is a skeleton, not the switches.
    expect(screen.getByText('Browser tab signals')).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});

describe('BrowserTabSignalsPanel — happy path', () => {
  it('renders the heading, both switches with accessible names, and the hint', async () => {
    setupRequest();
    renderPanel();

    const badge = await screen.findByRole('switch', { name: BADGE_LABEL });
    const flash = screen.getByRole('switch', { name: FLASH_LABEL });

    expect(badge).toBeInTheDocument();
    expect(flash).toBeInTheDocument();
    // Both default true in BASE → both reflect ON.
    expect(badge).toHaveAttribute('aria-checked', 'true');
    expect(flash).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/favicon dot/i)).toBeInTheDocument();
  });

  it('reflects OFF when the stored fields are false', async () => {
    setupRequest({
      get: () =>
        Promise.resolve({
          ...BASE,
          tab_badge_enabled: false,
          critical_flash_enabled: false,
        }),
    });
    renderPanel();

    const badge = await screen.findByRole('switch', { name: BADGE_LABEL });
    expect(badge).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: FLASH_LABEL })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('defaults BOTH switches to ON when the fields are missing entirely', async () => {
    // Simulate a legacy row without the seeded tab-signal columns.
    const legacy: Record<string, unknown> = { ...BASE };
    delete legacy.tab_badge_enabled;
    delete legacy.critical_flash_enabled;
    setupRequest({ get: () => Promise.resolve(legacy) });
    renderPanel();

    const badge = await screen.findByRole('switch', { name: BADGE_LABEL });
    expect(badge).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: FLASH_LABEL })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

describe('BrowserTabSignalsPanel — write path', () => {
  it('PUTs the FULL settings object with only tab_badge_enabled flipped', async () => {
    setupRequest();
    renderPanel();

    const badge = await screen.findByRole('switch', { name: BADGE_LABEL });
    fireEvent.click(badge);

    await waitFor(() => expect(putBodies()).toHaveLength(1));
    expect(putBodies()[0]).toEqual({ ...BASE, tab_badge_enabled: false });
    // The unrelated flash field must be preserved verbatim.
    expect(putBodies()[0].critical_flash_enabled).toBe(true);
  });

  it('PUTs the FULL settings object with only critical_flash_enabled flipped', async () => {
    setupRequest();
    renderPanel();

    const flash = await screen.findByRole('switch', { name: FLASH_LABEL });
    fireEvent.click(flash);

    await waitFor(() => expect(putBodies()).toHaveLength(1));
    expect(putBodies()[0]).toEqual({ ...BASE, critical_flash_enabled: false });
    expect(putBodies()[0].tab_badge_enabled).toBe(true);
  });
});

describe('BrowserTabSignalsPanel — lost-update guard (bug fix)', () => {
  it('ignores a second toggle while the first save is still in flight', async () => {
    // The PUT never resolves, so the mutation stays pending and the panel
    // stays in its "saving" window for the whole test.
    setupRequest({ put: () => new Promise<unknown>(() => {}) });
    renderPanel();

    const badge = await screen.findByRole('switch', { name: BADGE_LABEL });
    fireEvent.click(badge); // fires PUT #1 with tab_badge_enabled: false

    // Wait until the pending state has flushed to the DOM.
    await screen.findByText(/saving/i);
    expect(badge.closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true');

    // A second toggle now must be a no-op — otherwise it would rebuild the
    // body from the stale (badge:true) cache and REVERT the first change.
    fireEvent.click(screen.getByRole('switch', { name: FLASH_LABEL }));

    // Exactly one write, and it carries the intended (badge:false) change.
    expect(putBodies()).toHaveLength(1);
    expect(putBodies()[0]).toEqual({ ...BASE, tab_badge_enabled: false });
  });
});

describe('BrowserTabSignalsPanel — error + recovery', () => {
  it('renders QueryError on failure and recovers into the toggles on Retry', async () => {
    let call = 0;
    setupRequest({
      get: () => {
        call += 1;
        return call === 1
          ? Promise.reject(new ApiError('boom', 500))
          : Promise.resolve(cloneBase());
      },
    });
    renderPanel();

    // 5xx branch of QueryError.
    expect(await screen.findByText(/server error/i)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    // Refetch succeeds → the switches take over.
    expect(
      await screen.findByRole('switch', { name: BADGE_LABEL }),
    ).toBeInTheDocument();
    expect(getCalls().length).toBeGreaterThanOrEqual(2);
  });
});

describe('BrowserTabSignalsPanel — empty state', () => {
  it('shows an EmptyState (not a dead panel) when settings resolve to null', async () => {
    setupRequest({ get: () => Promise.resolve(null) });
    renderPanel();

    expect(
      await screen.findByText(/unavailable right now/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});

describe('BrowserTabSignalsPanel — props', () => {
  it('forwards className to the root panel', async () => {
    setupRequest();
    const { container } = renderPanel({ className: 'test-passthrough-class' });

    await screen.findByRole('switch', { name: BADGE_LABEL });
    expect(container.querySelector('.test-passthrough-class')).not.toBeNull();
  });
});
