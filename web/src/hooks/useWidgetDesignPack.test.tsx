import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto, createHash } from 'node:crypto';
import { useWidgetDesignPack } from './useWidgetDesignPack';

const server = vi.hoisted(() => ({
  subject: 'Opaque/ACCOUNT-a',
  mode: 'forward_auth',
  origin: 'https://server-a.example',
  readError: false,
  writeError: false,
  authError: false,
  wrongScope: false,
  values: new Map<string, string>(),
  listeners: new Set<(message: { type: string }) => void>(),
  request: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/api/client', () => ({ request: server.request }));
vi.mock('@/lib/serverConnection', () => ({ getServerBaseUrl: () => server.origin }));
vi.mock('@/lib/broadcast', () => ({
  subscribe: (listener: (message: { type: string }) => void) => {
    server.listeners.add(listener);
    return () => { server.listeners.delete(listener); };
  },
}));
vi.mock('@/api/hooks/_toastHelpers', () => ({
  useMutationToast: () => ({ success: server.success, error: server.error }),
}));

const clients: QueryClient[] = [];
function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
function scope() { return hash(server.mode === 'open' ? 'open' : `forward_auth:${server.subject}`); }
function storageKey() { return `${server.origin}:${scope()}`; }
function client() {
  const instance = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(instance);
  return instance;
}
function mount(instance = client()) {
  const wrapper = ({ children }: PropsWithChildren) =>
    <QueryClientProvider client={instance}>{children}</QueryClientProvider>;
  return renderHook(() => useWidgetDesignPack(), { wrapper });
}
async function ready(instance?: QueryClient) {
  const hook = mount(instance);
  await waitFor(() => expect(hook.result.current.isReady).toBe(true));
  return hook;
}
function response() {
  return { pack_id: server.values.get(storageKey()) ?? 'classic', scope: server.wrongScope ? 'wrong' : scope() };
}
function logout() {
  act(() => server.listeners.forEach(listener => listener({ type: 'auth.logout' })));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function independentBrowserStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() { return entries.size; },
    clear: () => entries.clear(),
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, value); },
    removeItem: key => { entries.delete(key); },
    key: index => [...entries.keys()][index] ?? null,
  };
}

describe('durable widget design pack preference', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal('crypto', webcrypto);
    server.subject = 'Opaque/ACCOUNT-a';
    server.mode = 'forward_auth';
    server.origin = 'https://server-a.example';
    server.readError = false;
    server.writeError = false;
    server.authError = false;
    server.wrongScope = false;
    server.values.clear();
    server.request.mockReset();
    server.success.mockClear();
    server.error.mockClear();
    server.request.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/system/auth-mode') {
        if (server.authError) throw new Error('auth unavailable');
        return { mode: server.mode, subject: server.subject };
      }
      if (path !== '/settings/widget-design-pack') throw new Error(`Unexpected endpoint: ${path}`);
      if (options?.method === 'PUT') {
        if (server.writeError) throw new Error('save failed');
        const body = JSON.parse(String(options.body)) as { pack_id: string };
        server.values.set(storageKey(), body.pack_id);
      } else if (server.readError) throw new Error('refresh failed');
      return response();
    });
  });
  afterEach(() => {
    cleanup();
    clients.splice(0).forEach(instance => instance.clear());
    server.listeners.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('two independent QueryClients with empty browser storage retrieve the same server selection', async () => {
    const storageA = independentBrowserStorage();
    const storageB = independentBrowserStorage();
    const storage = vi.spyOn(window, 'localStorage', 'get').mockReturnValue(storageA);
    const first = await ready();
    await act(async () => expect(await first.result.current.setPackId('memphis')).toBe(true));
    expect(first.result.current.packId).toBe('memphis');
    expect(server.values.get(storageKey())).toBe('memphis');
    first.unmount();
    storage.mockReturnValue(storageB); // Another browser has no selection to migrate.
    const second = await ready(client());
    expect(second.result.current.packId).toBe('memphis');
    expect(window.localStorage.length).toBe(0);
    expect(storageA.length).toBe(0);
    expect(server.success).toHaveBeenCalledOnce();
    const calls = server.request.mock.calls.filter(([path]) => path === '/settings/widget-design-pack');
    expect(calls.every(([, options]) => options.signal instanceof AbortSignal)).toBe(true);
    expect(calls.find(([, options]) => options.method === 'PUT')?.[1].body).toBe('{"pack_id":"memphis"}');
  });

  it('separates exact opaque subjects, open deployments and server origins', async () => {
    const a = await ready();
    await act(async () => { await a.result.current.setPackId('v4'); });
    a.unmount();
    server.subject = 'opaque/ACCOUNT-a';
    const b = await ready();
    expect(b.result.current.packId).toBe('classic');
    b.unmount();
    server.mode = 'open';
    const open = await ready();
    expect(open.result.current.packId).toBe('classic');
    await act(async () => { await open.result.current.setPackId('analog'); });
    expect(server.values.get(`${server.origin}:${hash('open')}`)).toBe('analog');
    open.unmount();
    server.origin = 'https://server-b.example';
    const other = await ready();
    expect(other.result.current.packId).toBe('classic');
  });

  it.each(['', '   '])('fails closed without verified identity: %j', async subject => {
    server.subject = subject;
    const hook = mount();
    await waitFor(() => expect(hook.result.current.error).toMatch(/identity/));
    expect(hook.result.current.isReady).toBe(false);
    expect(await hook.result.current.setPackId('v1')).toBe(false);
    expect(server.request.mock.calls.some(([path]) => path === '/settings/widget-design-pack')).toBe(false);
  });

  it('does not trust cached auth data as verification or assume open mode on auth failure', async () => {
    const instance = client();
    instance.setQueryData(['auth', 'mode'], { mode: 'open' });
    server.authError = true;
    const hook = mount(instance);
    await waitFor(() => expect(hook.result.current.error).toMatch(/authentication mode/));
    expect(hook.result.current.isReady).toBe(false);
    expect(server.request).toHaveBeenCalledWith('/system/auth-mode', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('validates server scope before applying selection, and safely resolves unknown stored IDs', async () => {
    server.wrongScope = true;
    const hook = mount();
    await waitFor(() => expect(hook.result.current.error).toMatch(/mismatch/));
    expect(hook.result.current.isReady).toBe(false);
    server.wrongScope = false;
    server.values.set(storageKey(), 'retired');
    act(() => hook.result.current.retry());
    await waitFor(() => expect(hook.result.current.isReady).toBe(true));
    expect(hook.result.current.packId).toBe('classic');
    expect(await hook.result.current.setPackId('invalid' as 'v1')).toBe(false);
    expect(server.request.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
  });

  it('retains the selection on refresh/save failure and exposes a retry', async () => {
    server.values.set(storageKey(), 'v5');
    const hook = await ready();
    server.writeError = true;
    await act(async () => expect(await hook.result.current.setPackId('v6')).toBe(false));
    expect(hook.result.current.packId).toBe('v5');
    expect(hook.result.current.error).toMatch(/save failed/);
    expect(server.error).toHaveBeenCalledOnce();
    server.readError = true;
    act(() => hook.result.current.retry());
    await waitFor(() => expect(hook.result.current.error).toMatch(/refresh failed/));
    expect(hook.result.current.packId).toBe('v5');
    expect(hook.result.current.isReady).toBe(true);
    server.readError = false;
    server.values.set(storageKey(), 'v7');
    act(() => hook.result.current.retry());
    await waitFor(() => expect(hook.result.current.packId).toBe('v7'));
  });

  it('initial read failure is not ready and does not upload a browser-local selection', async () => {
    window.localStorage.setItem('teslasync.widget-design-pack.v1.old', '{"version":1,"packId":"v4"}');
    server.readError = true;
    const hook = mount();
    await waitFor(() => expect(hook.result.current.error).toMatch(/refresh failed/));
    expect(hook.result.current.isReady).toBe(false);
    expect(hook.result.current.packId).toBe('classic');
    expect(await hook.result.current.setPackId('v4')).toBe(false);
  });

  it('shares queries across 132 widgets without refetching on ordinary rerenders', async () => {
    const timer = vi.spyOn(window, 'setInterval');
    const instance = client();
    const hooks = Array.from({ length: 132 }, () => mount(instance));
    await waitFor(() => expect(hooks.every(hook => hook.result.current.isReady)).toBe(true));
    const before = server.request.mock.calls.length;
    hooks.forEach(hook => hook.rerender());
    await act(async () => { await Promise.resolve(); });
    expect(server.request.mock.calls.length).toBe(before);
    expect(server.request.mock.calls.filter(([path]) => path === '/settings/widget-design-pack')).toHaveLength(1);
    expect(server.request.mock.calls.filter(([path]) => path === '/system/auth-mode')).toHaveLength(1);
    expect(timer.mock.calls.filter(([, delay]) => delay === 20_000)).toHaveLength(1);
    // Simulate a change from another machine, then the single shared poll.
    server.values.set(storageKey(), 'cyber');
    const tick = timer.mock.calls.find(([, delay]) => delay === 20_000)![0] as () => void;
    act(() => tick());
    await waitFor(() => expect(hooks.every(hook => hook.result.current.packId === 'cyber')).toBe(true));
    expect(server.request.mock.calls.filter(([path]) => path === '/settings/widget-design-pack')).toHaveLength(2);
    expect(server.request.mock.calls.filter(([path]) => path === '/system/auth-mode')).toHaveLength(2);
  });

  it('revalidates on focus and never replaces an old selection with a different identity response', async () => {
    server.values.set(storageKey(), 'v5');
    const hook = await ready();
    server.values.set(storageKey(), 'terminal');
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true); });
    await waitFor(() => expect(hook.result.current.packId).toBe('terminal'));
    server.wrongScope = true;
    act(() => hook.result.current.retry());
    await waitFor(() => expect(hook.result.current.error).toMatch(/mismatch/));
    expect(hook.result.current.packId).toBe('terminal');
    focusManager.setFocused(undefined);
  });

  it('hides old data immediately when a different server is rendered without a storage event', async () => {
    server.values.set(storageKey(), 'v5');
    const hook = await ready();
    server.origin = 'https://other.example';
    hook.rerender();
    expect(hook.result.current.packId).toBe('classic');
    await waitFor(() => expect(hook.result.current.isReady).toBe(true));
    expect(hook.result.current.packId).toBe('classic');
  });

  it('ignores a delayed identity callback after logout', async () => {
    const pending = deferred<{ mode: string; subject: string }>();
    server.request.mockReturnValue(pending.promise);
    const hook = mount();
    logout();
    await act(async () => pending.resolve({ mode: 'forward_auth', subject: server.subject }));
    expect(hook.result.current.isReady).toBe(false);
    expect(hook.result.current.packId).toBe('classic');
  });

  it.each(['logout', 'server'])('ignores delayed reads after %s', async reason => {
    const pending = deferred<ReturnType<typeof response>>();
    const transport = server.request.getMockImplementation()!;
    server.request.mockImplementation((path: string, options?: RequestInit) =>
      path === '/settings/widget-design-pack' ? pending.promise : transport(path, options));
    const hook = mount();
    await waitFor(() => expect(server.request.mock.calls.some(([path]) => path === '/settings/widget-design-pack')).toBe(true));
    const old = { pack_id: 'v4', scope: scope() };
    if (reason === 'logout') logout();
    else act(() => {
      server.origin = 'https://new.example';
      window.dispatchEvent(new StorageEvent('storage', { key: 'teslasync-server-base-url' }));
    });
    await act(async () => pending.resolve(old));
    expect(hook.result.current.isReady).toBe(false);
    expect(hook.result.current.packId).toBe('classic');
  });

  it.each(['logout', 'server'])('aborts writes and ignores delayed success after %s', async reason => {
    const hook = await ready();
    const pending = deferred<ReturnType<typeof response>>();
    const transport = server.request.getMockImplementation()!;
    server.request.mockImplementation((path: string, options?: RequestInit) =>
      options?.method === 'PUT' ? pending.promise : transport(path, options));
    let result!: Promise<boolean>;
    act(() => { result = hook.result.current.setPackId('v4'); });
    await waitFor(() => expect(hook.result.current.isSaving).toBe(true));
    await waitFor(() => expect(server.request.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(true));
    const old = { pack_id: 'v4', scope: scope() };
    const options = server.request.mock.calls.find(([, options]) => options?.method === 'PUT')![1] as RequestInit;
    if (reason === 'logout') logout();
    else act(() => {
      server.origin = 'https://new.example';
      window.dispatchEvent(new StorageEvent('storage', { key: 'teslasync-server-base-url' }));
    });
    await act(async () => { pending.resolve(old); expect(await result).toBe(false); });
    expect(options.signal?.aborted).toBe(true);
    expect(hook.result.current.packId).toBe('classic');
    expect(hook.result.current.isSaving).toBe(false);
    expect(server.success).not.toHaveBeenCalled();
  });

  it('does not queue offline writes or retry failed writes', async () => {
    const hook = await ready();
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    await act(async () => expect(await hook.result.current.setPackId('v4')).toBe(false));
    expect(server.request.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
    vi.restoreAllMocks();
    server.writeError = true;
    await act(async () => expect(await hook.result.current.setPackId('v4')).toBe(false));
    expect(server.request.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(1);
  });

  it('classifies cosmetic preferences as mode-independent while viewing historical telemetry', async () => {
    const previousUrl = window.location.href;
    window.history.replaceState(null, '', '?as_of=2026-01-01T00:00:00Z');
    try {
      const hook = await ready();
      await act(async () => expect(await hook.result.current.setPackId('v4')).toBe(true));
      expect(hook.result.current.packId).toBe('v4');
      const put = server.request.mock.calls.find(([, options]) => options?.method === 'PUT');
      expect(put).toBeDefined();
      expect(put![1]).not.toHaveProperty('requiresLiveMode');
    } finally {
      window.history.replaceState(null, '', previousUrl);
    }
  });
});
