/**
 * ChannelFormModal — behavioural coverage for the notification-channel
 * create/edit dialog.
 *
 * The modal is the only export in the source file. These tests exercise it
 * through its public surface (props + rendered DOM) and, transitively, the
 * `channelMeta` helpers it composes (`getChannelMeta`, `channelToFormConfig`,
 * `buildChannelPayload`). Every branch that matters for the UX is covered:
 *
 *   1. Create mode renders the 7-provider radiogroup with Discord preselected
 *      and no "Test Connection" affordance.
 *   2. Switching provider swaps the credential fields, updates the name
 *      placeholder, moves the native checked state, and clears prior config.
 *   3. Submitting with an empty name is rejected inline and never mutates.
 *   4. A valid submit builds the correct discriminated payload (no `id` when
 *      creating) and calls `onSaved` on success.
 *   5. A save failure surfaces the error inline and does NOT call `onSaved`.
 *   6. Edit mode hides the picker, prefills fields from the stored channel,
 *      and relabels the primary action to "Update".
 *   7/8/9. "Test Connection" success, provider-reported failure, and network
 *      error each render the right status panel and fire the matching toast.
 *   10. The enabled toggle is reflected in the built payload.
 *   11. Cancel calls `onClose`.
 *   12. The pending save state disables + relabels the submit button.
 *
 * Network + toasts are mocked at module scope so the suite never touches the
 * API client or TanStack cache. i18n is mocked to echo each `t(key, fallback)`
 * fallback (and the `{ defaultValue }` option form used by <HelpIcon>) so
 * assertions read against the English copy.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ComponentProps, type ReactNode } from 'react';

// framer-motion (via <FadeIn>) reads prefers-reduced-motion through
// window.matchMedia, which jsdom does not implement. Install a no-op stub
// before the component tree mounts — mirrors the guard used across the suite.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

// Shared spies + mutable pending flags, hoisted so the vi.mock factories
// below can close over them safely (no temporal-dead-zone hazard).
const h = vi.hoisted(() => ({
  realTest: false,
  request: vi.fn(),
  saveMutate: vi.fn(),
  testMutate: vi.fn(),
  webhookTestMutate: vi.fn(),
  signatureMutate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  pending: { save: false, test: false },
  translations: {} as Record<string, string>,
}));

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const resolve = (key: string, fallback?: unknown): string => {
    if (typeof fallback === 'string') return fallback;
    if (fallback && typeof fallback === 'object' && 'defaultValue' in fallback) {
      const dv = (fallback as { defaultValue?: unknown }).defaultValue;
      return typeof dv === 'string' ? dv : key;
    }
    return key;
  };
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
        const text = h.translations[key] ?? resolve(key, fallback);
        return text.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
          options?.[name] !== undefined ? String(options[name]) : match);
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

vi.mock('@/api/client', () => ({ request: h.request }));

vi.mock('@/api/hooks/useNotifications', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useNotifications')>('@/api/hooks/useNotifications');
  return {
    ...actual,
    useSaveChannel: () => ({ mutate: h.saveMutate, isPending: h.pending.save }),
    useTestChannel: () => h.realTest
      ? actual.useTestChannel()
      : { mutate: h.testMutate, isPending: h.pending.test },
  };
});

vi.mock('@/api/hooks/useNotificationChannels', () => ({
  useTestWebhookChannel: () => ({ mutate: h.webhookTestMutate, isPending: false }),
  useWebhookSignaturePreview: () => ({ mutateAsync: h.signatureMutate, isPending: false }),
}));

vi.mock('@/components/feedback/Toast', () => {
  const api = {
    success: h.toastSuccess,
    error: h.toastError,
    info: vi.fn(),
    warning: vi.fn(),
    toast: vi.fn(),
    dismiss: vi.fn(),
  };
  return {
    useToast: () => api,
    useOptionalToast: () => api,
    ToastProvider: ({ children }: { children: ReactNode }) => children,
  };
});

import { ChannelFormModal } from './ChannelFormModal';
import type { NotificationChannel } from '@/api/types';

type MutateOptions<T> = {
  onSuccess?: (data: T) => void;
  onError?: (err: unknown) => void;
};
type TestResponse = { success: boolean; error?: string };

const discordChannel: NotificationChannel = {
  id: 7,
  name: 'Ops Discord',
  kind: 'discord',
  enabled: true,
  created_at: '2020-01-01T00:00:00Z',
  updated_at: '2020-01-01T00:00:00Z',
  webhook_url: 'https://discord.com/api/webhooks/abc',
  username: null,
  avatar_url: null,
};

function renderModal(props: Partial<ComponentProps<typeof ChannelFormModal>> = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(<ChannelFormModal channel={null} onClose={onClose} onSaved={onSaved} {...props} />);
  return { onClose, onSaved };
}

/** Submit the modal's <form> directly (jsdom does not implicitly submit on click). */
function submitForm() {
  const form = document.querySelector('form');
  if (!form) throw new Error('modal form not found');
  fireEvent.submit(form);
}

function setValue(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  h.translations = {};
  h.realTest = false;
  h.request.mockReset();
  h.saveMutate.mockReset();
  h.testMutate.mockReset();
  h.webhookTestMutate.mockReset();
  h.signatureMutate.mockReset();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.pending.save = false;
  h.pending.test = false;
  // Default happy paths: save resolves, test reports success.
  h.saveMutate.mockImplementation((_payload: unknown, opts?: MutateOptions<NotificationChannel>) => {
    opts?.onSuccess?.(discordChannel);
  });
  h.testMutate.mockImplementation((_id: number, opts?: MutateOptions<TestResponse>) => {
    opts?.onSuccess?.({ success: true });
  });
  h.webhookTestMutate.mockImplementation((_id: number, opts?: MutateOptions<TestResponse>) => {
    opts?.onSuccess?.({ success: true });
  });
  h.signatureMutate.mockResolvedValue({ signature: 'sha256=example' });
});

describe('ChannelFormModal — create mode', () => {
  it('translates metadata consumers and interpolates the translated provider without changing field values', () => {
    h.translations = {
      'notifications.channels.providerNames.webhook': 'Point de terminaison',
      'notifications.channels.namePlaceholder': '{{provider}} personnel',
      'notifications.channels.providerConfiguration': 'Configuration de {{provider}}',
      'notifications.channels.fields.signingSecret': 'Secret de signature',
      'notifications.channels.placeholders.signingSecret': 'Facultatif pour la signature HMAC',
    };
    renderModal();
    fireEvent.click(screen.getByRole('radio', { name: 'Point de terminaison' }));
    expect(screen.getByPlaceholderText('Point de terminaison personnel')).toBeInTheDocument();
    expect(screen.getByText('Configuration de Point de terminaison')).toBeInTheDocument();
    expect(screen.getByLabelText('Secret de signature')).toHaveAttribute('placeholder', 'Facultatif pour la signature HMAC');
    setValue('Channel name', 'Automation');
    setValue(/^URL/, 'https://receiver.example.test/events');
    setValue('Secret de signature', 'sample-secret');
    submitForm();
    expect(h.saveMutate).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'webhook', name: 'Automation', bearer_token: 'sample-secret',
    }), expect.anything());
  });

  it('renders the 7-provider radiogroup with Discord preselected and no test button', () => {
    renderModal();

    expect(screen.getByRole('heading', { name: 'Add channel' })).toBeInTheDocument();

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(7);
    expect(screen.getByRole('radio', { name: 'Discord' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Slack' })).not.toBeChecked();

    // Discord's single credential field is shown; email-only fields are not.
    expect(screen.getByLabelText('Webhook URL')).toBeInTheDocument();
    expect(screen.queryByLabelText('SMTP host')).toBeNull();

    // Test Connection only exists when editing an existing channel.
    expect(screen.queryByRole('button', { name: 'Test connection' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });

  it('switches provider: swaps fields, moves checked state, and updates the name placeholder', () => {
    renderModal();

    fireEvent.click(screen.getByRole('radio', { name: 'Email' }));

    expect(screen.getByRole('radio', { name: 'Email' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Discord' })).not.toBeChecked();

    // Email credential fields appear; the Discord webhook field is gone.
    expect(screen.getByLabelText('SMTP host')).toBeInTheDocument();
    expect(screen.getByLabelText('SMTP port')).toBeInTheDocument();
    expect(screen.getByLabelText('From address')).toBeInTheDocument();
    expect(screen.queryByLabelText('Webhook URL')).toBeNull();

    // Placeholder tracks the selected provider label.
    expect(screen.getByPlaceholderText('My Email')).toBeInTheDocument();
  });

  it('creates a signed webhook from Add Channel without unsupported template fields', () => {
    renderModal();
    fireEvent.click(screen.getByRole('radio', { name: 'Webhook' }));
    setValue('Channel name', 'Automation hook');
    setValue(/^URL/, 'https://receiver.example.test/events');
    setValue('Signing secret', 'sample-secret');
    fireEvent.change(screen.getByLabelText('HTTP method'), { target: { value: 'PUT' } });
    expect(screen.queryByLabelText('Headers (JSON)')).toBeNull();
    expect(screen.queryByLabelText('Body Template')).toBeNull();
    submitForm();
    expect(h.saveMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'webhook',
        url: 'https://receiver.example.test/events',
        method: 'PUT',
        bearer_token: 'sample-secret',
      }),
      expect.anything(),
    );
  });

  it('preserves native metadata types and validates only the active provider controls', async () => {
    const user = userEvent.setup();
    renderModal();
    setValue('Channel name', 'Provider validation');
    const discordUrl = screen.getByLabelText<HTMLInputElement>('Webhook URL');
    expect(discordUrl).toHaveAttribute('type', 'url');
    expect(discordUrl).not.toBeRequired();
    setValue('Webhook URL', 'not-a-url');
    expect(discordUrl.validity.typeMismatch).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(h.saveMutate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('radio', { name: 'Email' }));
    const sender = screen.getByLabelText<HTMLInputElement>('From address');
    expect(sender).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Recipients (comma-separated)')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('SMTP password')).toHaveAttribute('type', 'password');
    setValue('From address', 'not-an-email');
    expect(sender.validity.typeMismatch).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(h.saveMutate).not.toHaveBeenCalled();
    setValue('SMTP host', 'smtp.example.com');
    setValue('From address', 'alerts@example.com');
    setValue('Recipients (comma-separated)', 'ops@example.com, team@example.com');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(h.saveMutate).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'email', from_address: 'alerts@example.com',
      to_addresses: ['ops@example.com', 'team@example.com'],
    }), expect.anything());
  });

  it('requires the webhook URL but not its secret, and clears scoped validation on provider change', async () => {
    const user = userEvent.setup();
    renderModal();
    setValue('Channel name', 'Webhook validation');
    await user.click(screen.getByRole('radio', { name: 'Webhook' }));
    expect(screen.getByLabelText(/^URL/)).toHaveAttribute('type', 'url');
    expect(screen.getByLabelText(/^URL/)).toBeRequired();
    expect(screen.getByLabelText('Signing secret')).not.toBeRequired();
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(h.saveMutate).not.toHaveBeenCalled();
    setValue(/^URL/, 'ftp://receiver.example.com');
    submitForm();
    expect(screen.getByRole('alert')).toHaveTextContent('URL must start with http:// or https://.');
    expect(h.saveMutate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('radio', { name: 'Telegram' }));
    expect(screen.queryByRole('alert')).toBeNull();
    setValue('Bot token', '123:ABC');
    setValue('Chat ID', '-1001');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(h.saveMutate).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'telegram', bot_token: '123:ABC', chat_id: '-1001',
    }), expect.anything());
  });

  it('does not erase an existing webhook secret on edit and tests via signed delivery', () => {
    const webhook: NotificationChannel = {
      id: 44,
      kind: 'webhook',
      name: 'Custom receiver',
      enabled: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      url: 'https://receiver.example.test/events',
      method: 'POST',
      headers: {},
      body_template: '',
    };
    renderModal({ channel: webhook });
    expect(screen.getByText('Leave the signing secret blank to keep the existing secret.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(h.webhookTestMutate).toHaveBeenCalledWith({ id: 44 }, expect.anything());
    expect(h.testMutate).not.toHaveBeenCalled();
    submitForm();
    expect(h.saveMutate.mock.calls[0][0]).not.toHaveProperty('bearer_token', 'sample-secret');
  });

  it('clears previously-entered config when switching providers', () => {
    renderModal();

    setValue('Webhook URL', 'https://discord.com/api/webhooks/keep-me');
    expect(screen.getByLabelText('Webhook URL')).toHaveValue('https://discord.com/api/webhooks/keep-me');

    fireEvent.click(screen.getByRole('radio', { name: 'Slack' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Discord' }));

    // Round-tripping through another provider resets the config map.
    expect(screen.getByLabelText('Webhook URL')).toHaveValue('');
  });

  it('supports native keyboard selection and wrapping while resetting provider credentials', async () => {
    const user = userEvent.setup();
    renderModal();
    const group = screen.getByRole('radiogroup', { name: 'Channel type' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map(radio => radio.getAttribute('value'))).toEqual([
      'discord', 'slack', 'telegram', 'email', 'webhook', 'ntfy', 'pushover',
    ]);
    for (const radio of radios) {
      expect(radio).toHaveAttribute('type', 'radio');
      expect(radio).toHaveAttribute('name', 'channel-type');
    }

    setValue('Channel name', 'Keyboard channel');
    setValue('Webhook URL', 'https://discord.com/api/webhooks/old');
    const discord = within(group).getByRole('radio', { name: 'Discord' });
    discord.focus();
    await user.keyboard('{ArrowRight}');
    const slack = within(group).getByRole('radio', { name: 'Slack' });
    expect(slack).toHaveFocus();
    expect(slack).toBeChecked();
    expect(discord).not.toBeChecked();
    expect(screen.getByLabelText('Webhook URL')).toHaveValue('');
    expect(screen.getByPlaceholderText('My Slack')).toBeInTheDocument();

    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    const pushover = within(group).getByRole('radio', { name: 'Pushover' });
    expect(pushover).toHaveFocus();
    expect(pushover).toBeChecked();
    await user.keyboard('{ArrowRight}');
    expect(discord).toHaveFocus();
    expect(discord).toBeChecked();
    expect(screen.getByLabelText('Webhook URL')).toHaveValue('');
    expect(screen.getByLabelText('Channel name')).toHaveValue('Keyboard channel');
    expect(h.saveMutate).not.toHaveBeenCalled();
  });

  it('rejects an empty name inline and never mutates', () => {
    renderModal();

    submitForm();

    expect(screen.getByRole('alert')).toHaveTextContent('Name is required');
    expect(h.saveMutate).not.toHaveBeenCalled();
  });

  it('builds a discord payload without an id and calls onSaved on success', () => {
    const { onSaved } = renderModal();

    setValue('Channel name', 'My Bot');
    setValue('Webhook URL', 'https://discord.com/api/webhooks/xyz');
    submitForm();

    expect(h.saveMutate).toHaveBeenCalledTimes(1);
    expect(h.saveMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'discord',
        name: 'My Bot',
        enabled: true,
        webhook_url: 'https://discord.com/api/webhooks/xyz',
      }),
      expect.anything(),
    );
    // Creating must not smuggle an id into the payload.
    expect(h.saveMutate.mock.calls[0][0]).not.toHaveProperty('id');
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('includes the disabled toggle state in the built payload', () => {
    renderModal();

    setValue('Channel name', 'Muted');
    setValue('Webhook URL', 'https://discord.com/api/webhooks/q');

    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    submitForm();

    expect(h.saveMutate).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
      expect.anything(),
    );
  });

  it('surfaces a save error inline and does not call onSaved', () => {
    h.saveMutate.mockImplementation((_payload: unknown, opts?: MutateOptions<NotificationChannel>) => {
      opts?.onError?.(new Error('Boom'));
    });
    const { onSaved } = renderModal();

    setValue('Channel name', 'Doomed');
    submitForm();

    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('disables and relabels the submit button while a save is pending', () => {
    h.pending.save = true;
    renderModal();

    const saving = screen.getByRole('button', { name: /Saving/ });
    expect(saving).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Create' })).toBeNull();
  });

  it('calls onClose when Cancel is clicked', () => {
    const { onClose } = renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('requires confirmation before cancelling an edited channel draft', async () => {
    const { onClose } = renderModal();
    setValue('Channel name', 'Unsaved channel');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const confirm = await screen.findByRole('dialog', { name: 'Unsaved changes' });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe('ChannelFormModal — edit mode', () => {
  it('preserves a real provider rejection inline with one named toast and retries successfully', async () => {
    h.realTest = true;
    h.request
      .mockResolvedValueOnce({ success: false, error: 'Provider rejected delivery' })
      .mockResolvedValueOnce({ success: true });
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ChannelFormModal channel={discordChannel} onClose={vi.fn()} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Provider rejected delivery');
    expect(h.toastError).toHaveBeenCalledExactlyOnceWith('Ops Discord: Test failed', 'Provider rejected delivery');
    expect(h.toastSuccess).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Test connection' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledExactlyOnceWith('Ops Discord: Test sent!'));
    expect(screen.getByRole('status')).toHaveTextContent('Test notification sent successfully!');
    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(h.request).toHaveBeenCalledTimes(2);
    expect(h.request).toHaveBeenLastCalledWith('/notifications/7/test', { method: 'POST' });
    client.clear();
  });

  it.each<NotificationChannel>([
    { ...discordChannel, username: 'Delivery bot', avatar_url: 'https://example.com/avatar.png' },
    { id: 7, name: 'Ops Slack', kind: 'slack', enabled: true, created_at: '2020-01-01T00:00:00Z', updated_at: '2020-01-01T00:00:00Z', webhook_url: 'https://hooks.slack.com/services/xyz', channel: '#ops', username: 'Alerts' },
    {
      id: 8, name: 'Email', kind: 'email', enabled: true, created_at: 'c', updated_at: 'u',
      smtp_host: 'smtp.example.com', smtp_port: 2525, smtp_username: 'ops',
      smtp_password: 'credential', from_address: 'alerts@example.com',
      to_addresses: ['ops@example.com'], use_tls: false,
    },
    {
      id: 9, name: 'Hook', kind: 'webhook', enabled: true, created_at: 'c', updated_at: 'u',
      url: 'https://receiver.example.com', method: 'PUT',
      headers: { 'X-Routing': 'ops' }, body_template: '{"text":"{{message}}"}',
    },
    {
      id: 10, name: 'ntfy', kind: 'ntfy', enabled: true, created_at: 'c', updated_at: 'u',
      server_url: 'https://ntfy.example.com', topic: 'ops', priority: 5,
      username: 'ops', password: 'credential',
    },
    {
      id: 11, name: 'Push', kind: 'pushover', enabled: true, created_at: 'c', updated_at: 'u',
      user_key: 'user', app_token: 'app', device: 'phone', priority: -2,
    },
  ])('retains unexposed $kind config when renaming and disabling an existing channel', (channel) => {
    renderModal({ channel });
    setValue('Channel name', 'Renamed');
    fireEvent.click(screen.getByRole('switch'));
    submitForm();

    const { created_at, updated_at, ...expected } = channel;
    void created_at;
    void updated_at;
    expect(h.saveMutate.mock.calls[0][0]).toEqual({ ...expected, name: 'Renamed', enabled: false });
    expect(screen.queryByLabelText('Headers (JSON)')).toBeNull();
    expect(screen.queryByLabelText('Body Template')).toBeNull();
  });

  it('hides the picker, prefills fields, and relabels the primary action', () => {
    renderModal({ channel: discordChannel });

    expect(screen.getByRole('heading', { name: 'Edit channel' })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByLabelText('Channel name')).toHaveValue('Ops Discord');
    expect(screen.getByLabelText('Webhook URL')).toHaveValue('https://discord.com/api/webhooks/abc');
    expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
  });

  it('sends a test, shows the success status panel, and fires a success toast', () => {
    renderModal({ channel: discordChannel });

    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(h.testMutate).toHaveBeenCalledWith(7, expect.anything());
    expect(screen.getByRole('status')).toHaveTextContent('Test notification sent successfully!');
    expect(h.toastSuccess).toHaveBeenCalledExactlyOnceWith('Ops Discord: Test sent!');
  });

  it('shows a provider-reported failure message and an error toast', () => {
    h.testMutate.mockImplementation((_id: number, opts?: MutateOptions<TestResponse>) => {
      opts?.onSuccess?.({ success: false, error: 'Invalid webhook' });
    });
    renderModal({ channel: discordChannel });

    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(screen.getByRole('status')).toHaveTextContent('Invalid webhook');
    expect(h.toastError).toHaveBeenCalledExactlyOnceWith('Ops Discord: Test failed', 'Invalid webhook');
  });

  it('retains the failure reason inline and in one named toast, then recovers on retry', () => {
    h.testMutate.mockImplementation((_id: number, opts?: MutateOptions<TestResponse>) => {
      opts?.onError?.(new Error('network down'));
    });
    renderModal({ channel: discordChannel });

    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(screen.getByRole('status')).toHaveTextContent('network down');
    expect(h.toastError).toHaveBeenCalledExactlyOnceWith('Ops Discord: Test failed', 'network down');
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Webhook URL')).toHaveValue(discordChannel.webhook_url);
    h.testMutate.mockImplementation((_id: number, opts?: MutateOptions<TestResponse>) => {
      opts?.onSuccess?.({ success: true });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(screen.getByRole('status')).toHaveTextContent('Test notification sent successfully!');
    expect(screen.getByRole('status')).not.toHaveTextContent('network down');
    expect(h.toastSuccess).toHaveBeenCalledExactlyOnceWith('Ops Discord: Test sent!');
    expect(h.toastError).toHaveBeenCalledTimes(1);
  });
});
