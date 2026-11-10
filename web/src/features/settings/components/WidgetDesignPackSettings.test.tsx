import { createHash, webcrypto } from 'node:crypto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastProvider } from '@/components/feedback';
import WidgetDesignPackSettings from './WidgetDesignPackSettings';
import { PACK_MANIFEST } from '@/features/dashboard/widgets/designPacks/manifest';

const mocks = vi.hoisted(() => ({
  mode: vi.fn(),
  request: vi.fn(),
  eventSource: vi.fn(),
  packId: 'classic',
  appWide: false,
  scope: '',
  failSave: false,
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ToastProvider><WidgetDesignPackSettings /></ToastProvider></QueryClientProvider>);
}

async function ready() {
  await screen.findByRole('button', { name: 'Classic active' });
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('EventSource', mocks.eventSource);
  mocks.mode.mockReset();
  mocks.mode.mockResolvedValue({ isSuccess: true, data: { mode: 'forward_auth', subject: 'preview-viewer' } });
  mocks.request.mockReset();
  mocks.packId = 'classic';
  mocks.appWide = false;
  mocks.scope = createHash('sha256').update('forward_auth:preview-viewer').digest('hex');
  mocks.failSave = false;
  mocks.request.mockImplementation(async (path: string, options?: { method?: string; body?: string }) => {
    if (path !== '/settings/widget-design-pack') throw new Error('Preview must not read vehicle APIs');
    if (options?.method === 'PUT') {
      if (mocks.failSave) throw new Error('Server unavailable');
      const body = JSON.parse(options.body ?? '{}') as { pack_id: string; app_wide?: boolean };
      mocks.packId = body.pack_id;
      if (body.app_wide !== undefined) mocks.appWide = body.app_wide;
    }
    return { pack_id: mocks.packId, app_wide: mocks.appWide, scope: mocks.scope };
  });
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
    renderSettings();
    const retry = await screen.findByRole('button', { name: 'Retry preference' });
    expect(screen.getByRole('button', { name: 'Use Owner pack' })).toBeDisabled();
    mocks.mode.mockResolvedValue({ isSuccess: true, data: { mode: 'open' } });
    mocks.scope = createHash('sha256').update('open').digest('hex');
    await act(async () => fireEvent.click(retry));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Use Owner pack' })).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('does not claim an active preference or allow writes before identity is verified', async () => {
    let resolve!: (value: unknown) => void;
    mocks.mode.mockReturnValue(new Promise(done => { resolve = done; }));
    renderSettings();
    expect(screen.getAllByRole('button', { name: /^Preview / })).toHaveLength(27);
    for (const button of screen.getAllByRole('button', { name: /^Use .* pack$/ })) {
      expect(button).toBeDisabled();
    }
    expect(screen.queryByRole('button', { name: / active$/ })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Apply design to' })).toBeDisabled();
    expect(localStorage.length).toBe(0);
    resolve({ isSuccess: true, data: { mode: 'forward_auth', subject: 'preview-viewer' } });
    await ready();
  });

  it('previews every real presentation without saving, vehicle readers or commands', async () => {
    renderSettings();
    await ready();
    const write = vi.spyOn(Storage.prototype, 'setItem');
    for (const entry of PACK_MANIFEST) {
      const { default: en } = await import('@/i18n/en.json');
      const name = en.dashboard.designPacks[entry.id].name;
      const opener = screen.getByRole('button', { name: `Preview ${name}` });
      opener.focus();
      fireEvent.click(opener);
      const dialog = await screen.findByRole('dialog', { name: `Preview ${name}` });
      await within(dialog).findByRole('heading', { name: 'Commands' }, { timeout: 10_000 });
      await waitFor(() => expect(within(dialog).queryByText('Loading preview...')).not.toBeInTheDocument());
      expect(dialog.querySelector('[data-widget-pack-preview]')).toHaveAttribute('data-widget-pack-preview', entry.id);
      expect(dialog.querySelectorAll(`[data-surface-variant="standalone"][data-widget-pack="${entry.id}"]`)).toHaveLength(5);
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
      expect(mocks.request.mock.calls.every(([path, options]) =>
        path === '/settings/widget-design-pack' && options?.method !== 'PUT')).toBe(true);
      expect(mocks.eventSource).not.toHaveBeenCalled();
      fireEvent.keyDown(dialog, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await waitFor(() => expect(opener).toHaveFocus());
    }
    expect(mocks.mode).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Classic active' })).toBeDisabled();
  }, 60_000);

  it('saves stable IDs to the server without changing browser appearance preferences', async () => {
    localStorage.setItem('unrelated-appearance-preference', 'unchanged');
    renderSettings();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Use Owner pack' }));
    await screen.findByRole('button', { name: 'Owner active' });
    expect(mocks.request).toHaveBeenCalledWith('/settings/widget-design-pack', expect.objectContaining({
      method: 'PUT', body: JSON.stringify({ pack_id: 'v4' }),
    }));
    expect(localStorage.getItem('unrelated-appearance-preference')).toBe('unchanged');
    expect(Object.keys(localStorage).some(key => key.startsWith('teslasync.widget-design-pack.'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Use Cyberdeck pack' }));
    await screen.findByRole('button', { name: 'Cyberdeck active' });
    expect(mocks.packId).toBe('cyber');
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
    expect(mocks.request.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
  });

  it('explicitly enables app scope, retains it when switching designs and restores widgets without changing the pack', async () => {
    renderSettings();
    await ready();
    const scope = screen.getByRole('combobox', { name: 'Apply design to' });
    expect(scope).toHaveValue('widgets');
    fireEvent.change(scope, { target: { value: 'app' } });
    await waitFor(() => expect(scope).toHaveValue('app'));
    expect(mocks.request).toHaveBeenCalledWith('/settings/widget-design-pack', expect.objectContaining({
      method: 'PUT', body: JSON.stringify({ pack_id: 'classic', app_wide: true }),
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Use Material Play pack' }));
    await screen.findByRole('button', { name: 'Material Play active' });
    expect(scope).toHaveValue('app');
    mocks.failSave = true;
    fireEvent.change(scope, { target: { value: 'widgets' } });
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(scope).toHaveValue('app');
    mocks.failSave = false;
    fireEvent.change(scope, { target: { value: 'widgets' } });
    await waitFor(() => expect(scope).toHaveValue('widgets'));
    expect(mocks.packId).toBe('material');
  });

  it('retains the confirmed choice on server failure and permits a successful retry', async () => {
    renderSettings();
    await ready();
    mocks.failSave = true;
    fireEvent.click(screen.getByRole('button', { name: 'Use Owner pack' }));
    expect(screen.getByRole('button', { name: 'Classic active' })).toBeDisabled();
    await waitFor(() => expect(screen.getAllByRole('alert').some(alert =>
      alert.textContent?.includes('Your last confirmed selection remains visible.'))).toBe(true));
    mocks.failSave = false;
    fireEvent.click(screen.getByRole('button', { name: 'Use Owner pack' }));
    await screen.findByRole('button', { name: 'Owner active' });
    expect(screen.queryByText('Your last confirmed selection remains visible.')).not.toBeInTheDocument();
  });

  it('groups all packs by visual style instead of rollout status', async () => {
    renderSettings();
    await ready();
    const style = screen.getByRole('combobox', { name: 'Design style' });
    expect(within(style).getAllByRole('option').map(option => option.textContent)).toEqual([
      'All styles (27)', 'Minimal & Editorial (6)', 'Soft & Atmospheric (5)',
      'Technical & Instrumental (9)', 'Bold & Geometric (7)',
    ]);
    expect(screen.queryByRole('combobox', { name: 'Collection' })).not.toBeInTheDocument();
    const groups = [
      ['minimal', ['Classic', 'Precision', 'Owner', 'Editorial', 'Quiet Form', 'Swiss Grid']],
      ['soft', ['Elevated', 'Iconic', 'Ambient', 'Warm Modern', 'Glass Current']],
      ['technical', ['Studio', 'Pixel', 'Motorsport', 'Blueprint', 'Terminal', 'Atlas', 'Analog', 'Observatory', 'Cyberdeck']],
      ['geometric', ['Expressive', 'Bauhaus', 'Material Play', 'Deco Grand', 'Kinetic Type', 'Neo Brutal', 'Memphis Pop']],
    ] as const;
    for (const [value, names] of groups) {
      fireEvent.change(style, { target: { value } });
      expect(screen.getAllByRole('button', { name: /^Preview / }).map(button =>
        button.getAttribute('aria-label'))).toEqual(names.map(name => `Preview ${name}`));
      expect(screen.getByRole('combobox', { name: 'Design intensity' })).toBeEnabled();
    }
    fireEvent.change(style, { target: { value: 'all' } });
    expect(screen.getAllByRole('button', { name: /^Preview / })).toHaveLength(27);
    expect(screen.getByRole('button', { name: 'Classic active' })).toBeDisabled();
    expect(mocks.request.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
  });

  it('combines style and intensity filters with a reset for empty results without saving a selection', async () => {
    renderSettings();
    await ready();
    const style = screen.getByRole('combobox', { name: 'Design style' });
    const intensity = screen.getByRole('combobox', { name: 'Design intensity' });
    fireEvent.change(intensity, { target: { value: 'extreme' } });
    expect(screen.getAllByRole('button', { name: /^Preview / })).toHaveLength(3);
    fireEvent.change(style, { target: { value: 'technical' } });
    expect(screen.getAllByRole('button', { name: /^Preview / })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Preview Cyberdeck' })).toBeVisible();
    fireEvent.change(style, { target: { value: 'geometric' } });
    expect(screen.getAllByRole('button', { name: /^Preview / })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Preview Neo Brutal' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Preview Memphis Pop' })).toBeVisible();
    fireEvent.change(style, { target: { value: 'minimal' } });
    expect(intensity).toHaveValue('extreme');
    expect(intensity).toBeEnabled();
    expect(screen.queryByRole('button', { name: /^Preview / })).not.toBeInTheDocument();
    expect(screen.getByText('No packs match these style and intensity filters.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Show all designs' }));
    expect(style).toHaveValue('all');
    expect(intensity).toHaveValue('all');
    expect(screen.getAllByRole('button', { name: /^Preview / })).toHaveLength(27);
    expect(screen.getByRole('button', { name: 'Classic active' })).toBeDisabled();
    expect(mocks.request.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
  });
});
