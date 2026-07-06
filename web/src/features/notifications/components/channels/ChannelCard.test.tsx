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
 *   2. Credential preview — secrets (token/key/password) are masked, non-secret
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
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { NotificationChannel } from '@/api/types';
import { ToastProvider } from '@/components/feedback/Toast';
import { ChannelCard } from './ChannelCard';

// ── Controllable mutation doubles ─────────────────────────────────────────────
type MutateOpts = {
  onSuccess?: (data?: { success?: boolean; error?: string }) => void;
  onError?: (err?: unknown) => void;
};

const mutations = vi.hoisted(() => ({
  togglePending: false,
  deletePending: false,
  testPending: false,
  toggle: vi.fn(),
  del: vi.fn(),
  test: vi.fn(),
}));

vi.mock('@/api/hooks/useNotifications', () => ({
  useToggleChannel: () => ({ mutate: mutations.toggle, isPending: mutations.togglePending }),
  useDeleteChannel: () => ({ mutate: mutations.del, isPending: mutations.deletePending }),
  useTestChannel: () => ({ mutate: mutations.test, isPending: mutations.testPending }),
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
  mutations.togglePending = false;
  mutations.deletePending = false;
  mutations.testPending = false;
  mutations.toggle.mockReset();
  mutations.del.mockReset();
  mutations.test.mockReset();
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
      opts.onSuccess?.({ success: false, error: 'invalid webhook signature' }),
    );
    renderCard(DISCORD);
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    expect(await screen.findByText('Team Discord: Test failed')).toBeInTheDocument();
    expect(screen.getByText('invalid webhook signature')).toBeInTheDocument();
  });

  it('toasts a generic failure when the test request errors out', async () => {
    mutations.test.mockImplementation((_id: number, opts: MutateOpts) => opts.onError?.());
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
