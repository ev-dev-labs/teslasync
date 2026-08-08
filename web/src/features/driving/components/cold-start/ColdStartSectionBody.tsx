import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { QueryError, Skeleton } from '@/components/feedback';
import { cn } from '@/lib/cn';

import type { ColdStartSectionState } from './types';

interface ColdStartSectionBodyProps {
  state: ColdStartSectionState;
  children: ReactNode;
  className?: string;
}

/** Shared status gate mounted inside each independent Cold Start panel shell. */
export function ColdStartSectionBody({
  state,
  children,
  className,
}: ColdStartSectionBodyProps) {
  const { t } = useTranslation();
  const classes = cn('min-h-52', className);

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
        aria-label={t('coldStart.loading', 'Loading cold-start analysis')}
        className={cn('py-4', classes)}
      >
        <Skeleton height="100%" className="min-h-44" />
      </div>
    );
  }

  return <div className={classes}>{children}</div>;
}
