/**
 * ChannelProvidersPanel tests — the provider reference grid derived from the
 * static CHANNEL_TYPES catalog + the live channels list.
 *
 * Pins:
 *  - the full catalog always renders as a list (never a blank panel), even
 *    with zero / undefined channels;
 *  - per-kind counts, the "N of M provider types in use" summary, and the
 *    configured / not-configured captions;
 *  - the success count chip is decorative (aria-hidden) and provider icons are
 *    hidden from assistive tech;
 *  - null / kind-less / unknown-kind rows are tolerated without crashing and
 *    never inflate the in-use tally (the null-safety hardening).
 *
 * The panel takes no network — it's pure props — so no QueryClient/Router is
 * needed. The side-effect i18n import initialises translations so `t(key,
 * default)` resolves to the English fallbacks (these keys aren't in en.json).
 */
import { vi, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import '../../../../i18n';

import { ChannelProvidersPanel } from './ChannelProvidersPanel';
import { CHANNEL_TYPES } from './channelMeta';
import type { NotificationChannel, NotificationChannelKind } from '@/api/types';
import { deriveDataState } from '@/api/dataState';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));

// Locale-provider regressions require the real context-aware hook.
vi.unmock('react-i18next');

// The panel only reads `.kind` off each channel, so a minimal cast-through
// stub is sufficient and keeps the fixtures readable across all seven kinds.
function ch(kind: NotificationChannelKind, id = 1): NotificationChannel {
  return {
    id,
    name: `${kind}-${id}`,
    kind,
    enabled: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as unknown as NotificationChannel;
}

/** The row (`<li>`) whose provider label matches `label`. */
function rowFor(label: string): HTMLElement {
  const el = screen.getByText(label).closest('li');
  if (!el) throw new Error(`no provider row for "${label}"`);
  return el as HTMLElement;
}

const ALL_LABELS = ['Discord', 'Slack', 'Telegram', 'Email', 'Webhook', 'ntfy', 'Pushover'];

describe('ChannelProvidersPanel', () => {
  it('translates provider labels while preserving populated counts and English fallbacks', async () => {
    const locale = createInstance();
    await locale.init({
      lng: 'fr',
      fallbackLng: false,
      resources: { fr: { translation: {
        notifications: { channels: { providerNames: { email: 'Courriel' } } },
      } } },
    });
    render(
      <I18nextProvider i18n={locale}>
        <ChannelProvidersPanel channels={[ch('email', 1), ch('email', 2), ch('discord', 3)]} />
      </I18nextProvider>,
    );
    expect(within(rowFor('Courriel')).getByText('2 configured')).toBeInTheDocument();
    expect(within(rowFor('Discord')).getByText('1 configured')).toBeInTheDocument();
    expect(screen.getByText('2 of 7 provider types in use')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(CHANNEL_TYPES.length);
  });

  it('renders the full provider catalog as a list, even with zero channels', () => {
    render(<ChannelProvidersPanel channels={[]} />);

    expect(
      screen.getByRole('heading', { name: /supported providers/i }),
    ).toBeInTheDocument();
    // One list item per catalog entry — the panel is never blank.
    expect(screen.getAllByRole('listitem')).toHaveLength(CHANNEL_TYPES.length);
    for (const label of ALL_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('summarises "0 of N in use" and marks every provider Not configured when empty', () => {
    render(<ChannelProvidersPanel channels={[]} />);

    expect(
      screen.getByText(`0 of ${CHANNEL_TYPES.length} provider types in use`),
    ).toBeInTheDocument();
    // Every row shows the not-configured caption…
    expect(screen.getAllByText('Not configured')).toHaveLength(CHANNEL_TYPES.length);
    // …and no row shows a standalone numeric count chip.
    expect(screen.queryByText(/^\d+$/)).toBeNull();
  });

  it('counts channels per kind and reflects the number in the caption + chip', () => {
    render(
      <ChannelProvidersPanel
        channels={[ch('discord', 1), ch('discord', 2), ch('slack', 3)]}
      />,
    );

    const discord = rowFor('Discord');
    expect(within(discord).getByText('2 configured')).toBeInTheDocument();
    expect(within(discord).getByText('2')).toBeInTheDocument(); // the chip

    const slack = rowFor('Slack');
    expect(within(slack).getByText('1 configured')).toBeInTheDocument();
    expect(within(slack).getByText('1')).toBeInTheDocument();

    // An untouched provider stays "Not configured" with no chip.
    const email = rowFor('Email');
    expect(within(email).getByText('Not configured')).toBeInTheDocument();
    expect(within(email).queryByText(/^\d+$/)).toBeNull();
  });

  it('summarises the number of distinct provider types in use', () => {
    render(
      <ChannelProvidersPanel
        channels={[ch('discord', 1), ch('discord', 2), ch('slack', 3)]}
      />,
    );

    // 2 distinct kinds (discord, slack) out of the full catalog.
    expect(
      screen.getByText(`2 of ${CHANNEL_TYPES.length} provider types in use`),
    ).toBeInTheDocument();
  });

  it('exposes the count chip as decorative (aria-hidden) and hides provider icons from AT', () => {
    render(<ChannelProvidersPanel channels={[ch('telegram', 1)]} />);

    const telegram = rowFor('Telegram');
    const chip = within(telegram).getByText('1');
    expect(chip).toHaveAttribute('aria-hidden', 'true');
    // The visible caption remains the accessible source of truth for the count.
    expect(within(telegram).getByText('1 configured')).toBeInTheDocument();
    // The brand icon is decorative and must not be announced.
    expect(telegram.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('is null-safe when channels is undefined (renders the empty catalog)', () => {
    render(
      <ChannelProvidersPanel
        channels={undefined as unknown as NotificationChannel[]}
      />,
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(CHANNEL_TYPES.length);
    expect(
      screen.getByText(`0 of ${CHANNEL_TYPES.length} provider types in use`),
    ).toBeInTheDocument();
  });

  it('tolerates malformed rows (null / kind-less / unknown kind) without crashing', () => {
    const dirty = [
      null,
      undefined,
      { kind: 'discord' }, // valid kind, other fields missing
      { name: 'no-kind' }, // kind-less row
      { kind: 'totally-unknown' }, // unknown kind — ignored, not a catalog row
    ] as unknown as NotificationChannel[];

    render(<ChannelProvidersPanel channels={dirty} />);

    // The single valid discord row is counted; null/kind-less rows are skipped.
    const discord = rowFor('Discord');
    expect(within(discord).getByText('1 configured')).toBeInTheDocument();
    // An unknown kind must not inflate the in-use tally or add a row.
    expect(
      screen.getByText(`1 of ${CHANNEL_TYPES.length} provider types in use`),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(CHANNEL_TYPES.length);
    expect(screen.queryByText('totally-unknown')).toBeNull();
  });
});


describe('ChannelProvidersPanel source trust', () => {
  it.each([
    { name: 'loading', query: { data: undefined, isLoading: true, fetchStatus: 'fetching' as const }, message: 'Provider counts will appear when the channel registry finishes loading.' },
    { name: 'paused', query: { data: undefined, isPending: true, fetchStatus: 'paused' as const }, message: 'Provider counts are unknown while the channel registry refresh is paused.' },
    { name: 'failed', query: { data: undefined, error: new Error('Registry unavailable') }, message: 'Provider counts are unavailable because the channel registry could not be loaded.' },
  ])('keeps the complete catalog but does not invent counts for $name reads', ({ query, message }) => {
    const retry = vi.fn();
    const source = deriveDataState<NotificationChannel[]>({ ...query, refetch: retry });
    render(<MemoryRouter><ChannelProvidersPanel channels={[]} source={source} /></MemoryRouter>);
    expect(screen.getAllByRole('listitem')).toHaveLength(CHANNEL_TYPES.length);
    for (const label of ALL_LABELS) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByText(`0 of ${CHANNEL_TYPES.length} provider types in use`)).not.toBeInTheDocument();
    expect(screen.queryByText('Not configured')).not.toBeInTheDocument();
    if (source.fatalError) {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(retry).toHaveBeenCalledOnce();
    }
  });

  it.each([
    { name: 'populated failed refresh', channels: [ch('discord')], error: new Error('Refresh failed') },
    { name: 'empty failed refresh', channels: [], error: new Error('Refresh failed') },
    { name: 'populated paused refresh', channels: [ch('discord')], fetchStatus: 'paused' as const },
    { name: 'empty paused refresh', channels: [], fetchStatus: 'paused' as const },
  ])('retains authoritative counts during $name and clears the warning on recovery', ({ channels, ...query }) => {
    const retry = vi.fn();
    const source = deriveDataState({ data: channels, ...query, refetch: retry });
    const { rerender } = render(<MemoryRouter><ChannelProvidersPanel channels={channels} source={source} /></MemoryRouter>);
    const count = channels.length > 0 ? 1 : 0;
    expect(screen.getByText(`${count} of ${CHANNEL_TYPES.length} provider types in use`)).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getAllByRole('listitem')).toHaveLength(CHANNEL_TYPES.length);
    rerender(<MemoryRouter><ChannelProvidersPanel channels={channels} source={deriveDataState({ data: channels })} /></MemoryRouter>);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByText(`${count} of ${CHANNEL_TYPES.length} provider types in use`)).toBeInTheDocument();
    if (count) expect(within(rowFor('Discord')).getByText('1 configured')).toBeInTheDocument();
    else expect(screen.getAllByText('Not configured')).toHaveLength(CHANNEL_TYPES.length);
  });
});
