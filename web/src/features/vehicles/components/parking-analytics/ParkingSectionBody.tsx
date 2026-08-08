import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { QueryError, Skeleton } from '@/components/feedback';
import { cn } from '@/lib/cn';

import type { ParkingSectionState } from './types';

interface ParkingSectionBodyProps {
  state: ParkingSectionState;
  children: ReactNode;
  className?: string;
}

/** Shared loading/error gate mounted inside every Parking Analytics shell. */
export function ParkingSectionBody({
  state,
  children,
  className,
}: ParkingSectionBodyProps) {
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
        aria-label={t('parking.states.loading', 'Loading parking analysis')}
        className={cn('py-4', classes)}
      >
        <Skeleton height="100%" className="min-h-44" />
      </div>
    );
  }

  return <div className={classes}>{children}</div>;
}
