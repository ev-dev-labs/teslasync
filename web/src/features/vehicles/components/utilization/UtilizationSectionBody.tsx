import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { QueryError, Skeleton } from '@/components/feedback';
import { cn } from '@/lib/cn';

import type { UtilizationSectionState } from './types';

interface UtilizationSectionBodyProps {
  state: UtilizationSectionState;
  children: ReactNode;
  className?: string;
}

export function UtilizationSectionBody({
  state,
  children,
  className,
}: UtilizationSectionBodyProps) {
  const { t } = useTranslation();
  const classes = cn('min-h-48', className);

  if (state.error) {
    return (
      <div className={cn('flex items-center justify-center', classes)}>
        <QueryError error={state.error} onRetry={state.onRetry} />
      </div>
    );
  }

  if (state.isLoading) {
    return (
      <div
        role="status"
        aria-label={t(
          'utilization.loading',
          'Loading utilization analysis',
        )}
        className={cn('py-4', classes)}
      >
        <Skeleton height="100%" className="min-h-40" />
      </div>
    );
  }

  return <div className={classes}>{children}</div>;
}
