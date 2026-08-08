import type { ReactNode } from 'react';

import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { cn } from '@/lib/cn';

import type { BatteryCareSectionState } from './types';

interface BatteryCareSectionProps {
  title: string;
  description?: string;
  icon: ReactNode;
  emptyIcon: ReactNode;
  emptyMessage: string;
  hasData: boolean;
  state: BatteryCareSectionState;
  children: ReactNode;
  badge?: ReactNode;
  className?: string;
  testId: string;
  loadingHeight?: number;
}

/** Always-mounted panel shell shared by the non-chart Battery Care sections. */
export function BatteryCareSection({
  title,
  description,
  icon,
  emptyIcon,
  emptyMessage,
  hasData,
  state,
  children,
  badge,
  className,
  testId,
  loadingHeight = 240,
}: BatteryCareSectionProps) {
  return (
    <GlassPanel
      className={cn('h-full p-4 sm:p-5', className)}
      role="region"
      aria-label={title}
      data-testid={testId}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <PanelTitle className="flex items-center gap-2">
            {icon}
            {title}
          </PanelTitle>
          {description ? (
            <Text as="p" variant="caption" className="mt-1">
              {description}
            </Text>
          ) : null}
        </div>
        {badge}
      </div>

      <div className="mt-4">
        {state.error ? (
          <QueryError error={state.error} onRetry={state.onRetry} />
        ) : state.isLoading ? (
          <Skeleton height={loadingHeight} className="rounded-xl" />
        ) : !hasData ? (
          <EmptyState
            className="min-h-52"
            icon={emptyIcon}
            message={emptyMessage}
          />
        ) : (
          children
        )}
      </div>
    </GlassPanel>
  );
}
