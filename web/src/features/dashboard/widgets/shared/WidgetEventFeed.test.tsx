/**
 * WidgetEventFeed — behavioural + hardening tests.
 *
 * WidgetEventFeed is the shared activity-feed primitive that ~11 dashboard
 * widgets (alerts, command history, sentry events, audit log, …) render into.
 * It takes a list of `EventFeedItem`s, sorts them most-recent-first, caps the
 * feed (explicit `maxItems` → compact-3 → default-10), and renders each as a
 * `<TimelineItem>` with a relative-time label. This suite exercises:
 *   - the list semantics (role="list" / one role="listitem" per event) and the
 *     title/subtitle/icon content,
 *   - the empty state (default + caller-supplied message/icon) and the fact
 *     that the list is *replaced* — not rendered blank — when there is no data,
 *   - the cap precedence (default 10, compact 3, explicit maxItems wins),
 *   - most-recent-first ordering regardless of input order,
 *   - the i18n'd relative-time buckets ("Just now" / "Nm ago" / "Nh ago") and
 *     the tz-aware absolute-date fallback past 24h,
 *   - null-safety: a malformed/empty timestamp must SINK to the bottom (never
 *     scramble the sort via a NaN comparator) and render the "—" placeholder
 *     instead of "NaNm ago",
 *   - href drill-through: a row becomes a focusable <Link> that navigates.
 *
 * `react-i18next` is stubbed to an interpolating `t(key, default, vars)`
 * passthrough (repo convention). `useDateFormat` is left real — it runs against
 * the global `useSettings` (locale en-US) + `useTimezone` (UTC) mocks installed
 * in test-setup.ts — so the absolute-date fallback is deterministic and matches
 * `@/lib/dateFormat`. Renders are wrapped in <MemoryRouter> because a row with
 * an href renders a react-router <Link>. No network is touched.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { ComponentProps } from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string, vars?: Record<string, unknown>) => {
      let out = typeof defaultValue === 'string' ? defaultValue : key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
      }
      return out;
    },
  }),
}));

import { WidgetEventFeed, type EventFeedItem } from './WidgetEventFeed';
import { formatDateTime as libFormatDateTime } from '@/lib/dateFormat';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Fixed clock for the relative-time buckets. */
const NOW = new Date('2026-07-04T18:00:00.000Z');

/** ISO string `offsetMs` before the (possibly faked) current time. */
function isoAgo(offsetMs: number): string {
  return new Date(Date.now() - offsetMs).toISOString();
}

function makeItem(over: Partial<EventFeedItem> = {}): EventFeedItem {
  return {
    id: 'evt',
    icon: null,
    title: 'Event',
    timestamp: isoAgo(MIN),
    color: '#22c55e',
    ...over,
  };
}

function renderFeed(props: Partial<ComponentProps<typeof WidgetEventFeed>> = {}) {
  return render(
    <MemoryRouter>
      <WidgetEventFeed items={[]} {...props} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe('WidgetEventFeed — rendering & list semantics', () => {
  it('renders each item as a labelled listitem with title and subtitle', () => {
    renderFeed({
      items: [
        makeItem({ id: 1, title: 'Charge started', subtitle: 'Home · 48A', timestamp: isoAgo(2 * MIN) }),
        makeItem({ id: 2, title: 'Drive ended', subtitle: '42 mi', timestamp: isoAgo(30 * MIN) }),
      ],
    });

    const list = screen.getByRole('list', { name: /event feed/i });
    expect(list).toBeInTheDocument();
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Charge started')).toBeInTheDocument();
    expect(screen.getByText('Home · 48A')).toBeInTheDocument();
    expect(screen.getByText('Drive ended')).toBeInTheDocument();
  });

  it('renders the supplied decorative icon for a row', () => {
    renderFeed({
      items: [makeItem({ title: 'Sentry event', icon: <span data-testid="ev-icon">S</span> })],
    });

    const icon = screen.getByTestId('ev-icon');
    expect(icon).toBeInTheDocument();
    // TimelineItem hides the icon swatch from assistive tech.
    expect(icon.parentElement).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('WidgetEventFeed — empty state', () => {
  it('replaces the list with the default empty message when there are no items', () => {
    renderFeed({ items: [] });

    expect(screen.getByText('No events yet')).toBeInTheDocument();
    // The list is replaced, not rendered blank.
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('shows a caller-supplied empty message and icon', () => {
    renderFeed({
      items: [],
      emptyMessage: 'No alerts yet',
      emptyIcon: <span data-testid="empty-icon" />,
    });

    expect(screen.getByText('No alerts yet')).toBeInTheDocument();
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
    expect(screen.queryByText('No events yet')).not.toBeInTheDocument();
  });

  it('is null-safe when items is undefined (renders the empty state, does not throw)', () => {
    // The prop is typed non-optional, but callers can still hand it undefined
    // from an in-flight query — the feed must not blow up on `[...items]`.
    renderFeed({ items: undefined as unknown as EventFeedItem[] });

    expect(screen.getByText('No events yet')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});

describe('WidgetEventFeed — cap precedence', () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => makeItem({ id: i, title: `E${i}`, timestamp: isoAgo(i * MIN) }));

  it('caps the feed at 10 rows by default (non-compact)', () => {
    renderFeed({ items: many(12) });
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(10);
  });

  it('caps the feed at 3 rows in compact mode', () => {
    renderFeed({ compact: true, items: many(5) });
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(3);
  });

  it('honours an explicit maxItems over the compact default', () => {
    renderFeed({ compact: true, maxItems: 2, items: many(5) });
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('WidgetEventFeed — ordering', () => {
  it('orders rows most-recent first regardless of input order', () => {
    renderFeed({
      items: [
        makeItem({ id: 'old', title: 'Older event', timestamp: isoAgo(3 * HOUR) }),
        makeItem({ id: 'new', title: 'Newer event', timestamp: isoAgo(10 * MIN) }),
        makeItem({ id: 'mid', title: 'Middle event', timestamp: isoAgo(1 * HOUR) }),
      ],
    });

    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Newer event');
    expect(rows[1]).toHaveTextContent('Middle event');
    expect(rows[2]).toHaveTextContent('Older event');
  });
});

describe('WidgetEventFeed — relative time labels', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders recent timestamps as i18n relative buckets', () => {
    renderFeed({
      items: [
        makeItem({ id: 'a', title: 'Now event', timestamp: isoAgo(30 * 1000) }),
        makeItem({ id: 'b', title: 'Minutes event', timestamp: isoAgo(5 * MIN) }),
        makeItem({ id: 'c', title: 'Hours event', timestamp: isoAgo(3 * HOUR) }),
      ],
    });

    expect(screen.getByText('Just now')).toBeInTheDocument();
    expect(screen.getByText('5m ago')).toBeInTheDocument();
    expect(screen.getByText('3h ago')).toBeInTheDocument();
  });

  it('falls back to a tz-aware absolute date for timestamps older than a day', () => {
    const iso = isoAgo(2 * DAY);
    const expected = libFormatDateTime(iso, { locale: 'en-US', tz: 'UTC' });

    renderFeed({ items: [makeItem({ title: 'Old event', timestamp: iso })] });

    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.queryByText(/ago/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Just now')).not.toBeInTheDocument();
  });
});

describe('WidgetEventFeed — invalid timestamp null-safety', () => {
  it('sinks a malformed-timestamp row to the bottom and renders "—" for its time', () => {
    renderFeed({
      items: [
        makeItem({ id: 'valid', title: 'Valid event', timestamp: isoAgo(5 * MIN) }),
        // Empty string → Invalid Date → NaN epoch → must sink, never scramble.
        makeItem({ id: 'bad', title: 'Broken event', timestamp: '' }),
      ],
    });

    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Valid event');
    expect(rows[1]).toHaveTextContent('Broken event');
    // Regression guard: the pre-hardening code produced "NaNm ago".
    expect(rows[1]).toHaveTextContent('—');
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('keeps two malformed rows stable (comparator never returns NaN)', () => {
    renderFeed({
      items: [
        makeItem({ id: 'bad-a', title: 'Broken A', timestamp: 'not-a-date' }),
        makeItem({ id: 'bad-b', title: 'Broken B', timestamp: '' }),
      ],
    });

    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Broken A');
    expect(rows[1]).toHaveTextContent('Broken B');
  });
});

describe('WidgetEventFeed — navigation (href)', () => {
  it('renders a plain, non-interactive row when no href is given', () => {
    renderFeed({ items: [makeItem({ title: 'No link event' })] });

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('No link event')).toBeInTheDocument();
  });

  it('wraps the row in a focusable drill-through link when href is set', () => {
    renderFeed({ items: [makeItem({ title: 'Alert fired', href: '/alerts/7' })] });

    const link = screen.getByRole('link', { name: /alert fired/i });
    expect(link).toHaveAttribute('href', '/alerts/7');
  });

  it('navigates to the href when the row is clicked', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={
              <WidgetEventFeed
                items={[makeItem({ title: 'Go to alert', href: '/alerts/7' })]}
              />
            }
          />
          <Route path="/alerts/7" element={<div>Alert Detail Page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText('Alert Detail Page')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: /go to alert/i }));
    expect(screen.getByText('Alert Detail Page')).toBeInTheDocument();
  });
});
