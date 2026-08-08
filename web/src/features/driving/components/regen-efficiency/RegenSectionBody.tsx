import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { cn } from '@/lib/cn';

import type { RegenSectionState } from './types';

interface RegenSectionBodyProps {
  state: RegenSectionState;
  hasData: boolean;
  emptyMessage: string;
  emptyIcon?: ReactNode;
  children: ReactNode;
  className?: string;
  skeletonHeight?: number;
}

export function RegenSectionBody({
  state,
  hasData,
  emptyMessage,
  emptyIcon,
  children,
  className,
  skeletonHeight = 220,
}: RegenSectionBodyProps) {
  const { t } = useTranslation();

  return (
    <div className={cn('min-h-40', className)}>
      {state.isLoading ? (
        <Skeleton height={skeletonHeight} />
      ) : state.error ? (
        <QueryError error={state.error} onRetry={state.onRetry} />
      ) : !state.isResolved ? (
        <EmptyState
          icon={emptyIcon}
          message={t(
            'regen.states.detailPending',
            'Detailed data availability has not resolved.',
          )}
          className="py-8"
        />
      ) : !hasData ? (
        <EmptyState /* no-action: the vehicle and date controls remain available above. */
          icon={emptyIcon}
          message={emptyMessage}
          className="py-8"
        />
      ) : (
        children
      )}
    </div>
  );
}
