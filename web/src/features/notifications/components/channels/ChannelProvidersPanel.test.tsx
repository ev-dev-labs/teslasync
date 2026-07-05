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
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import '../../../../i18n';

import { ChannelProvidersPanel } from './ChannelProvidersPanel';
import { CHANNEL_TYPES } from './channelMeta';
import type { NotificationChannel, NotificationChannelKind } from '@/api/types';

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
