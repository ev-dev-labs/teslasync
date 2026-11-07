import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastProvider } from '@/components/feedback';
import WidgetDesignPackSettings from './WidgetDesignPackSettings';

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  mode: vi.fn(),
  request: vi.fn(),
  eventSource: vi.fn(),
}));

vi.mock('@/api/hooks/useUser', () => ({
  useCurrentUser: () => ({ refetch: mocks.identity }),
}));
vi.mock('@/api/hooks/useAuthMode', () => ({
  useAuthMode: () => ({ refetch: mocks.mode }),
}));
vi.mock('@/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  request: mocks.request,
}));
vi.mock('@/lib/broadcast', () => ({
  subscribe: () => () => undefined,
  broadcast: vi.fn(),
}));
vi.mock('react-i18next', async () => {
  const { default: en } = await import('@/i18n/en.json');
  const t = (key: string, fallbackOrOptions?: unknown, options?: Record<string, unknown>) => {
    let value: unknown = en;
    for (const part of key.split('.')) {
      value = value && typeof value === 'object'
        ? (value as Record<string, unknown>)[part] : undefined;
    }
    let text = typeof value === 'string' ? value
      : typeof fallbackOrOptions === 'string' ? fallbackOrOptions : key;
    const replacements = typeof fallbackOrOptions === 'object' && fallbackOrOptions != null
      ? fallbackOrOptions as Record<string, unknown> : options;
    for (const [name, replacement] of Object.entries(replacements ?? {})) {
      text = text.replaceAll(`{{${name}}}`, String(replacement));
    }
    return text;
  };
  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

function renderSettings() {
  return render(<ToastProvider><WidgetDesignPackSettings /></ToastProvider>);
}

async function ready() {
  await screen.findByRole('button', { name: 'Classic active' });
}

function preferenceKey() {
  const key = Object.keys(localStorage).find(key => key.startsWith('teslasync.widget-design-pack.v1.'));
  expect(key).toBeDefined();
  return key!;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('EventSource', mocks.eventSource);
  mocks.identity.mockReset();
  mocks.mode.mockResolvedValue({ isSuccess: true, data: { mode: 'forward_auth' } });
  mocks.identity.mockResolvedValue({ isSuccess: true, data: { userId: 'preview-viewer' } });
  mocks.request.mockReset();
  mocks.request.mockRejectedValue(new Error('Preview must not read vehicle APIs'));
  mocks.eventSource.mockClear();
});

afterEach(() => {
  cleanup();
  vi.doUnmock('./WidgetDesignPackPreview');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Widget design pack settings', () => {
  it('retries a failed scope verification without requiring a reload', async () => {
    mocks.mode.mockResolvedValue({ isSuccess: false });
    render(<WidgetDesignPackSettings />);
    const retry = await screen.findByRole('button', { name: 'Retry preference' });
    expect(screen.getByRole('button', { name: 'Use Owner pack' })).toBeDisabled();
    mocks.mode.mockResolvedValue({ isSuccess: true, data: { mode: 'open' } });
    await act(async () => fireEvent.click(retry));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Use Owner pack' })).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('does not claim an active preference or allow writes before identity is verified', async () => {
    let resolve!: (value: unknown) => void;
    mocks.identity.mockReturnValue(new Promise(done => { resolve = done; }));
    renderSettings();
    expect(screen.getAllByRole('button', { name: /^Preview / })).toHaveLength(8);
    for (const button of screen.getAllByRole('button', { name: /^Use .* pack$/ })) {
      expect(button).toBeDisabled();
    }
    expect(screen.queryByRole('button', { name: / active$/ })).not.toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    resolve({ isSuccess: true, data: { userId: 'preview-viewer' } });
    await ready();
  });

  it('previews all eight real presentation choices without persistence, readers or commands', async () => {
    renderSettings();
    await ready();
    const write = vi.spyOn(Storage.prototype, 'setItem');
    for (const name of ['Classic', 'Studio', 'Elevated', 'Precision', 'Owner', 'Iconic', 'Expressive', 'Pixel']) {
      const opener = screen.getByRole('button', { name: `Preview ${name}` });
      opener.focus();
      fireEvent.click(opener);
      const dialog = await screen.findByRole('dialog', { name: `Preview ${name}` });
      await within(dialog).findByRole('heading', { name: 'Commands' }, { timeout: 10_000 });
      await waitFor(() => expect(within(dialog).queryByText('Loading preview...')).not.toBeInTheDocument());
      for (const heading of ['Vehicle', 'Battery', 'History', 'Status']) {
        expect(within(dialog).getByRole('heading', { name: heading })).toBeInTheDocument();
      }
      for (const action of ['Unlock', 'Climate', 'Flash lights']) {
        const command = within(dialog).getByRole('button', { name: action });
        expect(command).toBeDisabled();
        fireEvent.click(command);
      }
      expect(dialog.querySelector('[data-vehicle-studio]')).toBeInTheDocument();
      expect(dialog.querySelector('[data-vehicle-studio]')).toHaveAttribute('data-activity', 'static');
      expect(write).not.toHaveBeenCalled();
      expect(mocks.request).not.toHaveBeenCalled();
      expect(mocks.eventSource).not.toHaveBeenCalled();
      fireEvent.keyDown(dialog, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await waitFor(() => expect(opener).toHaveFocus());
    }
    expect(mocks.identity).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Classic active' })).toBeDisabled();
  }, 30_000);

  it('persists stable IDs for the browser profile without changing other preferences', async () => {
    localStorage.setItem('unrelated-appearance-preference', 'unchanged');
    renderSettings();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Use Owner pack' }));
    await screen.findByRole('button', { name: 'Owner active' });
    const key = preferenceKey();
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ version: 1, packId: 'v4' });
    expect(localStorage.getItem('unrelated-appearance-preference')).toBe('unchanged');
    expect(key).not.toContain('preview-viewer');
    expect(mocks.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use Pixel pack' }));
    await screen.findByRole('button', { name: 'Pixel active' });
    expect(JSON.parse(localStorage.getItem(key)!).packId).toBe('v7');
  });

  it('keeps the active preference and can close safely when the preview chunk fails', async () => {
    vi.doMock('./WidgetDesignPackPreview', () => { throw new Error('Preview chunk unavailable'); });
    renderSettings();
    await ready();
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const opener = screen.getByRole('button', { name: 'Preview Owner' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Preview Owner' });
    await within(dialog).findByRole('alert');
    expect(within(dialog).getByRole('button', { name: 'Retry preview' })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close preview' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Classic active' })).toBeDisabled();
    expect(write).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('retains the active choice on storage failure and permits a successful retry', async () => {
    renderSettings();
    await ready();
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    fireEvent.click(screen.getByRole('button', { name: 'Use Owner pack' }));
    expect(screen.getByRole('button', { name: 'Classic active' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Your previous selection is unchanged.');
    expect(screen.queryByText('Owner saved for this browser profile.')).not.toBeInTheDocument();
    write.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: 'Use Owner pack' }));
    await screen.findByRole('button', { name: 'Owner active' });
    expect(screen.queryByText('Your previous selection is unchanged.')).not.toBeInTheDocument();
  });
});
