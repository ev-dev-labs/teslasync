import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Input } from '../../ui/Input';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));
const { reported, listeners } = vi.hoisted(() => ({
  reported: vi.fn(),
  listeners: new Set<(message: { type: 'auth.logout' }) => void>(),
}));
vi.mock('@/lib/errorReporter', () => ({ reportFrontendError: reported }));
vi.mock('@/lib/broadcast', () => ({
  subscribe: (listener: (message: { type: 'auth.logout' }) => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
}));

type DialogModule = typeof import('../ActionConfirmationDialog');
type ClientModule = typeof import('@/api/client');
let Root: typeof import('../ActionConfirmationRoot')['ActionConfirmationRoot'];
let request: ClientModule['request'];
let ActionCanceledError: ClientModule['ActionCanceledError'];
let getAttributes: typeof import('../../ui/app-designs/designs')['getAppDesignAttributes'];
let observeScopes: typeof import('../../ui/app-designs/designs')['observeAppDesignScopes'];
let resolveModule: (module: DialogModule) => void;
let rejectModule: (error: Error) => void;
let load: ReturnType<typeof vi.fn<() => Promise<DialogModule>>>;
const releases: Array<() => void> = [];
const fixtures: HTMLElement[] = [];

beforeEach(async () => {
  vi.resetModules();
  reported.mockClear();
  const pending = new Promise<DialogModule>((resolve, reject) => {
    resolveModule = resolve;
    rejectModule = reject;
  });
  load = vi.fn(() => pending);
  vi.doMock('@/components/feedback/ActionConfirmationDialog', load);
  const designs = await import('../../ui/app-designs/designs');
  getAttributes = designs.getAppDesignAttributes;
  observeScopes = designs.observeAppDesignScopes;
  Root = (await import('../ActionConfirmationRoot')).ActionConfirmationRoot;
  const client = await import('@/api/client');
  request = client.request;
  ActionCanceledError = client.ActionCanceledError;
  client.__resetActionConfirmationForTests();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"ok":true}', {
    headers: { 'Content-Type': 'application/json' },
  }));
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  for (const release of releases.splice(0)) release();
  for (const fixture of fixtures.splice(0)) fixture.remove();
  for (const name of Object.keys(getAttributes('classic'))) document.documentElement.removeAttribute(name);
  listeners.clear();
  vi.doUnmock('@/components/feedback/ActionConfirmationDialog');
  vi.restoreAllMocks();
  localStorage.clear();
});

function mount() {
  return render(<StrictMode><Input label="Draft" defaultValue="Unsent changes" /><Root /></StrictMode>);
}

function start(path = '/api-keys/first', signal?: AbortSignal) {
  let pending!: Promise<unknown>;
  act(() => { pending = request(path, { method: 'DELETE', signal }).catch((error: unknown) => error); });
  return pending;
}

function invocation(kind: 'complete' | 'incomplete' | 'default' = 'complete') {
  const fixture = document.createElement('section');
  const locale = document.createElement('section');
  locale.setAttribute('dir', 'rtl');
  locale.setAttribute('lang', 'ar');
  const preview = document.createElement('section');
  if (kind !== 'default') {
    preview.setAttribute('data-app-design-preview', '');
    for (const [name, value] of Object.entries(getAttributes('editorial'))) preview.setAttribute(name, value);
    if (kind === 'incomplete') preview.removeAttribute('data-app-controls');
  }
  const origin = document.createElement('button');
  origin.textContent = 'Original invocation';
  preview.append(origin);
  locale.append(preview);
  const other = document.createElement('section');
  other.setAttribute('data-app-design-preview', '');
  other.setAttribute('dir', 'ltr');
  other.setAttribute('lang', 'en');
  for (const [name, value] of Object.entries(getAttributes('bauhaus'))) other.setAttribute(name, value);
  fixture.append(locale, other);
  document.body.append(fixture);
  fixtures.push(fixture);
  releases.push(observeScopes(document.documentElement));
  return { preview, origin, other };
}

async function finishLoading() {
  await act(async () => {
    const module = await vi.importActual<DialogModule>('../ActionConfirmationDialog');
    resolveModule(module);
    await vi.dynamicImportSettled();
  });
  const dialog = await screen.findByRole('dialog', { name: 'Confirm sensitive action' });
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  return dialog;
}

describe('on-demand sensitive action confirmation', () => {
  it('does not load an unused confirmation or suspend the mounted draft', () => {
    mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Draft' }), { target: { value: 'Still editing' } });
    expect(load).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Still editing');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['detached', 'reparented'] as const)(
    'retains the first profile and locale when the invocation is %s before the real dialog loads',
    async mutation => {
      mount();
      const { preview, origin, other } = invocation();
      origin.focus();
      const pending = start();
      await waitFor(() => expect(load).toHaveBeenCalledOnce());
      if (mutation === 'detached') preview.remove();
      else other.append(preview, origin);
      const dialog = await finishLoading();
      const portal = dialog.closest('[data-app-design-portal]');
      expect(portal).toHaveAttribute('data-app-design-pack', 'editorial');
      expect(portal).toHaveAttribute('dir', 'rtl');
      expect(portal).toHaveAttribute('lang', 'ar');
      expect(dialog.closest('[data-app-part="overlay"]')).toHaveClass('z-[120]');
      expect(dialog.querySelector('[data-modal-scroll-body]')).toHaveClass('min-h-0', 'overflow-y-auto');
      expect(screen.getByRole('button', { name: 'Confirm', exact: true }).closest('[data-modal-scroll-body]')).toBeNull();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(await pending).toBeInstanceOf(ActionCanceledError);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      if (mutation === 'reparented') await waitFor(() => expect(origin).toHaveFocus());
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('captures each queued invocation before loading and resets typed consent for the next action', async () => {
    mount();
    const { origin, other } = invocation();
    const secondOrigin = document.createElement('button');
    other.append(secondOrigin);
    origin.focus();
    const first = start();
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    secondOrigin.focus();
    const second = start('/api-keys/second');
    const dialog = await finishLoading();
    expect(dialog.closest('[data-app-design-portal]')).toHaveAttribute('data-app-design-pack', 'editorial');
    fireEvent.change(screen.getByRole('textbox', { name: 'Type CONFIRM to continue' }), { target: { value: 'CONFIRM' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm', exact: true }));
    await act(async () => { expect(await first).toEqual({ ok: true }); });
    const next = screen.getByRole('dialog', { name: 'Confirm sensitive action' });
    expect(next).toHaveTextContent('/api-keys/second');
    expect(next.closest('[data-app-design-portal]')).toHaveAttribute('data-app-design-pack', 'bauhaus');
    expect(next.closest('[data-app-design-portal]')).toHaveAttribute('dir', 'ltr');
    expect(next.closest('[data-app-design-portal]')).toHaveAttribute('lang', 'en');
    expect(screen.getByRole('textbox', { name: 'Type CONFIRM to continue' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    expect(await second).toBeInstanceOf(ActionCanceledError);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(['incomplete', 'default'] as const)('keeps a captured %s invocation neutral after reparenting', async kind => {
    mount();
    const { origin, other } = invocation(kind);
    origin.focus();
    const pending = start();
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    other.append(origin);
    const dialog = await finishLoading();
    expect(dialog.closest('[data-app-design-portal]')).not.toHaveAttribute('data-app-design-pack');
    expect(dialog.closest('[data-app-design-portal]')).not.toHaveAttribute('data-app-design-owner');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    expect(await pending).toBeInstanceOf(ActionCanceledError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('contains an import failure and retries the same immutable invocation without logging the action path', async () => {
    mount();
    const { preview, origin, other } = invocation();
    origin.focus();
    const path = '/api-keys/private-label';
    const pending = start(path);
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    const error = new Error('Failed to fetch dynamically imported module');
    await act(async () => { rejectModule(error); });
    expect(screen.getByRole('alert')).toHaveTextContent('Component failed to load');
    expect(reported).toHaveBeenCalledWith(expect.objectContaining({ cause: error }), 'react');
    expect(JSON.stringify(reported.mock.calls)).not.toContain(path);
    expect(screen.queryByText(path)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    other.append(preview, origin);
    const module = await vi.importActual<DialogModule>('../ActionConfirmationDialog');
    vi.doMock('@/components/feedback/ActionConfirmationDialog', () => module);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm sensitive action' });
    expect(dialog).toHaveTextContent(path);
    expect(dialog.closest('[data-app-design-portal]')).toHaveAttribute('data-app-design-pack', 'editorial');
    expect(dialog.closest('[data-app-design-portal]')).toHaveAttribute('lang', 'ar');
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Unsent changes');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    expect(await pending).toBeInstanceOf(ActionCanceledError);
    await waitFor(() => expect(origin).toHaveFocus());
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['escape', 'button'] as const)('cancels a loading action with %s and ignores its late import', async method => {
    mount();
    const { origin } = invocation();
    origin.focus();
    const pending = start();
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    if (method === 'escape') fireEvent.keyDown(window, { key: 'Escape' });
    else {
      const cancel = screen.getByRole('button', { name: 'Cancel', exact: true });
      cancel.focus();
      fireEvent.click(cancel);
    }
    expect(await pending).toBeInstanceOf(ActionCanceledError);
    expect(origin).toHaveFocus();
    const module = await vi.importActual<DialogModule>('../ActionConfirmationDialog');
    await act(async () => { resolveModule(module); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves the native abort reason during loading and lets the queued action cancel independently', async () => {
    mount();
    const controller = new AbortController();
    let first!: Promise<unknown>;
    await act(async () => {
      first = request('/api-keys/first', { method: 'DELETE', signal: controller.signal }).catch((error: unknown) => error);
    });
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    const second = start('/api-keys/second');
    const reason = new DOMException('Native cancellation', 'AbortError');
    await act(async () => {
      controller.abort(reason);
      expect(await first).toBe(reason);
    });
    const dialog = await finishLoading();
    expect(dialog).toHaveTextContent('/api-keys/second');
    expect(dialog).not.toHaveTextContent('/api-keys/first');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    expect(await second).toBeInstanceOf(ActionCanceledError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['logout', 'unmount'] as const)('settles every queued request on %s and ignores a late import', async reason => {
    const view = mount();
    const first = start();
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    const second = start('/api-keys/second');
    act(() => {
      if (reason === 'unmount') view.unmount();
      else for (const listener of listeners) listener({ type: 'auth.logout' });
    });
    expect(await first).toBeInstanceOf(ActionCanceledError);
    expect(await second).toBeInstanceOf(ActionCanceledError);
    const module = await vi.importActual<DialogModule>('../ActionConfirmationDialog');
    await act(async () => { resolveModule(module); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('settles an action cancelled by unmount before its pending render commits', async () => {
    const view = mount();
    let pending!: Promise<unknown>;
    act(() => {
      pending = request('/api-keys/first', { method: 'DELETE' }).catch((error: unknown) => error);
      view.unmount();
    });
    expect(await pending).toBeInstanceOf(ActionCanceledError);
    expect(load).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the original warning, literal Code details, action order and exact typed consent after presentation loads', async () => {
    mount();
    const path = '/api-keys/<private-label>';
    const pending = start(path);
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    expect(screen.queryByRole('button', { name: 'Confirm', exact: true })).toBeNull();
    expect(screen.queryByText(path)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();

    const dialog = await finishLoading();
    expect(dialog).toHaveTextContent('This action can change or remove data. Your authentication provider handles sign-in; TeslaSync only asks you to confirm your intent.');
    const details = screen.getByText(path);
    expect(details.tagName).toBe('CODE');
    expect(details.childElementCount).toBe(0);
    const cancel = screen.getByRole('button', { name: 'Cancel', exact: true });
    const confirm = screen.getByRole('button', { name: 'Confirm', exact: true });
    expect(cancel.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const typed = screen.getByRole('textbox', { name: 'Type CONFIRM to continue' });
    fireEvent.change(typed, { target: { value: 'CONFIRM ' } });
    expect(confirm).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(typed, { target: { value: 'CONFIRM' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await act(async () => { expect(await pending).toEqual({ ok: true }); });
    expect(fetch).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Unsent changes');
  });

  it.each(['cancel', 'unmount'] as const)('ignores a rejected presentation import after %s without reporting or sending the action', async reason => {
    const view = mount();
    const pending = start();
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    if (reason === 'unmount') view.unmount();
    else fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    expect(await pending).toBeInstanceOf(ActionCanceledError);
    await act(async () => {
      rejectModule(new Error('Late presentation module failure'));
      await vi.dynamicImportSettled();
    });
    expect(reported).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
