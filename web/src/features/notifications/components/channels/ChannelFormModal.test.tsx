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
 *      placeholder, moves the `aria-checked` state, and clears prior config.
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
  saveMutate: vi.fn(),
  testMutate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  pending: { save: false, test: false },
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
      t: (key: string, fallback?: unknown) => resolve(key, fallback),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

vi.mock('@/api/hooks/useNotifications', () => ({
  useSaveChannel: () => ({ mutate: h.saveMutate, isPending: h.pending.save }),
  useTestChannel: () => ({ mutate: h.testMutate, isPending: h.pending.test }),
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

function setValue(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  h.saveMutate.mockReset();
  h.testMutate.mockReset();
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
});

describe('ChannelFormModal — create mode', () => {
  it('renders the 7-provider radiogroup with Discord preselected and no test button', () => {
    renderModal();

    expect(screen.getByRole('heading', { name: 'Add Channel' })).toBeInTheDocument();

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(7);
    expect(screen.getByRole('radio', { name: 'Discord' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Slack' })).toHaveAttribute('aria-checked', 'false');

    // Discord's single credential field is shown; email-only fields are not.
    expect(screen.getByLabelText('Webhook URL')).toBeInTheDocument();
    expect(screen.queryByLabelText('SMTP Host')).toBeNull();

    // Test Connection only exists when editing an existing channel.
    expect(screen.queryByRole('button', { name: 'Test Connection' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });

  it('switches provider: swaps fields, moves aria-checked, and updates the name placeholder', () => {
    renderModal();

    fireEvent.click(screen.getByRole('radio', { name: 'Email' }));

    expect(screen.getByRole('radio', { name: 'Email' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Discord' })).toHaveAttribute('aria-checked', 'false');

    // Email credential fields appear; the Discord webhook field is gone.
    expect(screen.getByLabelText('SMTP Host')).toBeInTheDocument();
    expect(screen.getByLabelText('SMTP Port')).toBeInTheDocument();
    expect(screen.getByLabelText('From Address')).toBeInTheDocument();
    expect(screen.queryByLabelText('Webhook URL')).toBeNull();

    // Placeholder tracks the selected provider label.
    expect(screen.getByPlaceholderText('My Email')).toBeInTheDocument();
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

  it('rejects an empty name inline and never mutates', () => {
    renderModal();

    submitForm();

    expect(screen.getByRole('alert')).toHaveTextContent('Name is required');
    expect(h.saveMutate).not.toHaveBeenCalled();
  });

  it('builds a discord payload without an id and calls onSaved on success', () => {
    const { onSaved } = renderModal();

    setValue('Channel Name', 'My Bot');
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

    setValue('Channel Name', 'Muted');
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

    setValue('Channel Name', 'Doomed');
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
    setValue('Channel Name', 'Unsaved channel');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const confirm = await screen.findByRole('dialog', { name: 'Unsaved changes' });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe('ChannelFormModal — edit mode', () => {
  it('hides the picker, prefills fields, and relabels the primary action', () => {
    renderModal({ channel: discordChannel });

    expect(screen.getByRole('heading', { name: 'Edit Channel' })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByLabelText('Channel Name')).toHaveValue('Ops Discord');
    expect(screen.getByLabelText('Webhook URL')).toHaveValue('https://discord.com/api/webhooks/abc');
    expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
  });

  it('sends a test, shows the success status panel, and fires a success toast', () => {
    renderModal({ channel: discordChannel });

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));

    expect(h.testMutate).toHaveBeenCalledWith(7, expect.anything());
    expect(screen.getByRole('status')).toHaveTextContent('Test notification sent successfully!');
    expect(h.toastSuccess).toHaveBeenCalledWith('Test sent!');
  });

  it('shows a provider-reported failure message and an error toast', () => {
    h.testMutate.mockImplementation((_id: number, opts?: MutateOptions<TestResponse>) => {
      opts?.onSuccess?.({ success: false, error: 'Invalid webhook' });
    });
    renderModal({ channel: discordChannel });

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));

    expect(screen.getByRole('status')).toHaveTextContent('Invalid webhook');
    expect(h.toastError).toHaveBeenCalledWith('Test failed', 'Invalid webhook');
  });

  it('falls back to a generic failure on a network error', () => {
    h.testMutate.mockImplementation((_id: number, opts?: MutateOptions<TestResponse>) => {
      opts?.onError?.(new Error('network down'));
    });
    renderModal({ channel: discordChannel });

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));

    expect(screen.getByRole('status')).toHaveTextContent('Test failed');
    expect(h.toastError).toHaveBeenCalledWith('Test failed');
  });
});
