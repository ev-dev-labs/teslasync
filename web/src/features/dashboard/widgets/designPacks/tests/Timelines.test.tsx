import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Badge, Button } from '@/components/ui';
import { WidgetEventFeed, type EventFeedItem } from '../../shared/WidgetEventFeed';
import { WidgetDetailCard } from '../../shared/WidgetDetailCard';
import { PackBoundary } from '../PackBoundary';
import { PACK_APPEARANCES } from '../types';
import StatTimelinePresentation from '../StatTimelinePresentation';
import { WidgetStatGrid } from '../../shared/WidgetStatGrid';

describe.each(Object.entries(PACK_APPEARANCES))('timeline %s', (id, appearance) => {
  it('reuses prepared stat values, timestamps, zero and unknowns without interpreting source data', async () => {
    const stats = [
      { label: 'Scheduled start', value: '01:30', sublabel: 'Returned wall-clock time' },
      { label: 'Observed failures', value: 0, unit: 'events' },
      { label: 'Target charge', value: '80', unit: '%' },
      { label: 'Unknown schedule', value: null, unit: 'days' },
    ];
    const view = render(<PackBoundary requestedPackId={id}>
      <StatTimelinePresentation stats={stats}><WidgetStatGrid stats={stats} /></StatTimelinePresentation>
    </PackBoundary>);
    await waitFor(() => expect(view.container.querySelector(`[data-timeline-appearance="${appearance}"]`)).not.toBeNull());
    for (const value of ['Scheduled start', '01:30', 'Returned wall-clock time', 'Observed failures', '0', 'events', 'Target charge', '80', 'Unknown schedule', '—', '%']) {
      expect(screen.getByText(value, { exact: true })).toBeInTheDocument();
    }
    expect(screen.queryByText('days', { exact: true })).not.toBeInTheDocument();
    view.rerender(<PackBoundary requestedPackId="classic">
      <StatTimelinePresentation stats={stats}><WidgetStatGrid stats={stats} /></StatTimelinePresentation>
    </PackBoundary>);
    expect(view.container.querySelector('[data-timeline-appearance]')).toBeNull();
    expect(screen.getByText('01:30', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('0', { exact: true })).toBeInTheDocument();
    view.rerender(<PackBoundary requestedPackId={id}>
      <StatTimelinePresentation stats={[]}><WidgetStatGrid stats={[]} /></StatTimelinePresentation>
    </PackBoundary>);
    await waitFor(() => expect(view.container.querySelector(`[data-timeline-appearance="${appearance}"]`)).not.toBeNull());
    expect(screen.getByText('No stats available')).toBeInTheDocument();
    expect(screen.queryByText('0', { exact: true })).not.toBeInTheDocument();
  });

  it('reuses detail-row formatting while preserving source evidence, hints, badges and unknowns', async () => {
    const view = render(<PackBoundary requestedPackId={id}>
      <WidgetDetailCard presentation="timeline" entries={[
        { id: 'zero', label: 'Observed failures', value: 0, sublabel: 'Returned sample', badge: { text: 'Resolved', variant: 'success' } },
        { id: 'signed', label: 'Signed source value', value: -120, hint: 'Independent context', mono: true },
        { id: 'unknown', label: 'Missing source value', value: null },
      ]} />
    </PackBoundary>);
    await waitFor(() => expect(view.container.querySelector(`[data-timeline-appearance="${appearance}"]`)).not.toBeNull());
    for (const value of ['Observed failures', '0', 'Returned sample', 'Resolved', 'Signed source value', '-120', 'Independent context', 'Missing source value', '—']) {
      expect(screen.getByText(value, { exact: true })).toBeInTheDocument();
    }
    expect(view.container.querySelectorAll('dt')).toHaveLength(3);
    expect(view.container.querySelectorAll('dd')).toHaveLength(3);
  });

  it('preserves chronology, invalid-time placeholders, rich evidence, links and actual callbacks', async () => {
    const acknowledge = vi.fn();
    const items: EventFeedItem[] = [
      { id: 'old', title: 'Older source event', timestamp: '2026-07-01T10:00:00Z', color: '', icon: null },
      { id: 'unknown', title: 'Unknown event time', timestamp: 'invalid', color: '', icon: null },
      { id: 'new', title: 'Newer source event', timestamp: '2026-07-02T10:00:00Z', color: '', icon: null,
        href: '/notifications/inbox', subtitle: 'Independent source context',
        badges: <Badge variant="warning">Needs attention</Badge>, metadata: <span>-120 Wh</span>,
        actions: <Button onClick={acknowledge}>Acknowledge event</Button> },
    ];
    const view = render(<MemoryRouter><PackBoundary requestedPackId={id}>
      <WidgetEventFeed items={items} compact />
    </PackBoundary></MemoryRouter>);
    await waitFor(() => expect(view.container.querySelector(`[data-timeline-appearance="${appearance}"]`)).not.toBeNull());
    const rows = within(screen.getByRole('list', { name: 'Event feed' })).getAllByRole('listitem');
    expect(rows.map(row => row.textContent)).toEqual([
      expect.stringContaining('Newer source event'), expect.stringContaining('Older source event'), expect.stringContaining('Unknown event time'),
    ]);
    expect(rows[2]).toHaveTextContent('—');
    expect(screen.getByText('-120 Wh')).toBeInTheDocument();
    expect(screen.getByText('Independent source context')).toBeInTheDocument();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Newer source event' })).toHaveAttribute('href', '/notifications/inbox');
    const action = screen.getByRole('button', { name: 'Acknowledge event' });
    expect(action.closest('a')).toBeNull();
    fireEvent.click(action);
    expect(acknowledge).toHaveBeenCalledOnce();
    expect(items.map(item => item.id)).toEqual(['old', 'unknown', 'new']);
  });

  it('keeps explicit source order and caps, and renders an honest empty state without fabricated events', async () => {
    const items: EventFeedItem[] = [1, 2, 3].map(value => ({
      id: value, title: `Source event ${value}`, timestamp: `2026-07-0${value}T10:00:00Z`, color: '', icon: null,
    }));
    const tree = (events: EventFeedItem[]) => <MemoryRouter><PackBoundary requestedPackId={id}>
      <WidgetEventFeed items={events} order="source" maxItems={2} emptyMessage="No qualifying source events" />
    </PackBoundary></MemoryRouter>;
    const view = render(tree(items));
    await waitFor(() => expect(view.container.querySelector(`[data-timeline-appearance="${appearance}"]`)).not.toBeNull());
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Source event 1');
    expect(rows[1]).toHaveTextContent('Source event 2');
    view.rerender(tree([]));
    expect(screen.getByText('No qualifying source events')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});

it('keeps the mounted event controller, focused action and pending state when packs change', async () => {
  function Controller() {
    const [pending, setPending] = useState(false);
    return <WidgetEventFeed items={[{
      id: 'event', title: 'Source event', timestamp: '2026-07-01T10:00:00Z', color: '', icon: null,
      actions: <Button disabled={pending} onClick={() => setPending(true)}>{pending ? 'Review pending' : 'Review event'}</Button>,
    }]} />;
  }
  const tree = (pack: string) => <MemoryRouter><PackBoundary requestedPackId={pack}><Controller /></PackBoundary></MemoryRouter>;
  const view = render(tree('v1'));
  await waitFor(() => expect(view.container.querySelector('[data-timeline-appearance="studio"]')).not.toBeNull());
  const control = screen.getByRole('button', { name: 'Review event' });
  control.focus();
  for (const [pack, appearance] of Object.entries(PACK_APPEARANCES).slice(1)) {
    view.rerender(tree(pack));
    await waitFor(() => expect(view.container.querySelector(`[data-timeline-appearance="${appearance}"]`)).not.toBeNull());
    expect(screen.getByRole('button', { name: 'Review event' })).toBe(control);
    expect(control).toHaveFocus();
  }
  fireEvent.click(control);
  for (const pack of ['classic', 'v4']) {
    view.rerender(tree(pack));
    expect(screen.getByRole('button', { name: 'Review pending' })).toBeDisabled();
  }
});
