/**
 * ChannelStatsBand — full behavioural coverage.
 *
 * The band has exactly two branches and one derived value, and every one is
 * pinned here:
 *
 *   1. Loaded — the four KPI cards render with their English labels, the
 *      sent / failed / pending counts come straight off the stats payload, and
 *      the "Active Channels" card renders the enabled/total ratio. A dedicated
 *      spec proves the "Total Sent" card reads `sent` (successful deliveries)
 *      and NOT the misnamed `total_sent` (which is really the grand total of
 *      every log) — swapping the two would be a silent regression.
 *   2. Loading — when the query is in flight with no cached stats the band
 *      swaps the cards for a four-cell skeleton wrapped in a labelled
 *      `role="status"` `aria-busy` region (so assistive tech announces the
 *      wait), and none of the metric labels leak through. A background refetch
 *      (isLoading true but stats already cached) keeps the cards up rather than
 *      flashing back to the skeleton — the `!stats` guard.
 *   3. Null safety — an undefined payload degrades every count to `0` and the
 *      ratio to `0/0` (never blank, never `NaN`), and individually-missing
 *      numeric fields fall back to `0` field-by-field.
 *   4. Accessibility — the four lucide glyphs are decorative and hidden from
 *      assistive tech.
 *
 * `@/components/data-display` (pulled in via MetricCard) drags motion-driven
 * siblings into the module graph, so framer-motion is stubbed to a passthrough
 * to keep module load hermetic in jsdom. react-i18next echoes the English
 * fallback so copy is deterministic without booting the real catalog.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { NotificationStats } from '@/api/types';

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: () => (props: Record<string, unknown>) => {
        const Component = (props.as as string) ?? 'div';
        const { children, ...rest } = props as { children?: unknown } & Record<string, unknown>;
        return <Component {...(rest as Record<string, unknown>)}>{children as ReactNode}</Component>;
      },
    },
  ),
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useReducedMotion: () => true,
  useInView: () => true,
  useMotionValue: (v: unknown) => ({ get: () => v, set: vi.fn(), on: vi.fn() }),
  useSpring: (v: unknown) => ({ get: () => v, set: vi.fn(), on: vi.fn() }),
  useTransform: () => ({ get: () => 0, set: vi.fn(), on: vi.fn() }),
  animate: vi.fn(() => ({ stop: vi.fn() })),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

import { ChannelStatsBand } from './ChannelStatsBand';

// Every rendered figure is distinct so getByText is unambiguous. `total_sent`
// is deliberately a value that appears nowhere else on screen — the band must
// never render it (it reads `sent`, not `total_sent`).
const FULL: NotificationStats = {
  total_sent: 52,
  sent: 42,
  failed: 7,
  pending: 3,
  total_channels: 8,
  enabled_channels: 5,
};

describe('ChannelStatsBand — loaded', () => {
  it('renders all four KPI cards with their English labels', () => {
    render(<ChannelStatsBand stats={FULL} isLoading={false} />);

    expect(screen.getByText('Total Sent')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Active Channels')).toBeInTheDocument();
  });

  it('renders the sent / failed / pending counts and the enabled/total ratio', () => {
    render(<ChannelStatsBand stats={FULL} isLoading={false} />);

    expect(screen.getByText('42')).toBeInTheDocument(); // sent
    expect(screen.getByText('7')).toBeInTheDocument(); // failed
    expect(screen.getByText('3')).toBeInTheDocument(); // pending
    expect(screen.getByText('5/8')).toBeInTheDocument(); // enabled/total
  });

  it('reads `sent` (successful deliveries), never the misnamed `total_sent`', () => {
    render(<ChannelStatsBand stats={FULL} isLoading={false} />);

    // total_sent (52) is the grand total of every log and must not surface.
    expect(screen.queryByText('52')).not.toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('shows no loading skeleton once stats have resolved', () => {
    render(<ChannelStatsBand stats={FULL} isLoading={false} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('ChannelStatsBand — loading', () => {
  it('swaps the cards for a labelled, busy skeleton region while loading', () => {
    const { container } = render(<ChannelStatsBand stats={undefined} isLoading />);

    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(region).toHaveAttribute('aria-label', 'Loading notification statistics');
    // Four skeleton cells, and none of the metric labels leak through.
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(4);
    expect(screen.queryByText('Total Sent')).not.toBeInTheDocument();
  });

  it('keeps cached cards up during a background refetch (isLoading + stats)', () => {
    // isLoading is true but stats are already cached: the `!stats` guard keeps
    // the cards on screen instead of flashing back to the skeleton.
    render(<ChannelStatsBand stats={FULL} isLoading />);

    expect(screen.getByText('Total Sent')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('ChannelStatsBand — null safety', () => {
  it('degrades every count to 0 and the ratio to 0/0 for an undefined payload', () => {
    render(<ChannelStatsBand stats={undefined} isLoading={false} />);

    // Not the skeleton (not loading) and not blank — three zeroed counts…
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getAllByText('0')).toHaveLength(3);
    // …plus the degraded ratio, and the labels still render.
    expect(screen.getByText('0/0')).toBeInTheDocument();
    expect(screen.getByText('Active Channels')).toBeInTheDocument();
  });

  it('falls back to 0 for individually-missing numeric fields', () => {
    // Only `sent` is present; every other figure must independently degrade.
    const partial = { sent: 9 } as unknown as NotificationStats;
    render(<ChannelStatsBand stats={partial} isLoading={false} />);

    expect(screen.getByText('9')).toBeInTheDocument(); // sent survives
    expect(screen.getAllByText('0')).toHaveLength(2); // failed + pending
    expect(screen.getByText('0/0')).toBeInTheDocument(); // enabled/total
  });
});

describe('ChannelStatsBand — accessibility', () => {
  it('marks all four metric glyphs as decorative', () => {
    const { container } = render(<ChannelStatsBand stats={FULL} isLoading={false} />);

    // One lucide icon per card, each hidden from assistive tech.
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(4);
  });
});
