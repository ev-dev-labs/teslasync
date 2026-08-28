/**
 * AlertDetailTimeline tests.
 *
 * The component maps an `AlertEvent[]` audit log onto the shared `<Timeline>`
 * primitive, localising each entry's title by kind + actor. It is purely
 * presentational — no network, no QueryClient, no Router — so a bare render
 * with i18n initialised is enough.
 *
 * Coverage:
 *   1. Empty states (undefined + [] both fall back to the EmptyState panel).
 *   2. className is forwarded to BOTH the Timeline root and the EmptyState.
 *   3. Every localized kind title branch: created / acknowledged / reopened /
 *      commented, with and without an actor (the actor vs anonymous key split).
 *   4. Unknown kinds fall through to the raw kind label.
 *   5. Hardening: actor + note whitespace is trimmed, and blank notes never
 *      render an empty subtitle paragraph.
 *   6. Timestamp formatting + multi-event ordering.
 *   7. The default export is the same component as the named export.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import '@/i18n';

import type { AlertEvent } from '@/api/types';
import { AlertDetailTimeline } from '../AlertDetailTimeline';
import AlertDetailTimelineDefault from '../AlertDetailTimeline';

let seq = 0;
function makeEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
  seq += 1;
  return {
    id: seq,
    occurred_at: '2026-07-04T12:00:00Z',
    kind: 'created',
    actor: null,
    note: null,
    ...overrides,
  };
}

/** The Timeline renders each entry's title in a `.font-medium` span. */
function titleTexts(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('.font-medium')).map(
    (el) => el.textContent ?? '',
  );
}

describe('AlertDetailTimeline — empty states', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('renders the EmptyState panel when events is undefined', () => {
    render(<AlertDetailTimeline events={undefined} />);
    const panel = screen.getByRole('status');
    expect(panel).toBeInTheDocument();
    expect(screen.getByText('Audit timeline')).toBeInTheDocument();
    expect(screen.getByText('No events yet')).toBeInTheDocument();
  });

  it('renders the EmptyState panel when events is an empty array', () => {
    const { container } = render(<AlertDetailTimeline events={[]} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('No events yet')).toBeInTheDocument();
    // No timeline rows are drawn in the empty branch.
    expect(container.querySelectorAll('.pl-6')).toHaveLength(0);
  });

  it('forwards className to the EmptyState container', () => {
    render(<AlertDetailTimeline events={[]} className="empty-cls" />);
    expect(screen.getByRole('status')).toHaveClass('empty-cls');
  });
});

describe('AlertDetailTimeline — localized kind titles', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('renders the synthetic created entry as "Alert created"', () => {
    const { container } = render(
      <AlertDetailTimeline events={[makeEvent({ kind: 'created' })]} />,
    );
    expect(screen.getByText('Alert created')).toBeInTheDocument();
    // The events branch is NOT the empty panel.
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText('No events yet')).toBeNull();
    expect(titleTexts(container)).toEqual(['Alert created']);
  });

  it('renders "Acknowledged by {actor}" when an acknowledged event has an actor', () => {
    const { container } = render(
      <AlertDetailTimeline
        events={[makeEvent({ kind: 'acknowledged', actor: 'alice' })]}
      />,
    );
    expect(titleTexts(container)).toEqual(['Acknowledged by alice']);
  });

  it('renders anonymous "Acknowledged" when no actor is present', () => {
    const { container } = render(
      <AlertDetailTimeline
        events={[makeEvent({ kind: 'acknowledged', actor: null })]}
      />,
    );
    expect(titleTexts(container)).toEqual(['Acknowledged']);
    expect(screen.queryByText(/Acknowledged by/)).toBeNull();
  });

  it('renders "Reopened by {actor}" and anonymous "Reopened"', () => {
    const withActor = render(
      <AlertDetailTimeline
        events={[makeEvent({ kind: 'reopened', actor: 'bob' })]}
      />,
    );
    expect(titleTexts(withActor.container)).toEqual(['Reopened by bob']);
    cleanup();

    const anon = render(
      <AlertDetailTimeline events={[makeEvent({ kind: 'reopened' })]} />,
    );
    expect(titleTexts(anon.container)).toEqual(['Reopened']);
  });

  it('renders "Comment by {actor}" and anonymous "Comment added"', () => {
    const withActor = render(
      <AlertDetailTimeline
        events={[makeEvent({ kind: 'commented', actor: 'carol' })]}
      />,
    );
    expect(titleTexts(withActor.container)).toEqual(['Comment by carol']);
    cleanup();

    const anon = render(
      <AlertDetailTimeline events={[makeEvent({ kind: 'commented' })]} />,
    );
    expect(titleTexts(anon.container)).toEqual(['Comment added']);
  });

  it('falls through to the raw kind label for an unknown kind (with + without actor)', () => {
    const withActor = render(
      <AlertDetailTimeline
        events={[makeEvent({ kind: 'escalated', actor: 'dana' })]}
      />,
    );
    expect(titleTexts(withActor.container)).toEqual(['escalated']);
    cleanup();

    const anon = render(
      <AlertDetailTimeline events={[makeEvent({ kind: 'escalated' })]} />,
    );
    expect(titleTexts(anon.container)).toEqual(['escalated']);
  });
});

describe('AlertDetailTimeline — actor + note hardening', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('trims surrounding whitespace from the actor before interpolating', () => {
    const { container } = render(
      <AlertDetailTimeline
        events={[makeEvent({ kind: 'acknowledged', actor: '  alice  ' })]}
      />,
    );
    // Exact textContent — the default RTL normalizer would mask the leak.
    expect(titleTexts(container)).toEqual(['Acknowledged by alice']);
  });

  it('treats a whitespace-only actor as anonymous', () => {
    const { container } = render(
      <AlertDetailTimeline
        events={[makeEvent({ kind: 'acknowledged', actor: '   ' })]}
      />,
    );
    expect(titleTexts(container)).toEqual(['Acknowledged']);
  });

  it('treats an empty-string actor as anonymous', () => {
    const { container } = render(
      <AlertDetailTimeline
        events={[makeEvent({ kind: 'reopened', actor: '' })]}
      />,
    );
    expect(titleTexts(container)).toEqual(['Reopened']);
  });

  it('renders a non-blank note as the timeline subtitle', () => {
    const { container } = render(
      <AlertDetailTimeline
        events={[
          makeEvent({
            kind: 'commented',
            actor: 'alice',
            note: 'MQTT flapped for ~30s',
          }),
        ]}
      />,
    );
    const subtitle = container.querySelector('p');
    expect(subtitle).not.toBeNull();
    expect(subtitle?.textContent).toBe('MQTT flapped for ~30s');
  });

  it('trims surrounding whitespace from a rendered note', () => {
    const { container } = render(
      <AlertDetailTimeline
        events={[makeEvent({ kind: 'commented', note: '  investigating  ' })]}
      />,
    );
    expect(container.querySelector('p')?.textContent).toBe('investigating');
  });

  it('renders no subtitle paragraph when the note is null', () => {
    const { container } = render(
      <AlertDetailTimeline events={[makeEvent({ kind: 'created', note: null })]} />,
    );
    expect(container.querySelectorAll('p')).toHaveLength(0);
  });

  it('renders no subtitle paragraph when the note is whitespace-only', () => {
    const { container } = render(
      <AlertDetailTimeline events={[makeEvent({ kind: 'created', note: '   ' })]} />,
    );
    expect(container.querySelectorAll('p')).toHaveLength(0);
  });
});

describe('AlertDetailTimeline — timestamp + ordering + wiring', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('formats occurred_at for display', () => {
    render(
      <AlertDetailTimeline
        events={[makeEvent({ kind: 'created', occurred_at: '2026-07-04T12:00:00Z' })]}
      />,
    );
    // Year is timezone-stable for a mid-year UTC timestamp. Scope the query to
    // the list: the Timeline also renders an sr-only range summary that repeats
    // the same formatted timestamps.
    expect(
      within(screen.getByRole('list', { name: 'Timeline' })).getByText(/2026/),
    ).toBeInTheDocument();
  });

  it('renders the em-dash placeholder for an unparseable occurred_at', () => {
    const { container } = render(
      <AlertDetailTimeline
        events={[makeEvent({ kind: 'created', occurred_at: 'not-a-date' })]}
      />,
    );
    // formatDateTime maps garbage input to the shared "—" placeholder rather
    // than crashing or emitting "Invalid Date".
    expect(container.textContent).toContain('—');
    expect(container.textContent).not.toContain('Invalid Date');
  });

  it('renders every event in the given order', () => {
    const { container } = render(
      <AlertDetailTimeline
        events={[
          makeEvent({ kind: 'created' }),
          makeEvent({ kind: 'acknowledged', actor: 'alice' }),
          makeEvent({ kind: 'commented', actor: 'bob', note: 'follow-up' }),
        ]}
      />,
    );
    expect(container.querySelectorAll('.pl-6')).toHaveLength(3);
    expect(titleTexts(container)).toEqual([
      'Alert created',
      'Acknowledged by alice',
      'Comment by bob',
    ]);
    expect(screen.getByText('follow-up')).toBeInTheDocument();
  });

  it('forwards className to the Timeline root when events exist', () => {
    const { container } = render(
      <AlertDetailTimeline
        events={[makeEvent({ kind: 'created' })]}
        className="tl-cls"
      />,
    );
    expect(container.firstElementChild).toHaveClass('tl-cls');
    // Not the empty panel.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('exposes the same component as both a named and default export', () => {
    expect(AlertDetailTimelineDefault).toBe(AlertDetailTimeline);
  });
});
