import type { ComponentProps, ReactNode } from 'react';
import { WidgetStatGrid } from '../shared';
import TimelinePresentation from './TimelinePresentation';

interface StatTimelineProps extends Pick<ComponentProps<typeof WidgetStatGrid>, 'stats' | 'compact'> {
  children: ReactNode;
}

export default function StatTimelinePresentation({ stats = [], compact, children }: StatTimelineProps) {
  return (
    <TimelinePresentation compact={compact} render={slots => stats.length === 0 ? children : (
      <div className={slots.feed}>
        {stats.map((stat, index) => (
          <div key={index} className={slots.row}>
            <WidgetStatGrid stats={[stat]} compact />
          </div>
        ))}
      </div>
    )}>{children}</TimelinePresentation>
  );
}
