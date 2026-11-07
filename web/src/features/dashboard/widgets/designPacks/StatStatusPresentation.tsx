import type { ComponentProps, ReactNode } from 'react';
import { WidgetStatGrid } from '../shared';
import StatusPresentation from './StatusPresentation';

interface StatStatusProps extends Pick<ComponentProps<typeof WidgetStatGrid>, 'stats' | 'cols' | 'maxPerRow'> {
  compact?: boolean;
  icon: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

export default function StatStatusPresentation({ stats = [], cols, maxPerRow, compact, icon, footer, children }: StatStatusProps) {
  const supporting = stats.slice(1);
  return (
    <StatusPresentation compact={compact} icon={icon}
      headline={<WidgetStatGrid stats={stats.slice(0, 1)} compact />}
      details={supporting.length > 0 || footer ? <>
        {supporting.length > 0 && <WidgetStatGrid stats={supporting} cols={cols} maxPerRow={maxPerRow} />}
        {footer}
      </> : null}
    >
      {children}
    </StatusPresentation>
  );
}
