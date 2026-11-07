import { cn } from '@/lib/cn';
import type { TimelinePresentationProps } from './Timeline.types';
import { timelineStyles } from './Timeline.styles';

export default function TimelineLayout({ appearance, compact, render }: TimelinePresentationProps) {
  const layout = timelineStyles[appearance];
  return (
    <div data-timeline-appearance={appearance} className={cn('h-full min-h-0 min-w-0', compact && '[&_[role=listitem]]:p-2')}>
      {render(layout)}
    </div>
  );
}
