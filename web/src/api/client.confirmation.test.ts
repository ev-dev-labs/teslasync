import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request, registerActionConfirmationProvider, __resetActionConfirmationForTests, ActionCanceledError } from './client';
import { __resetDocumentCancellationForTests } from '@/lib/documentCancellation';
import { getAccessToken, setServerConnection } from '@/lib/serverConnection';
import { TeslaAuthExpiredError } from '@/lib/resilience';

describe('provider-owned authentication and action confirmation', () => {
  let fetchMock: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    __resetDocumentCancellationForTests();
    __resetActionConfirmationForTests();
    localStorage.clear();
    window.history.replaceState(null, '', '/');
    fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ deleted_id: 'key' }), { headers: { 'Content-Type': 'application/json' } }));
  });
  afterEach(() => {
    __resetActionConfirmationForTests();
    __resetDocumentCancellationForTests();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('confirms before sending anything and never mints or sends an app credential', async () => {
    let accept!: () => void;
    const confirm = vi.fn(() => new Promise<void>(resolve => { accept = resolve; }));
    registerActionConfirmationProvider(confirm);
    const pending = request('/api-keys/key', { method: 'DELETE' });
    expect(fetchMock).not.toHaveBeenCalled();
    accept();
    await expect(pending).resolves.toMatchObject({ deleted_id: 'key' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).has('X-Sudo-Token')).toBe(false);
  });

  it('requires separate confirmation for each sensitive action rather than caching permission', async () => {
    const confirm = vi.fn(async () => {});
    registerActionConfirmationProvider(confirm);
    await request('/api-keys/first', { method: 'DELETE' });
    await request('/api-keys/second', { method: 'DELETE' });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('confirms starting impersonation but does not block ending it', async () => {
    const confirm = vi.fn(async () => {});
    registerActionConfirmationProvider(confirm);
    await request('/admin/impersonate', { method: 'POST' });
    await request('/admin/impersonate/end', { method: 'POST' });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['/backup/configs/config-id', 'DELETE'],
    ['/export/jobs/import', 'POST'],
  ])('confirms the mounted destructive route %s before any network request', async (path, method) => {
    await expect(request(path, { method })).rejects.toBeInstanceOf(ActionCanceledError);
    expect(fetchMock).not.toHaveBeenCalled();
    const confirm = vi.fn(async () => {});
    registerActionConfirmationProvider(confirm);
    await request(path, { method });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves Tesla authorization failures without replaying or clearing a native key', async () => {
    setServerConnection('https://synthetic-server.example', 'ts_synthetic_key');
    const teslaExpired = vi.fn();
    const browserExpired = vi.fn();
    document.addEventListener('teslasync:tesla-auth-expired', teslaExpired);
    document.addEventListener('teslasync:session-expired', browserExpired);
    try {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        error: 'Reconnect Tesla', code: 'TESLA_TOKEN_EXPIRED',
      }), { status: 401, headers: { 'Content-Type': 'application/json' } }));
      await expect(request('/vehicles/7')).rejects.toBeInstanceOf(TeslaAuthExpiredError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(teslaExpired).toHaveBeenCalledTimes(1);
      expect(browserExpired).not.toHaveBeenCalled();
      expect(getAccessToken()).toBe('ts_synthetic_key');
    } finally {
      document.removeEventListener('teslasync:tesla-auth-expired', teslaExpired);
      document.removeEventListener('teslasync:session-expired', browserExpired);
    }
  });

  it('sends nothing when cancelled or when the confirmation UI is unavailable', async () => {
    await expect(request('/vehicles/7', { method: 'DELETE' })).rejects.toBeInstanceOf(ActionCanceledError);
    registerActionConfirmationProvider(async () => { throw new ActionCanceledError(); });
    await expect(request('/vehicles/7', { method: 'DELETE' })).rejects.toBeInstanceOf(ActionCanceledError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not acquire credentials for reads or ordinary widget edits', async () => {
    const confirm = vi.fn(async () => {});
    registerActionConfirmationProvider(confirm);
    await request('/api-keys');
    await request('/users/me/dashboard/widgets/42', { method: 'DELETE' });
    expect(confirm).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not replay a denied sensitive action', async () => {
    registerActionConfirmationProvider(async () => {});
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'denied', code: 'FORBIDDEN' }), { status: 403 }));
    await expect(request('/api-keys/key', { method: 'DELETE' })).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending confirmation even when its provider ignores abort', async () => {
    registerActionConfirmationProvider(() => new Promise<void>(() => {}));
    const controller = new AbortController();
    const pending = request('/api-keys/key', { method: 'DELETE', signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rechecks historical mode after the user confirms', async () => {
    registerActionConfirmationProvider(async () => {
      window.history.replaceState(null, '', '/?as_of=2026-01-02T03%3A04%3A05Z');
    });
    await expect(request('/vehicles/7/guard', { method: 'POST', requiresLiveMode: true })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not send a confirmed request to a changed native account or server', async () => {
    registerActionConfirmationProvider(async () => {
      setServerConnection('https://new-server.example', 'ts_synthetic_key');
    });
    await expect(request('/api-keys/key', { method: 'DELETE' })).rejects.toBeInstanceOf(ActionCanceledError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
