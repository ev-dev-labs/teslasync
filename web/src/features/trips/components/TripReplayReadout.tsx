import type { ReactNode } from 'react';
import { HelpTooltip, MetricLabel, MetricValue, Text, type HelpTooltipProps } from '@/components/ui';
import { cn } from '@/lib/cn';

interface TripReplayReadoutProps {
  label: string;
  value: string;
  unit?: string;
  icon: ReactNode;
  help?: Pick<HelpTooltipProps, 'i18nKey' | 'defaultValue'>;
  className?: string;
}

/** An unframed measurement within the replay's section-level surface. */
export function TripReplayReadout({ label, value, unit, icon, help, className }: TripReplayReadoutProps) {
  return (
    <div className={cn('min-w-0 px-3 py-3 sm:px-4', className)}>
      <MetricLabel className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
        <span className="shrink-0 text-[var(--text-muted)]" aria-hidden="true">{icon}</span>
        <span className="min-w-0 break-words [overflow-wrap:anywhere]">{label}</span>
        {help && <HelpTooltip {...help} />}
      </MetricLabel>
      <MetricValue className="flex flex-wrap items-baseline gap-x-1.5 [overflow-wrap:anywhere]">
        {value}
        {unit && <Text as="span" variant="bodySm">{unit}</Text>}
      </MetricValue>
    </div>
  );
}
