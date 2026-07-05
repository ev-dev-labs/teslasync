/**
 * ChannelsGrid tests.
 *
 * ChannelsGrid is the state-machine wrapper around the configured-channels
 * bento: it owns the loading / error / empty branches and, in the happy path,
 * renders one ChannelCard per channel while threading the edit callback down.
 * These tests pin every branch and the props it must forward:
 *
 *   1. Happy path — one card per channel, preserving order, inside a list with
 *      an accessible name; the per-card edit action fires onEdit with the
 *      exact channel it belongs to.
 *   2. Loading — the initial load renders an accessible aria-busy status and
 *      NO cards, but a background refetch (loading while cached data exists)
 *      keeps the channels on screen instead of flashing skeletons.
 *   3. Empty — the "no channels" state renders and its Add CTA fires onAdd.
 *   4. Error — a failed query renders a retryable alert wired to onRetry and
 *      takes precedence over the loading state.
 *   5. Hardening regressions — an `isError` with a nullish `error` still
 *      renders a visible error (no blank panel) and undefined `channels`
 *      degrades to the empty state instead of throwing.
 *
 * The child ChannelCard (which owns mutation hooks + toasts + network) is
 * mocked to a thin stub so this suite stays a focused, network-free unit test
 * of ChannelsGrid's own orchestration. i18n is the real instance so the
 * rendered copy matches production.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

import { ChannelsGrid } from './ChannelsGrid';
import type { NotificationChannel } from '@/api/types';

// Stub the child: surface just enough (the channel id + name and an edit
// affordance wired to onEdit) to assert ChannelsGrid forwards the right props.
vi.mock('./ChannelCard', () => ({
  ChannelCard: ({
    channel,
    onEdit,
  }: {
    channel: NotificationChannel;
    onEdit: (channel: NotificationChannel) => void;
  }) => (
    <div data-testid="channel-card" data-channel-id={channel.id}>
      <span>{channel.name}</span>
      <button type="button" onClick={() => onEdit(channel)}>
        {`edit-${channel.id}`}
      </button>
    </div>
  ),
}));

function makeChannel(id: number, name: string, enabled = true): NotificationChannel {
  return {
    id,
    name,
    kind: 'discord',
    enabled,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    webhook_url: 'https://discord.com/api/webhooks/abc',
    username: null,
    avatar_url: null,
  };
}

interface Overrides {
  channels?: NotificationChannel[];
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
}

function renderGrid(overrides: Overrides = {}) {
  const onRetry = vi.fn();
  const onEdit = vi.fn();
  const onAdd = vi.fn();
  const utils = render(
    <MemoryRouter>
      <ChannelsGrid
        channels={overrides.channels ?? []}
        isLoading={overrides.isLoading ?? false}
        isError={overrides.isError ?? false}
        error={'error' in overrides ? overrides.error : null}
        onRetry={onRetry}
        onEdit={onEdit}
        onAdd={onAdd}
      />
    </MemoryRouter>,
  );
  return { ...utils, onRetry, onEdit, onAdd };
}

describe('ChannelsGrid', () => {
  it('renders one ChannelCard per channel, preserving order', () => {
    renderGrid({
      channels: [
        makeChannel(1, 'Discord Ops'),
        makeChannel(2, 'Slack Alerts'),
        makeChannel(3, 'Email Fallback'),
      ],
    });
    const cards = screen.getAllByTestId('channel-card');
    expect(cards).toHaveLength(3);
    expect(cards.map((c) => c.getAttribute('data-channel-id'))).toEqual(['1', '2', '3']);
    expect(screen.getByText('Discord Ops')).toBeInTheDocument();
    expect(screen.getByText('Email Fallback')).toBeInTheDocument();
  });

  it('exposes the channel list with an accessible name and one item per channel', () => {
    renderGrid({ channels: [makeChannel(1, 'Discord Ops'), makeChannel(2, 'Slack Alerts')] });
    const list = screen.getByRole('list', { name: /configured channels/i });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  });

  it('threads onEdit down to the card carrying the corresponding channel', () => {
    const target = makeChannel(2, 'Slack Alerts');
    const { onEdit } = renderGrid({ channels: [makeChannel(1, 'Discord Ops'), target] });
    fireEvent.click(screen.getByRole('button', { name: 'edit-2' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(target);
  });

  it('shows an accessible aria-busy skeleton state on the initial load', () => {
    renderGrid({ isLoading: true, channels: [] });
    const status = screen.getByRole('status', { name: /loading channels/i });
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryAllByTestId('channel-card')).toHaveLength(0);
  });

  it('keeps rendering channels during a background refetch (loading with cached data)', () => {
    renderGrid({
      isLoading: true,
      channels: [makeChannel(1, 'Discord Ops'), makeChannel(2, 'Slack Alerts')],
    });
    // Cached data stays visible instead of flashing skeletons…
    expect(screen.getAllByTestId('channel-card')).toHaveLength(2);
    // …and no busy/skeleton region is shown over it.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders the empty state and wires the Add CTA when there are no channels', () => {
    const { onAdd } = renderGrid({ channels: [], isLoading: false });
    expect(screen.getByText('No channels configured')).toBeInTheDocument();
    expect(
      screen.getByText(/Add a notification channel to start receiving alerts/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /add channel/i }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByTestId('channel-card')).toHaveLength(0);
  });

  it('renders a retryable error alert and wires onRetry', () => {
    const { onRetry } = renderGrid({ isError: true, error: new Error('boom'), channels: [] });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByTestId('channel-card')).toHaveLength(0);
  });

  it('prioritises the error state over the loading skeletons', () => {
    renderGrid({ isError: true, error: new Error('down'), isLoading: true });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /loading channels/i })).not.toBeInTheDocument();
  });

  it('still renders a visible error when isError is true but no error object is supplied', () => {
    // Regression guard: QueryError renders nothing for a falsy error, which
    // previously left a blank panel. ChannelsGrid now falls back to a real
    // Error so the failure is always visible and retryable.
    const { onRetry } = renderGrid({ isError: true, error: null, channels: [] });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('treats undefined channels as empty without crashing', () => {
    const onAdd = vi.fn();
    render(
      <MemoryRouter>
        <ChannelsGrid
          channels={undefined as unknown as NotificationChannel[]}
          isLoading={false}
          isError={false}
          error={null}
          onRetry={vi.fn()}
          onEdit={vi.fn()}
          onAdd={onAdd}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('No channels configured')).toBeInTheDocument();
    expect(screen.queryAllByTestId('channel-card')).toHaveLength(0);
  });
});
