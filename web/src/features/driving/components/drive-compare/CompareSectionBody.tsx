import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { cn } from '@/lib/cn';

export interface CompareSectionState {
  isLoading: boolean;
  error: unknown;
  emptyMessage: string | null;
  onRetry: () => void;
}

interface CompareSectionBodyProps {
  state: CompareSectionState;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
  emptyActionTo?: { label: string; to: string };
  resourceName?: string;
}

/** Shared loading/error/selection gate used inside every mounted panel shell. */
export function CompareSectionBody({
  state,
  children,
  icon,
  className,
  emptyActionTo,
  resourceName,
}: CompareSectionBodyProps) {
  const { t } = useTranslation();
  const classes = cn('min-h-52', className);

  if (state.error) {
    return (
      <div className={cn('flex items-center justify-center', classes)}>
        <QueryError
          error={state.error}
          onRetry={state.onRetry}
          resourceName={resourceName}
          listHref="/drives"
        />
      </div>
    );
  }

  if (state.isLoading) {
    return (
      <div
        role="status"
        aria-label={t('driveCompare.loading', 'Loading drive comparison')}
        className={cn('py-4', classes)}
      >
        <Skeleton height="100%" className="min-h-44" />
      </div>
    );
  }

  if (state.emptyMessage) {
    return (
      <div className={classes}>
        <EmptyState
          icon={icon}
          message={state.emptyMessage}
          actionTo={emptyActionTo}
          className="h-full"
        />
      </div>
    );
  }

  return <div className={classes}>{children}</div>;
}
