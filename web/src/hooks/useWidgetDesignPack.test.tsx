import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { useWidgetDesignPack } from './useWidgetDesignPack';

const auth = vi.hoisted(() => ({
  refetch: vi.fn(),
  mode: vi.fn(),
  listener: null as null | ((message: { type: string }) => void),
  available: new Set(['classic']),
}));

vi.mock('@/features/dashboard/widgets/designPacks/manifest', () => ({
  resolveAvailablePackId: (id: unknown) =>
    typeof id === 'string' && auth.available.has(id) ? id : 'classic',
}));
vi.mock('@/api/hooks/useUser', () => ({
  useCurrentUser: () => ({ refetch: auth.refetch }),
}));
vi.mock('@/api/hooks/useAuthMode', () => ({
  useAuthMode: () => ({ refetch: auth.mode }),
}));
vi.mock('@/lib/broadcast', () => ({
  subscribe: (listener: (message: { type: string }) => void) => {
    auth.listener = listener;
    return () => { auth.listener = null; };
  },
}));

function identity(userId: string) {
  auth.refetch.mockResolvedValue({ isSuccess: true, data: { userId, email: 'not-a-storage-key@example.test' } });
}

async function mounted() {
  const hook = renderHook(() => useWidgetDesignPack());
  await waitFor(() => expect(hook.result.current.isReady).toBe(true));
  return hook;
}

function savedKey(): string {
  const key = Object.keys(window.localStorage).find(item => item.startsWith('teslasync.widget-design-pack.v1.'));
  if (!key) throw new Error('Preference not saved');
  return key;
}

describe('browser-profile widget pack preference', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal('crypto', webcrypto);
    identity('account-a');
    auth.mode.mockResolvedValue({ isSuccess: true, data: { mode: 'forward_auth' } });
    auth.available = new Set(['classic']);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not expose a selection before authenticated identity is verified', async () => {
    let finish!: (value: unknown) => void;
    auth.refetch.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const hook = renderHook(() => useWidgetDesignPack());
    expect(hook.result.current.isReady).toBe(false);
    act(() => expect(hook.result.current.setPackId('classic')).toBe(false));
    await act(async () => finish({ isSuccess: false }));
    await waitFor(() => expect(hook.result.current.error).toMatch(/identity/));
    expect(window.localStorage.length).toBe(0);
  });

  it('supports server-confirmed open deployments without requesting a nonexistent account', async () => {
    auth.mode.mockResolvedValue({ isSuccess: true, data: { mode: 'open' } });
    auth.refetch.mockClear();
    auth.available.add('v4');
    const hook = await mounted();
    act(() => expect(hook.result.current.setPackId('v4')).toBe(true));
    expect(auth.refetch).not.toHaveBeenCalled();
    hook.unmount();
    const again = await mounted();
    expect(again.result.current.packId).toBe('v4');
  });

  it('never treats an unavailable authentication-mode response as open access', async () => {
    auth.mode.mockResolvedValue({ isSuccess: false, data: { mode: 'open' } });
    const hook = renderHook(() => useWidgetDesignPack());
    await waitFor(() => expect(hook.result.current.error).toMatch(/authentication mode/));
    expect(hook.result.current.isReady).toBe(false);
    expect(hook.result.current.setPackId('classic')).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it('keeps open-profile preferences separate from signed-in account preferences', async () => {
    auth.available.add('v4');
    const account = await mounted();
    act(() => account.result.current.setPackId('v4'));
    account.unmount();
    auth.mode.mockResolvedValue({ isSuccess: true, data: { mode: 'open' } });
    const open = await mounted();
    expect(open.result.current.packId).toBe('classic');
    act(() => open.result.current.setPackId('classic'));
    open.unmount();
    auth.mode.mockResolvedValue({ isSuccess: true, data: { mode: 'forward_auth' } });
    const restored = await mounted();
    expect(restored.result.current.packId).toBe('v4');
  });

  it('does not revive a delayed identity response after logout', async () => {
    let finish!: (value: unknown) => void;
    auth.refetch.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const hook = renderHook(() => useWidgetDesignPack());
    act(() => auth.listener?.({ type: 'auth.logout' }));
    await act(async () => finish({ isSuccess: true, data: { userId: 'old-account' } }));
    expect(hook.result.current.isReady).toBe(false);
    expect(hook.result.current.error).toMatch(/Sign in/);
    expect(window.localStorage.length).toBe(0);
  });

  it('saves for this browser only and restores on reload without using email as key', async () => {
    const hook = await mounted();
    expect(hook.result.current.packId).toBe('classic');
    act(() => expect(hook.result.current.setPackId('v1')).toBe(false)); // Not yet implemented.
    act(() => expect(hook.result.current.setPackId('classic')).toBe(true));
    expect(savedKey()).not.toContain('account-a');
    expect(savedKey()).not.toContain('@');
    hook.unmount();
    const again = await mounted();
    expect(again.result.current.packId).toBe('classic');
  });

  it('keeps the previous selection when quota or offline storage writes fail', async () => {
    const hook = await mounted();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    act(() => expect(hook.result.current.setPackId('classic')).toBe(false));
    expect(hook.result.current.packId).toBe('classic');
    expect(hook.result.current.error).toMatch(/save/);
    spy.mockRestore();
  });

  it('applies the last rapid intent and reconciles another tab without trusting corrupt data', async () => {
    auth.available.add('v1');
    auth.available.add('v2');
    const hook = await mounted();
    act(() => {
      hook.result.current.setPackId('v1');
      hook.result.current.setPackId('v2');
    });
    const key = savedKey();
    expect(JSON.parse(window.localStorage.getItem(key)!).packId).toBe('v2');
    expect(hook.result.current.packId).toBe('v2');
    window.localStorage.setItem(key, '{"version":1,"packId":"v1"}');
    act(() => window.dispatchEvent(new StorageEvent('storage', { key })));
    expect(hook.result.current.packId).toBe('v1');
    window.localStorage.setItem(key, '{"version":1,"packId":"retired"}');
    act(() => window.dispatchEvent(new StorageEvent('storage', { key })));
    expect(hook.result.current.packId).toBe('classic');
    window.localStorage.setItem(key, '{');
    act(() => window.dispatchEvent(new StorageEvent('storage', { key })));
    expect(hook.result.current.packId).toBe('classic');
  });

  it('separates identities and clears the active selection on logout or server change', async () => {
    const hook = await mounted();
    act(() => hook.result.current.setPackId('classic'));
    const firstKey = savedKey();
    act(() => {
      auth.listener?.({ type: 'auth.logout' });
      expect(hook.result.current.setPackId('classic')).toBe(false);
    });
    expect(hook.result.current.isReady).toBe(false);
    expect(hook.result.current.setPackId('classic')).toBe(false);
    hook.unmount();
    identity('account-b');
    const other = await mounted();
    act(() => other.result.current.setPackId('classic'));
    const keys = Object.keys(window.localStorage).filter(key => key.startsWith('teslasync.widget-design-pack.v1.'));
    expect(keys).toHaveLength(2);
    expect(keys.find(key => key !== firstKey)).toBeTruthy();
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'teslasync-server-base-url' })));
    expect(other.result.current.isReady).toBe(false);
  });
});
