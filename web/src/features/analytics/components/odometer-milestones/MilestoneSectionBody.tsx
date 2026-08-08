import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { QueryError, Skeleton } from '@/components/feedback';
import { cn } from '@/lib/cn';

import type { MilestoneSectionState } from './types';

interface MilestoneSectionBodyProps {
  state: MilestoneSectionState;
  children: ReactNode;
  className?: string;
}

/** Shared status gate that stays mounted inside each independent panel shell. */
export function MilestoneSectionBody({
  state,
  children,
  className,
}: MilestoneSectionBodyProps) {
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
          'milestones.loading',
          'Loading odometer milestone workspace',
        )}
        className={cn('py-4', classes)}
      >
        <Skeleton height="100%" className="min-h-40" />
      </div>
    );
  }

  return <div className={classes}>{children}</div>;
}
