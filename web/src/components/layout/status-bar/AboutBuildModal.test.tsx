import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { reported, openChangelog } = vi.hoisted(() => ({ reported: vi.fn(), openChangelog: vi.fn() }));
vi.mock('@/lib/errorReporter', () => ({ reportFrontendError: reported }));
vi.mock('@/hooks/useChangelogStatus', () => ({ openChangelogModal: openChangelog }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

interface Build {
  appVersion: string;
  hasUnseen: boolean;
  sha: string;
  updateAvailable: boolean;
  updateCheck?: { latest?: string; message?: string };
  uptime: string | null;
  versionInfo?: { chart_version?: string; go_version?: string; os?: string; arch?: string };
}
type ContentModule = typeof import('./AboutBuildModalContent');
let About: typeof import('./AboutBuildModal')['AboutBuildModal'];
let model: Build;
let resolveModule: (module: ContentModule) => void;
let rejectModule: (error: Error) => void;
let load: ReturnType<typeof vi.fn<() => Promise<ContentModule>>>;
let getAttributes: typeof import('@/components/ui/app-designs/designs')['getAppDesignAttributes'];
let observeScopes: typeof import('@/components/ui/app-designs/designs')['observeAppDesignScopes'];
const releases: Array<() => void> = [];
const fixtures: HTMLElement[] = [];

beforeEach(async () => {
  vi.resetModules();
  reported.mockClear();
  openChangelog.mockReset();
  model = {
    appVersion: '2.3.4', sha: 'abc1234', hasUnseen: true,
    updateAvailable: true, updateCheck: { latest: '2.4.0', message: 'Signed package available' },
    uptime: '1h 2m', versionInfo: { chart_version: '1.2.3', go_version: 'go1.25.3', os: 'linux', arch: 'arm64' },
  };
  vi.doMock('./useAboutBuild', () => ({ useAboutBuild: () => model }));
  const pending = new Promise<ContentModule>((resolve, reject) => {
    resolveModule = resolve;
    rejectModule = reject;
  });
  load = vi.fn(() => pending);
  vi.doMock('@/components/layout/status-bar/AboutBuildModalContent', load);
  const designs = await import('@/components/ui/app-designs/designs');
  getAttributes = designs.getAppDesignAttributes;
  observeScopes = designs.observeAppDesignScopes;
  About = (await import('./AboutBuildModal')).AboutBuildModal;
});

afterEach(() => {
  cleanup();
  for (const release of releases.splice(0)) release();
  for (const fixture of fixtures.splice(0)) fixture.remove();
  for (const name of Object.keys(getAttributes('classic'))) document.documentElement.removeAttribute(name);
  vi.doUnmock('@/components/layout/status-bar/AboutBuildModalContent');
  vi.doUnmock('./useAboutBuild');
  vi.restoreAllMocks();
});

function mount(open = true, strict = false) {
  const onClose = vi.fn(() => { view.rerender(element(false)); });
  const element = (isOpen: boolean) => {
    const modal = <About open={isOpen} onClose={onClose} />;
    return strict ? <StrictMode>{modal}</StrictMode> : modal;
  };
  const view = render(element(open));
  return { ...view, onClose, setOpen: (isOpen: boolean) => view.rerender(element(isOpen)) };
}

function invocation(kind: 'complete' | 'incomplete' | 'default' = 'complete') {
  const fixture = document.createElement('section');
  const preview = document.createElement('section');
  preview.setAttribute('dir', 'rtl');
  preview.setAttribute('lang', 'ar');
  if (kind !== 'default') {
    preview.setAttribute('data-app-design-preview', '');
    for (const [name, value] of Object.entries(getAttributes('editorial'))) preview.setAttribute(name, value);
    if (kind === 'incomplete') preview.removeAttribute('data-app-controls');
  }
  const origin = document.createElement('button');
  preview.append(origin);
  const other = document.createElement('section');
  other.setAttribute('data-app-design-preview', '');
  other.setAttribute('dir', 'ltr');
  other.setAttribute('lang', 'en');
  for (const [name, value] of Object.entries(getAttributes('bauhaus'))) other.setAttribute(name, value);
  fixture.append(preview, other);
  document.body.append(fixture);
  fixtures.push(fixture);
  releases.push(observeScopes(document.documentElement));
  return { origin, preview, other };
}

async function finishLoading(visible = true) {
  await act(async () => {
    const module = await vi.importActual<ContentModule>('./AboutBuildModalContent');
    resolveModule(module);
    await vi.dynamicImportSettled();
  });
  if (visible) await screen.findByText('App version');
}

describe('on-demand About build body', () => {
  it('does not import the cold body while the public host is closed', () => {
    mount(false);
    expect(load).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each(['escape', 'close'] as const)('opens a usable original Modal and cancels loading with %s', async method => {
    const { origin } = invocation();
    origin.focus();
    const view = mount();
    const dialog = screen.getByRole('dialog', { name: 'About this build' });
    expect(within(dialog).getByRole('status')).toHaveTextContent('Loading');
    expect(dialog.querySelector('[data-modal-scroll-body]')).toHaveClass('min-h-0', 'overflow-y-auto');
    if (method === 'escape') fireEvent.keyDown(dialog, { key: 'Escape' });
    else fireEvent.click(within(dialog).getByRole('button', { name: 'Close', exact: true }));
    expect(view.onClose).toHaveBeenCalledOnce();
    expect(origin).toHaveFocus();
    await finishLoading(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each(['detached', 'reparented'] as const)('keeps invocation profile/locale before body loading when %s', async mutation => {
    const { origin, preview, other } = invocation();
    origin.focus();
    mount();
    const dialog = screen.getByRole('dialog', { name: 'About this build' });
    const portal = dialog.closest('[data-app-design-portal]');
    expect(portal).toHaveAttribute('data-app-design-pack', 'editorial');
    expect(portal).toHaveAttribute('lang', 'ar');
    if (mutation === 'detached') preview.remove();
    else other.append(preview, origin);
    await finishLoading();
    expect(portal).toHaveAttribute('data-app-design-pack', 'editorial');
    expect(portal).toHaveAttribute('dir', 'rtl');
    expect(portal).toHaveAttribute('lang', 'ar');
  });

  it.each(['incomplete', 'default'] as const)('does not inherit a later complete preview for a captured %s boundary', async kind => {
    const { origin, other } = invocation(kind);
    origin.focus();
    mount();
    other.append(origin);
    await finishLoading();
    const portal = screen.getByRole('dialog', { name: 'About this build' }).closest('[data-app-design-portal]');
    expect(portal).not.toHaveAttribute('data-app-design-pack');
    expect(portal).not.toHaveAttribute('data-app-design-owner');
  });

  it('retains every metadata field, update message, action/link and action ordering in the real body', async () => {
    const order: string[] = [];
    const view = mount();
    view.onClose.mockImplementation(() => { order.push('close'); view.setOpen(false); });
    openChangelog.mockImplementation(() => { order.push('news'); });
    const openWindow = vi.spyOn(window, 'open').mockReturnValue(null);
    await finishLoading();
    const list = screen.getByText('App version').closest('dl')!;
    expect(Array.from(list.querySelectorAll('dt'), node => node.textContent)).toEqual([
      'App version', 'Commit', 'Helm chart', 'Go runtime', 'Platform', 'Server uptime',
    ]);
    expect(Array.from(list.querySelectorAll('dd'), node => node.textContent)).toEqual([
      'v2.3.4', 'abc1234', 'v1.2.3', 'go1.25.3', 'linux/arm64', '1h 2m',
    ]);
    expect(screen.getByText('Signed package available')).toBeVisible();
    expect(screen.getByText('A newer release is available: v2.4.0')).toBeVisible();
    const news = screen.getByRole('button', { name: "What's new" });
    expect(within(news.parentElement!).getAllByRole('button').map(button => button.textContent)).toEqual([
      "What's new", 'Release notes', 'Close',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Release notes' }));
    expect(openWindow).toHaveBeenCalledWith(
      'https://github.com/ev-dev-labs/teslasync/releases', '_blank', 'noopener,noreferrer',
    );
    expect(screen.getByRole('dialog', { name: 'About this build' })).toBeVisible();
    fireEvent.click(news);
    expect(order).toEqual(['close', 'news']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('retains always-present build fields when optional server/update metadata is missing', async () => {
    model = { ...model, updateAvailable: false, updateCheck: undefined, versionInfo: undefined, uptime: null };
    mount();
    await finishLoading();
    expect(screen.getByText('v2.3.4')).toBeVisible();
    expect(screen.getByText('abc1234')).toBeVisible();
    for (const label of ['Helm chart', 'Go runtime', 'Platform', 'Server uptime']) expect(screen.queryByText(label)).toBeNull();
    expect(screen.getByRole('button', { name: 'Release notes' })).toBeEnabled();
  });

  it('contains failure in the usable Modal and retries without losing the first invocation', async () => {
    const { origin, preview, other } = invocation();
    origin.focus();
    mount();
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    const error = new Error('Failed to fetch dynamically imported module');
    await act(async () => { rejectModule(error); await vi.dynamicImportSettled(); });
    expect(screen.getByRole('alert')).toHaveTextContent('Component failed to load');
    expect(screen.getByRole('button', { name: 'Close', exact: true })).toBeEnabled();
    expect(reported).toHaveBeenCalledWith(expect.objectContaining({ cause: error }), 'react');
    other.append(preview, origin);
    const module = await vi.importActual<ContentModule>('./AboutBuildModalContent');
    vi.doMock('@/components/layout/status-bar/AboutBuildModalContent', () => module);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('App version');
    const portal = screen.getByRole('dialog', { name: 'About this build' }).closest('[data-app-design-portal]');
    expect(portal).toHaveAttribute('data-app-design-pack', 'editorial');
    expect(portal).toHaveAttribute('lang', 'ar');
  });

  it('recaptures each open lifecycle of an otherwise persistent public host', async () => {
    const view = mount(false);
    const { origin, other } = invocation();
    origin.focus();
    view.setOpen(true);
    await finishLoading();
    view.setOpen(false);
    const secondOrigin = document.createElement('button');
    other.append(secondOrigin);
    secondOrigin.focus();
    await act(async () => { view.setOpen(true); await vi.dynamicImportSettled(); });
    await screen.findByText('App version');
    const portal = screen.getByRole('dialog', { name: 'About this build' }).closest('[data-app-design-portal]');
    expect(portal).toHaveAttribute('data-app-design-pack', 'bauhaus');
    expect(portal).toHaveAttribute('lang', 'en');
    expect(load).toHaveBeenCalledOnce();
  });

  it('ignores a rejected import after the host unmounts', async () => {
    const view = mount();
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    view.unmount();
    await act(async () => { rejectModule(new Error('Late import failure')); });
    expect(reported).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('retains the real body and original focus/close lifecycle through StrictMode effect replay', async () => {
    const module = await vi.importActual<ContentModule>('./AboutBuildModalContent');
    vi.doMock('@/components/layout/status-bar/AboutBuildModalContent', () => module);
    const { origin } = invocation();
    origin.focus();
    const view = mount(true, true);
    await screen.findByText('App version');
    const dialog = screen.getByRole('dialog', { name: 'About this build' });
    expect(dialog.closest('[data-app-design-portal]')).toHaveAttribute('data-app-design-pack', 'editorial');
    const closeButtons = within(dialog).getAllByRole('button', { name: 'Close', exact: true });
    fireEvent.click(closeButtons[1]);
    expect(view.onClose).toHaveBeenCalledOnce();
    expect(origin).toHaveFocus();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
