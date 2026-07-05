/**
 * BrowserPushChannelCard tests.
 *
 * The card multiplexes five presentation states off two data sources — the
 * browser-capability probe (useWebPush) and the server VAPID key query
 * (usePushPublicKey) — plus a per-device subscription list. Each branch is
 * pinned here:
 *
 *   1. Ready + not subscribed → Enable affordance, "Not subscribed" badge.
 *   2. Ready + subscribed     → Disable affordance, "Active" badge.
 *   3. Key still loading      → loading state, NOT a premature "unsupported"
 *      verdict. This is the regression guard: useWebPush folds the key into
 *      `isPushSupported`, so it reads false while the key is in flight and
 *      the old card wrongly claimed "This browser doesn't support the Push
 *      API." during that window.
 *   4. Key request failed     → error state + Retry, NOT "unsupported".
 *   5. Genuinely unavailable  → the four disabled reasons + "Unavailable".
 *
 * Plus the registered-device list: this-device marker, UA / last-used
 * fallbacks, per-endpoint remove + its in-flight busy state, and null
 * safety when the list query is still resolving.
 *
 * Both hook modules are mocked at module scope (the real useWebPush talks to
 * the PushManager + service worker, which jsdom lacks) and swapped per
 * scenario, mirroring NotificationGroupRow.test.tsx.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '../../../i18n';

import { BrowserPushChannelCard } from './BrowserPushChannelCard';
import type { PushSubscriptionRow } from '@/api/types';

// ── useWebPush: capability probe + subscribe/unsubscribe lifecycle ────────────
const subscribeFn = vi.fn(() => Promise.resolve(true));
const unsubscribeFn = vi.fn(() => Promise.resolve(true));

type WebPushOverrides = Partial<{
  isSupported: boolean;
  isPushSupported: boolean;
  isSubscribed: boolean;
  currentEndpoint: string | null;
  permission: NotificationPermission;
}>;

function makeWebPush(overrides: WebPushOverrides = {}) {
  return {
    isSupported: true,
    isPushSupported: true,
    isSubscribed: false,
    currentEndpoint: null as string | null,
    permission: 'default' as NotificationPermission,
    subscribe: subscribeFn,
    unsubscribe: unsubscribeFn,
    ...overrides,
  };
}

const webPushMock = vi.fn();
vi.mock('@/hooks/useWebPush', () => ({
  useWebPush: () => webPushMock(),
}));

// ── usePush: server-side hooks ────────────────────────────────────────────────
const refetchKey = vi.fn(() => Promise.resolve({}));
const publicKeyMock = vi.fn();
const subsMock = vi.fn();
const unsubMutateAsync = vi.fn(() => Promise.resolve());
const unsubMock = vi.fn();

vi.mock('@/api/hooks/usePush', () => ({
  usePushPublicKey: () => publicKeyMock(),
  usePushSubscriptions: () => subsMock(),
  useUnsubscribePush: () => unsubMock(),
  useSubscribePush: () => ({ mutateAsync: vi.fn(), isPending: false }),
  pushKeys: { publicKey: ['push', 'public-key'], list: ['push', 'subscriptions'] },
}));

function makeRow(
  id: number,
  endpoint: string,
  overrides: Partial<PushSubscriptionRow> = {},
): PushSubscriptionRow {
  return {
    id,
    user_id: 1,
    endpoint,
    p256dh: 'p256dh-key',
    auth: 'auth-key',
    user_agent: 'Chrome on macOS',
    created_at: '2026-01-01T00:00:00Z',
    last_used_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function renderCard() {
  return render(<BrowserPushChannelCard />);
}

describe('BrowserPushChannelCard', () => {
  beforeEach(() => {
    webPushMock.mockReset();
    publicKeyMock.mockReset();
    subsMock.mockReset();
    unsubMock.mockReset();
    subscribeFn.mockReset();
    unsubscribeFn.mockReset();
    unsubMutateAsync.mockReset();
    refetchKey.mockReset();

    subscribeFn.mockResolvedValue(true);
    unsubscribeFn.mockResolvedValue(true);
    unsubMutateAsync.mockResolvedValue(undefined);
    refetchKey.mockResolvedValue({});

    // Default: fully supported, key loaded, not subscribed, no devices.
    webPushMock.mockReturnValue(makeWebPush());
    publicKeyMock.mockReturnValue({
      data: 'VAPID_PUBLIC_KEY',
      isLoading: false,
      isError: false,
      refetch: refetchKey,
    });
    subsMock.mockReturnValue({ data: [] });
    unsubMock.mockReturnValue({
      mutateAsync: unsubMutateAsync,
      isPending: false,
      variables: undefined,
    });
  });

  // ── Ready state ─────────────────────────────────────────────────────────────
  it('renders the channel header, "Not subscribed" badge, Enable button and iOS note', () => {
    renderCard();
    expect(screen.getByRole('heading', { name: /browser push/i })).toBeInTheDocument();
    expect(
      screen.getByText(/get os-level notifications even when teslasync is closed/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Not subscribed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enable on this device/i })).toBeInTheDocument();
    expect(screen.getByText(/ios safari requires version 16\.4/i)).toBeInTheDocument();
    // No Disable in the not-subscribed state.
    expect(screen.queryByRole('button', { name: /disable on this device/i })).toBeNull();
  });

  it('shows a busy state while enabling, calls subscribe once, then clears busy', async () => {
    let resolveSubscribe!: (v: boolean) => void;
    subscribeFn.mockImplementation(
      () => new Promise<boolean>((res) => { resolveSubscribe = res; }),
    );
    renderCard();
    const btn = screen.getByRole('button', { name: /enable on this device/i });
    expect(btn).not.toBeDisabled();

    // fireEvent inside act flushes the synchronous setBusy(true) before the
    // subscribe() promise settles, so we can observe the in-flight state.
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(subscribeFn).toHaveBeenCalledTimes(1);
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toBeDisabled();

    await act(async () => {
      resolveSubscribe(true);
    });
    expect(btn).not.toHaveAttribute('aria-busy');
    expect(btn).not.toBeDisabled();
  });

  // ── Subscribed state ──────────────────────────────────────────────────────────
  it('subscribed: shows the Disable button + "Active" badge and calls unsubscribe on click', async () => {
    webPushMock.mockReturnValue(
      makeWebPush({ isSubscribed: true, currentEndpoint: 'https://push.example/a' }),
    );
    renderCard();
    expect(screen.getByText('Active on this device')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /enable on this device/i })).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /disable on this device/i }));
    });
    expect(unsubscribeFn).toHaveBeenCalledTimes(1);
  });

  // ── Loading state (regression guard for the misreport bug) ────────────────────
  it('while the VAPID key is loading, shows a loading state — not a false "unsupported"', () => {
    // isPushSupported reads false because the key has not arrived yet.
    webPushMock.mockReturnValue(makeWebPush({ isPushSupported: false }));
    publicKeyMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: refetchKey,
    });
    renderCard();

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/checking browser push availability/i)).toBeInTheDocument();
    // Must NOT claim the browser lacks the Push API just because the key
    // has not been fetched yet.
    expect(screen.queryByText(/support the push api/i)).toBeNull();
    expect(screen.queryByText('Unavailable')).toBeNull();
    expect(screen.queryByRole('button', { name: /enable on this device/i })).toBeNull();
  });

  // ── Error state ───────────────────────────────────────────────────────────────
  it('key request error: shows an error + Retry (not "unsupported"); Retry refetches', async () => {
    webPushMock.mockReturnValue(makeWebPush({ isPushSupported: false }));
    publicKeyMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: refetchKey,
    });
    renderCard();

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/check browser push availability/i)).toBeInTheDocument();
    // Errors are retryable, not a hard "unsupported" verdict.
    expect(screen.queryByText(/support the push api/i)).toBeNull();
    expect(screen.queryByText('Unavailable')).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    });
    expect(refetchKey).toHaveBeenCalledTimes(1);
  });

  // ── Unsupported reasons ───────────────────────────────────────────────────────
  it('push API unsupported (key resolved, browser lacks it): shows the reason + "Unavailable"', () => {
    webPushMock.mockReturnValue(makeWebPush({ isPushSupported: false }));
    publicKeyMock.mockReturnValue({
      data: 'VAPID_PUBLIC_KEY',
      isLoading: false,
      isError: false,
      refetch: refetchKey,
    });
    renderCard();
    expect(screen.getByText(/support the push api/i)).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /enable on this device/i })).toBeNull();
  });

  it('server VAPID not configured (publicKey null): shows the admin hint', () => {
    webPushMock.mockReturnValue(makeWebPush({ isPushSupported: false }));
    publicKeyMock.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      refetch: refetchKey,
    });
    renderCard();
    expect(screen.getByText(/not configured on this server/i)).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });

  it('no Notification API: shows the notification reason even while the key is loading', () => {
    // Decisive "no Notification API" must win over the loading state.
    webPushMock.mockReturnValue(
      makeWebPush({ isSupported: false, isPushSupported: false, permission: 'denied' }),
    );
    publicKeyMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: refetchKey,
    });
    renderCard();
    expect(screen.getByText(/support notifications/i)).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/checking browser push availability/i)).toBeNull();
  });

  it('permission denied: shows the blocked-notifications reason', () => {
    webPushMock.mockReturnValue(makeWebPush({ isPushSupported: true, permission: 'denied' }));
    renderCard();
    expect(screen.getByText(/notifications are blocked for this site/i)).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });

  // ── Registered-device list ────────────────────────────────────────────────────
  it('lists registered devices with the this-device marker and per-row fallbacks', () => {
    webPushMock.mockReturnValue(
      makeWebPush({ isSubscribed: true, currentEndpoint: 'https://push.example/a' }),
    );
    subsMock.mockReturnValue({
      data: [
        makeRow(1, 'https://push.example/a', { user_agent: 'Chrome on macOS' }),
        makeRow(2, 'https://push.example/b', { user_agent: null, last_used_at: null }),
      ],
    });
    renderCard();

    expect(screen.getByText('Registered devices')).toBeInTheDocument();
    expect(screen.getByText('Chrome on macOS')).toBeInTheDocument();
    expect(screen.getByText('(this device)')).toBeInTheDocument();
    // user_agent null → fallback label.
    expect(screen.getByText('Unknown browser')).toBeInTheDocument();
    // last_used_at null → "Not yet used".
    expect(screen.getByText('Not yet used')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /remove this device/i })).toHaveLength(2);
  });

  it('clicking a device Remove calls the unsubscribe mutation with that endpoint', async () => {
    webPushMock.mockReturnValue(
      makeWebPush({ isSubscribed: true, currentEndpoint: 'https://push.example/a' }),
    );
    subsMock.mockReturnValue({
      data: [makeRow(1, 'https://push.example/a'), makeRow(2, 'https://push.example/b')],
    });
    renderCard();

    const [removeA] = screen.getAllByRole('button', { name: /remove this device/i });
    await act(async () => {
      fireEvent.click(removeA);
    });
    expect(unsubMutateAsync).toHaveBeenCalledTimes(1);
    expect(unsubMutateAsync).toHaveBeenCalledWith('https://push.example/a');
  });

  it('only the in-flight device Remove button is busy/disabled', () => {
    webPushMock.mockReturnValue(
      makeWebPush({ isSubscribed: true, currentEndpoint: 'https://push.example/a' }),
    );
    subsMock.mockReturnValue({
      data: [makeRow(1, 'https://push.example/a'), makeRow(2, 'https://push.example/b')],
    });
    unsubMock.mockReturnValue({
      mutateAsync: unsubMutateAsync,
      isPending: true,
      variables: 'https://push.example/a',
    });
    renderCard();

    const [removeA, removeB] = screen.getAllByRole('button', { name: /remove this device/i });
    expect(removeA).toBeDisabled();
    expect(removeA).toHaveAttribute('aria-busy', 'true');
    expect(removeB).not.toBeDisabled();
  });

  // ── Null safety around the subscriptions query ────────────────────────────────
  it('renders no device section when there are no registered devices', () => {
    subsMock.mockReturnValue({ data: [] });
    renderCard();
    expect(screen.queryByText('Registered devices')).toBeNull();
  });

  it('tolerates an unresolved subscriptions query (data undefined)', () => {
    subsMock.mockReturnValue({ data: undefined });
    renderCard();
    // Still renders its header; the device section is simply absent.
    expect(screen.getByRole('heading', { name: /browser push/i })).toBeInTheDocument();
    expect(screen.queryByText('Registered devices')).toBeNull();
  });
});
