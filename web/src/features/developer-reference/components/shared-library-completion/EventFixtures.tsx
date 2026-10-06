import { useState } from 'react';
import { Info } from 'lucide-react';
import { TimelineItem } from '@/components/data-display';
import { Badge, Button, Text } from '@/components/ui';
import { WidgetEventFeed, type EventFeedItem } from '@/features/dashboard/widgets/shared';
import { FixtureSection } from './FixtureSection';
import { useCompletionLabels } from './useCompletionLabels';

export function EventFixtures() {
  const c = useCompletionLabels();
  const [inspected, setInspected] = useState<string | null>(null);
  const [order, setOrder] = useState<'source' | 'newest-first'>('source');
  const [empty, setEmpty] = useState(false);
  const action = (id: string) => (
    <Button wrapLabel type="button" variant="secondary" onClick={() => setInspected(id)}>{c.eventAction}</Button>
  );
  const common = {
    icon: <Info className="h-4 w-4" />, color: '#38bdf8', wrap: true,
    subtitle: c.eventSubtitle, badges: <Badge variant="warning">{c.unresolved}</Badge>,
    metadata: <Text as="p" variant="bodySm">{c.eventMetadata}</Text>,
    href: '#shared-completion-event-target',
  };
  const items: EventFeedItem[] = [
    { ...common, id: 'first', title: c.eventFirst, timestamp: '2026-08-01T09:00:00Z', timeLabel: c.eventTimeFirst, actions: action('first') },
    { ...common, id: 'second', title: c.eventSecond, timestamp: '2026-08-02T10:00:00Z', timeLabel: c.eventTimeSecond, actions: action('second') },
    { ...common, id: 'unresolved', title: c.eventInvalid, timestamp: 'invalid-fixture-time', timeLabel: c.eventTimeUnknown, actions: action('unresolved') },
  ];
  return (
    <FixtureSection id="events" contract="timeline-item-event-feed" title={c.eventTitle} description={c.eventDescription}>
      <TimelineItem {...common} title={c.eventFirst} time={c.eventTimeFirst} isLast actions={action('standalone')} />
      <div role="group" aria-label={c.eventTitle} className="flex flex-wrap gap-2">
        <Button wrapLabel type="button" aria-pressed={order === 'source'} onClick={() => setOrder('source')}>{c.sourceOrder}</Button>
        <Button wrapLabel type="button" aria-pressed={order === 'newest-first'} onClick={() => setOrder('newest-first')}>{c.newestFirst}</Button>
        <Button wrapLabel type="button" variant="secondary" aria-pressed={empty} onClick={() => setEmpty(value => !value)}>{c.eventEmpty}</Button>
      </div>
      <WidgetEventFeed items={empty ? [] : items} order={order} maxItems={3} emptyMessage={c.eventEmpty} />
      <Text id="shared-completion-event-target" as="p" variant="bodySm" role="status" aria-live="polite">
        {inspected ? c.eventActionResult.replace('{{id}}', inspected) : c.eventIdle}
      </Text>
    </FixtureSection>
  );
}
