import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function ChargeReadings({ short, children }: { short: boolean; children: ReactNode }) {
  return (
    <div className={cn(
      'min-w-0',
      short && '[&>.widget-stat-rail]:gap-y-1 [&>.widget-stat-rail]:py-1 [&>.widget-stat-rail>div]:gap-1',
    )}>
      {children}
    </div>
  );
}
