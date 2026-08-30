/**
 * EventTimeline contract tests.
 *
 * <EventTimeline> is a self-sufficient, prop-driven panel that renders a
 * vertical list of derived security state-changes (lock / sentry / door).
 * The behaviour pinned here:
 *
 *   1. State precedence — error > loading > populated > empty. Each branch is
 *      mutually exclusive and self-contained (never a blank panel): a failed
 *      query surfaces <QueryError> with a working Retry, first-load shows a
 *      skeleton, an empty history shows the empty state, and populated data
 *      renders one row per event.
 *   2. Semantic label + subtitle resolution per (kind, variant) — the six
 *      lock/sentry/door × positive/negative combinations plus the door
 *      `detail` override and its Closed/Open fallback.
 *   3. Icon-chip tone mapping for every variant (positive / negative / the
 *      dormant neutral) and the icon glyph swapping with variant.
 *   4. TimeStamp wiring — the event's raw timestamp is threaded straight to
 *      the shared <TimeStamp> renderer, one per row.
 *   5. a11y — the panel is titled, exposes a list with one listitem per event,
 *      and the decorative icon chip is aria-hidden.
 *   6. Robustness — a null/undefined `timelineEvents` prop and a malformed row
 *      whose `kind` falls outside the known union both degrade gracefully
 *      instead of throwing.
 *
 * react-i18next is stubbed to return the English fallback so copy assertions
 * are decoupled from the locale bundle (matches the sibling StatusBadge /
 * ReasonBreakdown tests). <TimeStamp> is stubbed to a prop-capturing element
 * so we can assert the exact value EventTimeline threads through without
 * pulling in its settings/timezone/react-query plumbing. QueryError, Skeleton
 * and EmptyState render for real so the branch wiring is exercised end-to-end.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps, ReactNode } from 'react';

import { ApiError } from '@/lib/resilience';
import type { TimelineEvent } from './helpers';

// Deterministic i18n: t(key, fallback) returns the English fallback so the
// visible copy we assert on is independent of the translation JSON.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// Stub <TimeStamp> to a prop-capturing <time>. Keeps the assertions on
// EventTimeline's own wiring (it passes ev.timestamp through) precise and
// avoids re-testing TimeStamp's locale/tz/tooltip internals (covered by its
// own suite).
vi.mock('@/components/data-display', () => ({
  TimeStamp: ({ value }: { value: unknown }) => (
    <time data-testid="event-timestamp" data-value={String(value)}>
      {String(value)}
    </time>
  ),
}));

import { EventTimeline } from './EventTimeline';

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 'lock-1',
    kind: 'lock',
    variant: 'positive',
    detail: '',
    timestamp: '2026-07-04T10:00:00Z',
    ...overrides,
  };
}

function renderTimeline(props: Partial<ComponentProps<typeof EventTimeline>> = {}) {
  const merged: ComponentProps<typeof EventTimeline> = {
    timelineEvents: [],
    isLoading: false,
    error: null,
    onRetry: vi.fn(),
    ...props,
  };
  const utils = render(
    <MemoryRouter>
      <EventTimeline {...merged} />
    </MemoryRouter>,
  );
  return { ...utils, onRetry: merged.onRetry };
}

/** The decorative icon chip (aria-hidden) for the first rendered row. */
function firstChip(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('li [aria-hidden="true"]');
}

// ── State precedence ─────────────────────────────────────────────────────────

describe('EventTimeline — state precedence', () => {
  it('always renders the panel title regardless of state', () => {
    renderTimeline({ timelineEvents: [] });
    expect(
      screen.getByRole('heading', { name: 'Security Event Timeline' }),
    ).toBeInTheDocument();
  });

  it('renders QueryError with a working Retry when the query failed', () => {
    const { onRetry } = renderTimeline({ error: new ApiError('boom', 500) });

    // 5xx → ErrorState defaults to role="alert".
    expect(screen.getByRole('alert')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);

    // The error branch pre-empts the event list entirely. (QueryError renders
    // its own help-links list, so target the labelled timeline list.)
    expect(
      screen.queryByRole('list', { name: 'Security Event Timeline' }),
    ).toBeNull();
  });

  it('prioritises the error branch over the loading skeleton', () => {
    const { container } = renderTimeline({
      isLoading: true,
      error: new ApiError('still broken', 500),
      timelineEvents: [makeEvent()],
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(
      screen.queryByRole('list', { name: 'Security Event Timeline' }),
    ).toBeNull();
  });

  it('shows a skeleton on first load (loading, no error)', () => {
    const { container } = renderTimeline({ isLoading: true });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByText(/no state changes detected/i)).toBeNull();
  });

  it('shows the empty state once loaded with zero events', () => {
    renderTimeline({ timelineEvents: [], isLoading: false });

    const empty = screen.getByRole('status');
    expect(empty).toHaveTextContent(/no state changes detected/i);
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('renders one listitem per event when populated', () => {
    renderTimeline({
      timelineEvents: [
        makeEvent({ id: 'lock-1' }),
        makeEvent({ id: 'sentry-1', kind: 'sentry' }),
        makeEvent({ id: 'door-1', kind: 'door' }),
      ],
    });

    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    // Populated data pre-empts both the empty state and the skeleton.
    expect(screen.queryByRole('status')).toBeNull();
  });
});

// ── Label + subtitle resolution ──────────────────────────────────────────────

describe('EventTimeline — label + subtitle per (kind, variant)', () => {
  it.each([
    ['lock', 'positive', 'Vehicle Locked', 'Doors secured'],
    ['lock', 'negative', 'Vehicle Unlocked', 'Doors accessible'],
    ['sentry', 'positive', 'Sentry Mode Activated', 'Camera surveillance enabled'],
    ['sentry', 'negative', 'Sentry Mode Deactivated', 'Camera surveillance disabled'],
    ['door', 'positive', 'Doors Closed', 'Closed'],
    ['door', 'negative', 'Door Opened', 'Open'],
  ] as const)('%s / %s → "%s" + "%s"', (kind, variant, title, subtitle) => {
    renderTimeline({
      timelineEvents: [makeEvent({ id: `${kind}-1`, kind, variant, detail: '' })],
    });

    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText(subtitle)).toBeInTheDocument();
  });

  it('uses the door event detail as the subtitle when present', () => {
    renderTimeline({
      timelineEvents: [
        makeEvent({ id: 'door-1', kind: 'door', variant: 'negative', detail: 'OpenDriverFront' }),
      ],
    });

    expect(screen.getByText('Door Opened')).toBeInTheDocument();
    expect(screen.getByText('OpenDriverFront')).toBeInTheDocument();
    // The generic Closed/Open fallback must NOT appear once a detail is given.
    expect(screen.queryByText('Open')).toBeNull();
  });

  it('preserves the caller-supplied event order (no internal re-sort)', () => {
    renderTimeline({
      timelineEvents: [
        makeEvent({ id: 'sentry-1', kind: 'sentry', variant: 'positive' }),
        makeEvent({ id: 'lock-1', kind: 'lock', variant: 'negative' }),
      ],
    });

    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Sentry Mode Activated');
    expect(items[1]).toHaveTextContent('Vehicle Unlocked');
  });
});

// ── Icon-chip tone + glyph ───────────────────────────────────────────────────

describe('EventTimeline — icon chip', () => {
  it('applies the positive (emerald) tone chip', () => {
    const { container } = renderTimeline({
      timelineEvents: [makeEvent({ variant: 'positive' })],
    });
    const chip = firstChip(container);
    expect(chip?.className).toContain('bg-neon-green/10');
    expect(chip?.className).toContain('text-emerald-300');
  });

  it('applies the negative (rose) tone chip', () => {
    const { container } = renderTimeline({
      timelineEvents: [makeEvent({ variant: 'negative' })],
    });
    const chip = firstChip(container);
    expect(chip?.className).toContain('bg-neon-red/10');
    expect(chip?.className).toContain('text-rose-300');
  });

  it('applies the neutral (muted) tone chip', () => {
    const { container } = renderTimeline({
      timelineEvents: [makeEvent({ variant: 'neutral' })],
    });
    const chip = firstChip(container);
    expect(chip?.className).toContain('bg-white/[0.04]');
    expect(chip?.className).toContain('text-[var(--text-muted)]');
  });

  it('marks the icon chip decorative (aria-hidden) so SR users hear only the label', () => {
    const { container } = renderTimeline({ timelineEvents: [makeEvent()] });
    const chip = firstChip(container);
    expect(chip).not.toBeNull();
    expect(chip).toHaveAttribute('aria-hidden', 'true');
    // An SVG glyph is rendered inside the chip for a known kind.
    expect(chip?.querySelector('svg')).not.toBeNull();
  });

  it('swaps the icon glyph between positive and negative variants', () => {
    const pos = renderTimeline({ timelineEvents: [makeEvent({ variant: 'positive' })] });
    const posSvg = firstChip(pos.container)?.querySelector('svg')?.innerHTML ?? '';
    pos.unmount();

    const neg = renderTimeline({ timelineEvents: [makeEvent({ variant: 'negative' })] });
    const negSvg = firstChip(neg.container)?.querySelector('svg')?.innerHTML ?? '';

    expect(posSvg).not.toBe('');
    expect(negSvg).not.toBe('');
    expect(posSvg).not.toBe(negSvg);
  });
});

// ── TimeStamp wiring ─────────────────────────────────────────────────────────

describe('EventTimeline — timestamp wiring', () => {
  it('threads each event timestamp through to a TimeStamp, one per row', () => {
    renderTimeline({
      timelineEvents: [
        makeEvent({ id: 'lock-1', timestamp: '2026-07-04T10:00:00Z' }),
        makeEvent({ id: 'door-1', kind: 'door', timestamp: '2026-07-03T09:00:00Z' }),
      ],
    });

    const stamps = screen.getAllByTestId('event-timestamp');
    expect(stamps).toHaveLength(2);
    expect(stamps[0]).toHaveAttribute('data-value', '2026-07-04T10:00:00Z');
    expect(stamps[1]).toHaveAttribute('data-value', '2026-07-03T09:00:00Z');
  });
});

// ── Robustness / defensive hardening ─────────────────────────────────────────

describe('EventTimeline — robustness', () => {
  it('renders the empty state (no crash) when timelineEvents is undefined', () => {
    // A caller threading `data?.timeline` can hand us undefined despite the
    // typed prop; the `?? []` guard must keep the panel alive.
    expect(() =>
      renderTimeline({ timelineEvents: undefined as unknown as TimelineEvent[] }),
    ).not.toThrow();
    expect(screen.getByRole('status')).toHaveTextContent(/no state changes detected/i);
  });

  it('degrades a malformed row (unknown kind) to a neutral label instead of crashing', () => {
    const malformed = {
      id: 'x-1',
      kind: 'wiper',
      variant: 'neutral',
      detail: '',
      timestamp: '2026-07-04T11:00:00Z',
    } as unknown as TimelineEvent;

    expect(() =>
      renderTimeline({
        timelineEvents: [malformed, makeEvent({ id: 'lock-1', kind: 'lock', variant: 'positive' })],
      }),
    ).not.toThrow();

    // Both rows survive; the unknown row shows the defensive fallback copy and
    // the known row still renders normally.
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('State Change')).toBeInTheDocument();
    expect(within(items[0]).getByText('Vehicle state updated')).toBeInTheDocument();
    expect(screen.getByText('Vehicle Locked')).toBeInTheDocument();
  });
});
