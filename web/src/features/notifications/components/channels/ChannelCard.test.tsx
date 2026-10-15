/**
 * ChannelCard — full behavioural coverage.
 *
 * ChannelCard renders one configured notification channel: the provider
 * brand (icon/kind), the enabled/disabled state, a masked preview of the
 * channel's credentials, and the Test / Edit / Delete / toggle controls. Each
 * control drives its own scoped mutation and surfaces a toast on success or
 * failure. These specs pin every facet that actually lives in this file:
 *
 *   1. Rendering — name, kind, Active/Disabled badge, provider controls, and
 *      the dimmed styling applied to a disabled channel.
 *   2. Credential preview — explicit credentials including URLs are masked, non-secret
 *      values render verbatim, empty values collapse to an em-dash, a channel
 *      with no exposable config shows a single placeholder, and the preview is
 *      capped at the first three fields.
 *   3. Toggle — the switch fires the toggle mutation with the channel id and
 *      surfaces the correct enable/disable/error toast.
 *   4. Test — the Test button fires the test mutation, toasts provider success,
 *      surfaces the provider's own error message on a rejected test, toasts a
 *      generic failure on a transport error, and reflects the pending state.
 *   5. Edit / Delete — Edit lifts the channel to the parent; Delete fires the
 *      delete mutation, toasts, and disables while pending.
 *   6. Accessibility — the toggle is a labelled switch, the icon-only delete
 *      control carries an accessible name, and provider glyphs are decorative.
 *
 * The three mutation hooks are replaced with controllable doubles (no network
 * is ever touched). react-i18next echoes the English fallback so copy is
 * deterministic, and framer-motion is a passthrough so the real ToastProvider —
 * rendered end-to-end so toasts are asserted against the live DOM — needs no
 * matchMedia.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, renderHook, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import type { NotificationChannel } from '@/api/types';
import { ToastProvider } from '@/components/feedback';
import { ChannelCard } from './ChannelCard';
import { useNotificationChannels } from '@/api/hooks/useNotifications';

// ── Controllable mutation doubles ─────────────────────────────────────────────
type MutateOpts = {
  onSuccess?: (data?: { success?: boolean; error?: string; status_code?: number; latency_ms?: number; signature?: string }) => void;
  onError?: (err?: unknown) => void;
  onSettled?: () => void;
};

const mutations = vi.hoisted(() => ({
  realTest: false,
  realCrud: false,
  togglePending: false,
  deletePending: false,
  testPending: false,
  toggle: vi.fn(),
  del: vi.fn(),
  test: vi.fn(),
  webhookTest: vi.fn(),
}));

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/api/client', () => ({ request: api.request }));

vi.mock('@/api/hooks/useNotifications', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useNotifications')>('@/api/hooks/useNotifications');
  return {
    ...actual,
    useToggleChannel: () => mutations.realCrud
      ? actual.useToggleChannel()
      : { mutate: mutations.toggle, isPending: mutations.togglePending },
    useDeleteChannel: () => mutations.realCrud
      ? actual.useDeleteChannel()
      : { mutate: mutations.del, isPending: mutations.deletePending },
    useTestChannel: () => mutations.realTest
      ? actual.useTestChannel()
      : { mutate: mutations.test, isPending: mutations.testPending },
  };
});

vi.mock('@/api/hooks/useNotificationChannels', () => ({
  useTestWebhookChannel: () => ({ mutate: mutations.webhookTest, isPending: false }),
}));

// ── framer-motion → passthrough (ToastProvider animates its stack) ────────────
vi.mock('framer-motion', () => {
  const MOTION_PROPS = new Set([
    'initial', 'animate', 'exit', 'transition', 'variants', 'whileHover', 'whileTap',
    'whileFocus', 'whileInView', 'whileDrag', 'layout', 'layoutId', 'drag',
    'dragConstraints', 'onAnimationStart', 'onAnimationComplete', 'viewport', 'custom', 'mode',
  ]);
  const strip = (props: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(props)) if (!MOTION_PROPS.has(k)) out[k] = props[k];
    return out;
  };
  return {
    motion: new Proxy(
      {},
      {
        get: () => (props: Record<string, unknown>) => {
          const { children, ...rest } = props as { children?: ReactNode } & Record<string, unknown>;
          return <div {...(strip(rest) as Record<string, unknown>)}>{children as ReactNode}</div>;
        },
      },
    ),
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useReducedMotion: () => false,
  };
});

// ── i18n → echo the English fallback, interpolate {{vars}} ────────────────────
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const translate = (key: string, second?: unknown, third?: unknown): string => {
    let template = key;
    let vars: Record<string, unknown> | undefined;
    if (typeof second === 'string') {
      template = second;
      if (third && typeof third === 'object') vars = third as Record<string, unknown>;
    } else if (second && typeof second === 'object') {
      vars = second as Record<string, unknown>;
      if (typeof vars.defaultValue === 'string') template = vars.defaultValue;
    }
    if (!vars) return template;
    return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
      name in vars! ? String(vars![name]) : `{{${name}}}`,
    );
  };
  return {
    ...actual,
    useTranslation: () => ({ t: translate, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────
const DISCORD: NotificationChannel = {
  id: 1,
  name: 'Team Discord',
  kind: 'discord',
  enabled: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  webhook_url: 'https://discord.com/api/webhooks/abc',
  username: null,
  avatar_url: null,
};

const TELEGRAM: NotificationChannel = {
  id: 2,
  name: 'Alerts Bot',
  kind: 'telegram',
  enabled: true,
  created_at: '2024-01-02T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  bot_token: 'SECRET-TOKEN-123',
  chat_id: '-1001234567890',
};

const EMAIL: NotificationChannel = {
  id: 3,
  name: 'Ops Email',
  kind: 'email',
  enabled: false,
  created_at: '2024-01-03T00:00:00Z',
  updated_at: '2024-01-03T00:00:00Z',
  smtp_host: 'smtp.example.com',
  smtp_port: 587,
  smtp_username: 'alerts@example.com',
  smtp_password: 'hunter2',
  from_address: 'alerts@example.com',
  to_addresses: ['ops@example.com'],
  use_tls: true,
};

const DISCORD_EMPTY: NotificationChannel = { ...DISCORD, id: 4, webhook_url: '' };

// A malformed channel with an unknown kind: getChannelMeta falls back to the
// webhook meta and channelToFormConfig yields nothing, so the preview collapses
// to a single placeholder rather than crashing.
const UNKNOWN = {
  id: 5,
  name: 'Legacy SMS',
  kind: 'sms',
  enabled: true,
  created_at: '2024-01-05T00:00:00Z',
  updated_at: '2024-01-05T00:00:00Z',
} as unknown as NotificationChannel;

function renderCard(channel: NotificationChannel, onEdit = vi.fn()) {
  const utils = render(
    <ToastProvider>
      <ChannelCard channel={channel} onEdit={onEdit} />
    </ToastProvider>,
  );
  return { onEdit, ...utils };
}

beforeEach(() => {
  mutations.realTest = false;
  mutations.realCrud = false;
  api.request.mockReset();
  mutations.togglePending = false;
  mutations.deletePending = false;
  mutations.testPending = false;
  mutations.toggle.mockReset();
  mutations.del.mockReset();
  mutations.test.mockReset();
  mutations.webhookTest.mockReset();
});

// ── 1. Rendering ──────────────────────────────────────────────────────────────
describe('ChannelCard — rendering', () => {
  it('renders the name, kind, Active badge, and every provider control', () => {
    const { container } = renderCard(DISCORD);

    expect(screen.getByRole('heading', { name: 'Team Discord' })).toBeInTheDocument();
    expect(screen.getByText('discord')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();

    const toggle = screen.getByRole('switch', { name: 'Toggle Team Discord' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    expect(screen.getByRole('button', { name: 'Test' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Team Discord' })).toBeInTheDocument();
    // Enabled cards are NOT dimmed.
    expect(container.querySelector('.opacity-60')).toBeNull();
  });

  it('shows the Disabled badge, an unchecked switch, and dims a disabled channel', () => {
    const { container } = renderCard(EMAIL);

    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Toggle Ops Email' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(container.querySelector('.opacity-60')).not.toBeNull();
  });
});

// ── 2. Credential preview ─────────────────────────────────────────────────────
describe('ChannelCard — credential preview', () => {
  it.each<NotificationChannel>([
    DISCORD,
    {
      ...DISCORD, kind: 'slack', name: 'Team Slack',
      webhook_url: 'https://hooks.slack.com/services/SECRET', channel: null,
    },
    {
      id: 6, name: 'Private webhook', kind: 'webhook', enabled: true,
      created_at: 'c', updated_at: 'u',
      url: 'https://receiver.test/SECRET?token=private', method: 'PUT',
      headers: {}, body_template: '',
    },
  ])('masks $kind URLs without changing the channel passed to Edit', (channel) => {
    const { container, onEdit } = renderCard(channel);
    const url = channel.kind === 'webhook' ? channel.url
      : channel.kind === 'discord' || channel.kind === 'slack' ? channel.webhook_url : '';

    expect(screen.getByText('••••••••')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain(url);
    if (channel.kind === 'webhook') {
      expect(screen.getByText('PUT')).toBeInTheDocument();
      expect(screen.getByText('—')).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledWith(channel);
    expect(onEdit.mock.calls[0][0]).toBe(channel);
  });

  it('keeps the ntfy server URL and topic visible', () => {
    renderCard({
      id: 7, name: 'Public ntfy', kind: 'ntfy', enabled: true,
      created_at: 'c', updated_at: 'u',
      server_url: 'https://ntfy.sh', topic: 'teslasync', priority: 3,
      username: null, password: null,
    });

    expect(screen.getByText('https://ntfy.sh')).toBeInTheDocument();
    expect(screen.getByText('teslasync')).toBeInTheDocument();
  });

  it('masks secret fields while showing non-secret values verbatim', () => {
    renderCard(TELEGRAM);

    expect(screen.getByText('bot_token:')).toBeInTheDocument();
    expect(screen.getByText('••••••••')).toBeInTheDocument();
    // The raw secret must never reach the DOM.
    expect(screen.queryByText('SECRET-TOKEN-123')).toBeNull();

    expect(screen.getByText('chat_id:')).toBeInTheDocument();
    expect(screen.getByText('-1001234567890')).toBeInTheDocument();
  });

  it('renders an em-dash for an empty credential value', () => {
    renderCard(DISCORD_EMPTY);

    expect(screen.getByText('webhook_url:')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('https://discord.com/api/webhooks/abc')).toBeNull();
    expect(screen.queryByText('••••••••')).toBeNull();
  });

  it('shows a single placeholder when a channel exposes no config', () => {
    renderCard(UNKNOWN);

    expect(screen.getByRole('heading', { name: 'Legacy SMS' })).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    // No key/value rows are rendered for an unmapped kind.
    expect(screen.queryByText(/:$/)).toBeNull();
  });

  it('caps the preview at the first three credential fields', () => {
    renderCard(EMAIL);

    expect(screen.getByText('smtp_host:')).toBeInTheDocument();
    expect(screen.getByText('smtp_port:')).toBeInTheDocument();
    expect(screen.getByText('smtp_username:')).toBeInTheDocument();
    // Fields four onward are omitted — including the secret smtp_password.
    expect(screen.queryByText('smtp_password:')).toBeNull();
    expect(screen.queryByText('from_address:')).toBeNull();
    expect(screen.queryByText('to_addresses:')).toBeNull();
  });
});

// ── 3. Toggle ─────────────────────────────────────────────────────────────────
describe('ChannelCard — toggle', () => {
  it.each([
    { action: 'toggle', control: 'switch', name: 'Toggle Team Discord', title: 'Channel disabled', failure: 'Failed to toggle channel', path: '/notifications/1/toggle', method: 'POST' },
    { action: 'delete', control: 'button', name: 'Delete Team Discord', title: 'Channel deleted', failure: 'Failed to delete channel', path: '/notifications/1', method: 'DELETE' },
  ] as const)('emits exactly one toast per real $action attempt and retains failure recovery', async ({ control, name, title, failure, path, method }) => {
    mutations.realCrud = true;
    api.request
      .mockRejectedValueOnce(new Error('Provider unavailable'))
      .mockResolvedValueOnce({ ...DISCORD, enabled: false });
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <ChannelCard channel={DISCORD} onEdit={vi.fn()} />
        </ToastProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole(control, { name }));
    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent(failure);
    expect(error).toHaveTextContent('Provider unavailable');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole(control, { name })).toBeEnabled());
    fireEvent.click(within(error).getByRole('button', { name: 'Dismiss notification' }));

    fireEvent.click(screen.getByRole(control, { name }));
    expect(await screen.findByRole('status')).toHaveTextContent(title);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(api.request).toHaveBeenCalledTimes(2);
    expect(api.request).toHaveBeenLastCalledWith(path, { method });
    expect(screen.getByRole('heading', { name: DISCORD.name })).toBeInTheDocument();
    client.clear();
  });

  it('disables only the switch while its toggle mutation is pending', () => {
    mutations.togglePending = true;
    const { onEdit } = renderCard(DISCORD);

    const toggle = screen.getByRole('switch', { name: 'Toggle Team Discord' });
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(mutations.toggle).not.toHaveBeenCalled();
    for (const name of ['Test', 'Edit', 'Delete Team Discord']) {
      const action = screen.getByRole('button', { name });
      expect(action).toBeEnabled();
      fireEvent.click(action);
    }
    expect(mutations.test).toHaveBeenCalledWith(1, expect.any(Object));
    expect(onEdit).toHaveBeenCalledWith(DISCORD);
    expect(mutations.del).toHaveBeenCalledWith(1, expect.any(Object));
  });

  it.each(['success', 'error'] as const)('latches repeated clicks until %s settles and then permits retry', (outcome) => {
    let callbacks: MutateOpts | undefined;
    mutations.toggle.mockImplementation((_id: number, opts: MutateOpts) => {
      callbacks = opts;
    });
    renderCard(DISCORD);
    const toggle = screen.getByRole('switch', { name: 'Toggle Team Discord' });

    act(() => {
      fireEvent.click(toggle);
      fireEvent.click(toggle);
    });
    expect(mutations.toggle).toHaveBeenCalledTimes(1);
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    act(() => {
      if (outcome === 'success') callbacks?.onSuccess?.();
      else callbacks?.onError?.();
      callbacks?.onSettled?.();
    });
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);
    expect(mutations.toggle).toHaveBeenCalledTimes(2);
  });

  it('keeps other channel switches and this channel actions independent of the latch', () => {
    const onEdit = vi.fn();
    render(
      <ToastProvider>
        <ChannelCard channel={DISCORD} onEdit={onEdit} />
        <ChannelCard channel={TELEGRAM} onEdit={onEdit} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle Team Discord' }));
    const otherToggle = screen.getByRole('switch', { name: 'Toggle Alerts Bot' });
    expect(otherToggle).toBeEnabled();
    fireEvent.click(otherToggle);
    expect(mutations.toggle.mock.calls.map(([id]) => id)).toEqual([1, 2]);

    const card = screen.getByRole('heading', { name: DISCORD.name }).closest('.flex-col');
    expect(card).not.toBeNull();
    const actions = within(card as HTMLElement);
    for (const name of ['Test', 'Edit', 'Delete Team Discord']) {
      const action = actions.getByRole('button', { name });
      expect(action).toBeEnabled();
      fireEvent.click(action);
    }
    expect(mutations.test).toHaveBeenCalledWith(1, expect.any(Object));
    expect(onEdit).toHaveBeenCalledWith(DISCORD);
    expect(mutations.del).toHaveBeenCalledWith(1, expect.any(Object));
  });

  it('allows toggling while unrelated channel mutations are pending', () => {
    mutations.testPending = true;
    mutations.deletePending = true;
    renderCard(DISCORD);
    const toggle = screen.getByRole('switch', { name: 'Toggle Team Discord' });
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);
    expect(mutations.toggle).toHaveBeenCalledTimes(1);
  });

  it('fires the toggle mutation with the channel id exactly once', () => {
    renderCard(DISCORD);
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle Team Discord' }));

    expect(mutations.toggle).toHaveBeenCalledTimes(1);
    expect(mutations.toggle).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('toasts "Channel disabled" after turning an enabled channel off', async () => {
    mutations.toggle.mockImplementation((_id: number, opts: MutateOpts) => opts.onSuccess?.());
    renderCard(DISCORD);
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle Team Discord' }));

    expect(await screen.findByText('Channel disabled')).toBeInTheDocument();
  });

  it('toasts "Channel enabled" after turning a disabled channel on', async () => {
    mutations.toggle.mockImplementation((_id: number, opts: MutateOpts) => opts.onSuccess?.());
    renderCard(EMAIL);
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle Ops Email' }));

    expect(await screen.findByText('Channel enabled')).toBeInTheDocument();
  });

  it('surfaces an assertive error toast when the toggle fails', async () => {
    mutations.toggle.mockImplementation((_id: number, opts: MutateOpts) => opts.onError?.());
    renderCard(DISCORD);
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle Team Discord' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to toggle channel');
  });
});

// ── 4. Test ───────────────────────────────────────────────────────────────────
describe('ChannelCard — test', () => {
  it('rejects a fulfilled provider failure, emits one detailed toast, and recovers on retry', async () => {
    mutations.realTest = true;
    api.request
      .mockResolvedValueOnce({ success: false, error: 'Provider rejected delivery' })
      .mockResolvedValueOnce({ success: true, error: '' });
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <ChannelCard channel={DISCORD} onEdit={vi.fn()} />
        </ToastProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    const failure = await screen.findByRole('alert');
    expect(failure).toHaveTextContent('Provider rejected delivery');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(client.getMutationCache().getAll()[0].state.status).toBe('error');
    expect(client.getMutationCache().getAll()[0].state.error).toEqual(new Error('Provider rejected delivery'));
    fireEvent.click(within(failure).getByRole('button', { name: 'Dismiss notification' }));

    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Team Discord: Test sent!');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(api.request).toHaveBeenCalledTimes(2);
    expect(api.request).toHaveBeenLastCalledWith('/notifications/1/test', { method: 'POST' });
    client.clear();
  });

  it('retains transport error details and permits retry', async () => {
    mutations.test.mockImplementation((_id: number, opts: MutateOpts) =>
      opts.onError?.(new Error('HTTP 503: provider unavailable')),
    );
    renderCard(DISCORD);
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 503: provider unavailable');
    expect(screen.getByRole('button', { name: 'Test' })).toBeEnabled();
  });

  it.each([
    { success: true, role: 'status', title: 'Team Discord: Test sent!' },
    { success: false, role: 'alert', title: 'Team Discord: Test failed' },
  ])('preserves dismissible $role feedback through the shared barrel', async ({ success, role, title }) => {
    mutations.test.mockImplementation((_id: number, opts: MutateOpts) => {
      if (success) opts.onSuccess?.({ success });
      else opts.onError?.(new Error('Provider rejected delivery'));
    });

    renderCard(DISCORD);
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    const toast = await screen.findByRole(role);
    expect(toast).toHaveTextContent(title);
    if (!success) expect(toast).toHaveTextContent('Provider rejected delivery');
    fireEvent.click(within(toast).getByRole('button', { name: 'Dismiss notification' }));

    expect(screen.queryByRole(role)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: DISCORD.name })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test' })).toBeEnabled();
    expect(mutations.test).toHaveBeenCalledWith(DISCORD.id, expect.any(Object));
  });

  it('uses signed delivery for a webhook and displays the response status', async () => {
    const webhook: NotificationChannel = {
      id: 41, name: 'Ops hook', kind: 'webhook', enabled: true,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      url: 'https://example.test/events', method: 'POST', headers: {}, body_template: '',
    };
    mutations.webhookTest.mockImplementation((_vars: unknown, opts: MutateOpts) =>
      opts.onSuccess?.({ success: true, status_code: 202, latency_ms: 8, signature: 'sha256=preview' }),
    );
    renderCard(webhook);
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(mutations.webhookTest).toHaveBeenCalledWith({ id: 41 }, expect.anything());
    expect(mutations.test).not.toHaveBeenCalled();
    expect(await screen.findByText(/Status 202/)).toBeInTheDocument();
    expect(screen.getByText('sha256=preview')).toBeInTheDocument();
  });
  it('fires the test mutation and toasts provider success', async () => {
    mutations.test.mockImplementation((_id: number, opts: MutateOpts) =>
      opts.onSuccess?.({ success: true }),
    );
    renderCard(DISCORD);
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    expect(mutations.test).toHaveBeenCalledWith(1, expect.any(Object));
    expect(await screen.findByText('Team Discord: Test sent!')).toBeInTheDocument();
  });

  it("surfaces the provider's error message when a test is rejected", async () => {
    mutations.test.mockImplementation((_id: number, opts: MutateOpts) =>
      opts.onError?.(new Error('invalid webhook signature')),
    );
    renderCard(DISCORD);
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    expect(await screen.findByText('Team Discord: Test failed')).toBeInTheDocument();
    expect(screen.getByText('invalid webhook signature')).toBeInTheDocument();
  });

  it('toasts a generic failure when the test request errors out', async () => {
    mutations.test.mockImplementation((_id: number, opts: MutateOpts) => opts.onError?.(new Error()));
    renderCard(DISCORD);
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Team Discord: Test failed');
  });

  it('reflects the pending state on the Test control', () => {
    mutations.testPending = true;
    renderCard(DISCORD);

    const btn = screen.getByRole('button', { name: /Testing/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });
});

describe('notification channels — source states', () => {
  function setup() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return { client, ...renderHook(() => useNotificationChannels(), { wrapper }) };
  }

  it('distinguishes active loading from a successful empty result', async () => {
    let resolve!: (channels: NotificationChannel[]) => void;
    api.request.mockImplementation(() => new Promise<NotificationChannel[]>(done => { resolve = done; }));
    const source = setup();
    expect(source.result.current.isLoading).toBe(true);
    expect(source.result.current.data).toBeUndefined();
    await act(async () => resolve([]));
    await waitFor(() => expect(source.result.current.isSuccess).toBe(true));
    expect(source.result.current.data).toEqual([]);
    expect(source.result.current.isLoading).toBe(false);
    source.unmount();
    source.client.clear();
  });

  it('keeps paused-without-data distinct from active loading and resumes', async () => {
    onlineManager.setOnline(false);
    const source = setup();
    try {
      expect(source.result.current.fetchStatus).toBe('paused');
      expect(source.result.current.isLoading).toBe(false);
      expect(source.result.current.data).toBeUndefined();
      expect(api.request).not.toHaveBeenCalled();
      api.request.mockResolvedValue([]);
      act(() => onlineManager.setOnline(true));
      await waitFor(() => expect(source.result.current.isSuccess).toBe(true));
      expect(source.result.current.data).toEqual([]);
    } finally {
      onlineManager.setOnline(true);
      source.unmount();
      source.client.clear();
    }
  });

  it('retains confirmed zero values through refresh failure and recovery', async () => {
    const zeroChannel: NotificationChannel = { ...EMAIL, smtp_port: 0 };
    api.request.mockResolvedValueOnce([zeroChannel]);
    const source = setup();
    await waitFor(() => expect(source.result.current.isSuccess).toBe(true));
    expect(source.result.current.data).toEqual([zeroChannel]);

    api.request.mockRejectedValueOnce(new Error('Refresh unavailable'));
    await act(async () => { await source.result.current.refetch(); });
    await waitFor(() => expect(source.result.current.isRefetchError).toBe(true));
    expect(source.result.current.data).toEqual([zeroChannel]);
    expect(source.result.current.error?.message).toBe('Refresh unavailable');

    api.request.mockResolvedValueOnce([]);
    await act(async () => { await source.result.current.refetch(); });
    await waitFor(() => expect(source.result.current.isSuccess).toBe(true));
    expect(source.result.current.data).toEqual([]);
    expect(source.result.current.error).toBeNull();
    source.unmount();
    source.client.clear();
  });
});

// ── 5. Edit & Delete ──────────────────────────────────────────────────────────
describe('ChannelCard — edit & delete', () => {
  it('lifts the channel to onEdit when Edit is pressed', () => {
    const { onEdit } = renderCard(DISCORD);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(DISCORD);
  });

  it('fires the delete mutation and toasts success', async () => {
    mutations.del.mockImplementation((_id: number, opts: MutateOpts) => opts.onSuccess?.());
    renderCard(DISCORD);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Team Discord' }));

    expect(mutations.del).toHaveBeenCalledWith(1, expect.any(Object));
    expect(await screen.findByText('Channel deleted')).toBeInTheDocument();
  });

  it('surfaces an error toast when delete fails', async () => {
    mutations.del.mockImplementation((_id: number, opts: MutateOpts) => opts.onError?.());
    renderCard(DISCORD);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Team Discord' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to delete channel');
  });

  it('disables the Delete control while the delete mutation is pending', () => {
    mutations.deletePending = true;
    renderCard(DISCORD);

    const del = screen.getByRole('button', { name: 'Delete Team Discord' });
    expect(del).toBeDisabled();
    expect(del).toHaveAttribute('aria-busy', 'true');
  });
});

// ── 6. Accessibility ──────────────────────────────────────────────────────────
describe('ChannelCard — accessibility', () => {
  it('exposes the toggle as a labelled switch reflecting the enabled state', () => {
    renderCard(TELEGRAM);
    const toggle = screen.getByRole('switch', { name: 'Toggle Alerts Bot' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('gives the icon-only delete button an accessible name and hides decorative glyphs', () => {
    const { container } = renderCard(TELEGRAM);
    expect(screen.getByRole('button', { name: 'Delete Alerts Bot' })).toBeInTheDocument();
    // The provider + action glyphs are decorative and hidden from assistive tech.
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThan(0);
  });
});
