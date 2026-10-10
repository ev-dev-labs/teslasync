import { useId, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { GlassPanel, PanelTitle, Caption, MetricValue, MetricLabel } from '@/components/ui';
import { Skeleton } from '@/components/feedback';

interface ApiLogsRuntimeCardProps {
  title: string;
  scope: string;
  icon: LucideIcon;
  count: string;
  countLabel: string;
  context: ReactNode;
  loading: boolean;
  children: ReactNode;
}

export function ApiLogsRuntimeCard({
  title, scope, icon: Icon, count, countLabel, context, loading, children,
}: ApiLogsRuntimeCardProps) {
  const titleId = useId();

  return (
    <GlassPanel role="region" aria-labelledby={titleId} className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="p-4 sm:p-5">
        <div className="flex items-center gap-2.5">
          <Icon className="h-5 w-5 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
          <PanelTitle id={titleId}>{title}</PanelTitle>
        </div>
        <Caption className="mt-2 block lg:min-h-10">{scope}</Caption>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-t border-[var(--glass-border)] pt-4">
          <div aria-busy={loading}>
            {loading ? <Skeleton className="h-9 w-20" /> : (
              <MetricValue className="tabular-nums">{count}</MetricValue>
            )}
            <MetricLabel className="mt-1">{countLabel}</MetricLabel>
          </div>
          <div className="min-w-0">{context}</div>
        </div>
      </div>
      <div className="flex-1 border-t border-[var(--glass-border)] px-4 py-3 sm:px-5">
        {children}
      </div>
    </GlassPanel>
  );
}
