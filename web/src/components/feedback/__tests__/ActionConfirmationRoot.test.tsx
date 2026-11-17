import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request, ActionCanceledError, __resetActionConfirmationForTests } from '@/api/client';
import { ActionConfirmationRoot } from '../ActionConfirmationRoot';

const { listeners } = vi.hoisted(() => ({
  listeners: new Set<(message: { type: 'auth.logout' }) => void>(),
}));
vi.mock('@/lib/broadcast', () => ({
  subscribe: (listener: (message: { type: 'auth.logout' }) => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key,
  }),
}));

function start(path = '/api-keys/first', signal?: AbortSignal) {
  let pending!: Promise<unknown>;
  act(() => { pending = request(path, { method: 'DELETE', signal }).catch((error: unknown) => error); });
  return pending;
}
function accept() {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'CONFIRM' } });
  expect(screen.getByRole('textbox')).toHaveValue('CONFIRM');
  expect(screen.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm', exact: true }));
}
async function waitForDialog() {
  const dialog = await screen.findByRole('dialog', { name: 'Confirm sensitive action' });
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
}

beforeEach(() => {
  __resetActionConfirmationForTests();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"ok":true}', {
    headers: { 'Content-Type': 'application/json' },
  }));
});
afterEach(() => {
  cleanup();
  listeners.clear();
  __resetActionConfirmationForTests();
  vi.restoreAllMocks();
});

describe('shared intent confirmation', () => {
  it('requires exact typed intent and never sends a declined action', async () => {
    render(<ActionConfirmationRoot />);
    const pending = start();
    await waitForDialog();
    expect(screen.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'confirm' } });
    expect(screen.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    expect(await pending).toBeInstanceOf(ActionCanceledError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('serializes actions and never carries typed consent into the next action', async () => {
    render(<ActionConfirmationRoot />);
    const first = start();
    const second = start('/api-keys/second');
    await waitForDialog();
    expect(screen.getByText('/api-keys/first')).toBeVisible();
    accept();
    await act(async () => { expect(await first).toEqual({ ok: true }); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText('/api-keys/second')).toBeVisible();
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
    accept();
    await act(async () => { expect(await second).toEqual({ ok: true }); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('aborts the active request and allows the next action to cancel independently', async () => {
    render(<ActionConfirmationRoot />);
    const controller = new AbortController();
    const first = start('/api-keys/first', controller.signal);
    const second = start('/api-keys/second');
    await waitForDialog();
    await act(async () => { await Promise.resolve(); controller.abort(); });
    expect(await first).toMatchObject({ name: 'AbortError' });
    expect(screen.getByText('/api-keys/second')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    expect(await second).toBeInstanceOf(ActionCanceledError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['logout', 'unmount'])('cancels every queued request on %s', async reason => {
    const root = render(<ActionConfirmationRoot />);
    const first = start();
    const second = start('/api-keys/second');
    act(() => {
      if (reason === 'unmount') root.unmount();
      else for (const listener of listeners) listener({ type: 'auth.logout' });
    });
    expect(await first).toBeInstanceOf(ActionCanceledError);
    expect(await second).toBeInstanceOf(ActionCanceledError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
