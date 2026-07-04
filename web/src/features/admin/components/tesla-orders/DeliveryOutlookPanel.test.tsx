/**
 * DeliveryOutlookPanel unit suite.
 *
 * Covers the panel's full behaviour surface — never a smoke render and never
 * the real network:
 *
 *   • State-invariant chrome — the "Delivery Outlook" heading + its decorative
 *     (aria-hidden) icon render in EVERY status, because the header lives
 *     outside the per-section state switch (design-language §8).
 *   • loading  — skeleton placeholder, metrics withheld.
 *   • error    — retriable QueryError; the Retry CTA invokes `onRetry`.
 *   • empty    — guidance copy + caller icon, no metrics.
 *   • ready    — next-delivery date formatting, every derived KV metric, and
 *                the relative "last synced" timestamp.
 *   • ready fallbacks — "None scheduled" + em-dash when delivery / sync are null.
 *   • null-safety — undefined numeric stats coalesce to 0 rather than blanks
 *                   (the `?? 0` hardening on the source).
 *
 * `useDateFormat` / `useTimeFormatPreference` subscribe to server settings
 * (TanStack Query) + the timezone router context; they are mocked to
 * deterministic stubs so the render tree stays hermetic (no QueryClient, no
 * network) — the same convention as data-display/__tests__/TimeStamp.test.tsx.
 */
import '@/i18n';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps } from 'react';

import { DeliveryOutlookPanel } from './DeliveryOutlookPanel';
import type { OrderStats } from './teslaOrderStats';

vi.mock('@/hooks/useDateFormat', () => {
  const tag = (label: string) => (v: unknown) => (v == null ? '' : `${label}:${String(v)}`);
  return {
    useDateFormat: () => ({
      opts: { locale: 'en-US', tz: 'UTC' },
      tz: 'UTC',
      locale: 'en-US',
      formatDate: tag('date'),
      formatDateTime: () => 'synced-absolute',
      formatTime: tag('time'),
      formatDateShort: tag('short'),
      formatDateWithDay: tag('day'),
      formatRelative: () => 'synced-relative',
      formatRelativeTime: () => 'synced-relative',
      formatRelativeDays: tag('reldays'),
    }),
  };
});

vi.mock('@/hooks/useTimeFormatPreference', () => ({
  useTimeFormatPreference: (): 'relative' | 'absolute' => 'relative',
}));

function makeStats(overrides: Partial<OrderStats> = {}): OrderStats {
  return {
    total: 5,
    byBucket: { inProgress: 1, ready: 1, delivered: 1, cancelled: 1, other: 1 },
    buckets: [
      { bucket: 'inProgress', count: 1 },
      { bucket: 'ready', count: 1 },
    ],
    delivered: 1,
    ready: 1,
    inProgress: 1,
    cancelled: 1,
    upgradable: 3,
    models: 2,
    withVin: 4,
    nextDelivery: '2026-01-15T00:00:00Z',
    ...overrides,
  };
}

type PanelProps = ComponentProps<typeof DeliveryOutlookPanel>;

function renderPanel(overrides: Partial<PanelProps> = {}) {
  const props: PanelProps = {
    stats: makeStats(),
    status: 'ready',
    error: null,
    onRetry: vi.fn(),
    fetchedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
  const utils = render(
    <MemoryRouter>
      <DeliveryOutlookPanel {...props} />
    </MemoryRouter>,
  );
  return { ...utils, props };
}

describe('DeliveryOutlookPanel — state-invariant chrome', () => {
  it('renders the "Delivery Outlook" heading with a decorative icon in every status', () => {
    const statuses = ['loading', 'error', 'empty', 'ready'] as const;

    for (const status of statuses) {
      const { unmount } = renderPanel({
        status,
        error: status === 'error' ? new Error('boom') : null,
      });

      const heading = screen.getByRole('heading', { name: /delivery outlook/i });
      expect(heading).toBeInTheDocument();

      // The CalendarClock glyph is presentational — it must not pollute the
      // accessible name, so it carries aria-hidden.
      const icon = heading.querySelector('svg');
      expect(icon).not.toBeNull();
      expect(icon?.getAttribute('aria-hidden')).toBe('true');

      unmount();
    }
  });
});

describe('DeliveryOutlookPanel — loading', () => {
  it('renders a skeleton placeholder and withholds the outlook content', () => {
    const { container } = renderPanel({ status: 'loading' });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Upgradable orders')).toBeNull();
    expect(screen.queryByText('Next delivery')).toBeNull();
  });
});

describe('DeliveryOutlookPanel — error', () => {
  it('surfaces a retriable error and invokes onRetry when Retry is clicked', () => {
    const onRetry = vi.fn();
    renderPanel({ status: 'error', error: new Error('kaboom'), onRetry });

    expect(screen.getByRole('alert')).toBeInTheDocument();

    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);

    expect(onRetry).toHaveBeenCalledTimes(1);
    // Metrics must not render behind the error affordance.
    expect(screen.queryByText('Upgradable orders')).toBeNull();
  });
});

describe('DeliveryOutlookPanel — empty', () => {
  it('renders the empty affordance with the caller icon + guidance copy and no metrics', () => {
    renderPanel({
      status: 'empty',
      emptyIcon: <svg data-testid="empty-icon" aria-hidden="true" />,
    });

    expect(
      screen.getByText('Sync your Tesla account to see delivery details.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
    expect(screen.queryByText('VIN assigned')).toBeNull();
  });
});

describe('DeliveryOutlookPanel — ready (populated)', () => {
  it('formats the next delivery date and lists every derived metric', () => {
    renderPanel({
      stats: makeStats({
        upgradable: 3,
        models: 2,
        withVin: 4,
        total: 5,
        nextDelivery: '2026-01-15T00:00:00Z',
      }),
      fetchedAt: '2026-01-01T00:00:00Z',
    });

    // Next-delivery hero uses formatDateWithDay (mocked → "day:<iso>").
    expect(screen.getByText('day:2026-01-15T00:00:00Z')).toBeInTheDocument();
    expect(screen.queryByText('None scheduled')).toBeNull();

    // KVList metrics — label + value for each row.
    expect(screen.getByText('Upgradable orders')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Distinct models')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('VIN assigned')).toBeInTheDocument();
    expect(screen.getByText('4 / 5')).toBeInTheDocument();

    // Last synced renders a relative TimeStamp (mocked → "synced-relative").
    expect(screen.getByText('Last synced')).toBeInTheDocument();
    expect(screen.getByText('synced-relative')).toBeInTheDocument();
  });
});

describe('DeliveryOutlookPanel — ready (fallbacks)', () => {
  it('shows "None scheduled" and an em-dash when delivery + sync time are absent', () => {
    renderPanel({ stats: makeStats({ nextDelivery: null }), fetchedAt: null });

    expect(screen.getByText('None scheduled')).toBeInTheDocument();
    expect(screen.queryByText(/^day:/)).toBeNull();

    const lastSyncedRow = screen.getByText('Last synced').closest('div');
    expect(lastSyncedRow).not.toBeNull();
    expect(within(lastSyncedRow as HTMLElement).getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('synced-relative')).toBeNull();
  });
});

describe('DeliveryOutlookPanel — null-safety hardening', () => {
  it('coalesces missing numeric stat fields to 0 instead of rendering blanks', () => {
    const malformed = {
      ...makeStats(),
      upgradable: undefined,
      models: undefined,
      withVin: undefined,
      total: undefined,
      nextDelivery: null,
    } as unknown as OrderStats;

    renderPanel({ stats: malformed, fetchedAt: null });

    // upgradable + models each coalesce to a standalone "0".
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(2);
    // Both operands of the VIN progress fraction coalesce.
    expect(screen.getByText('0 / 0')).toBeInTheDocument();
  });
});
