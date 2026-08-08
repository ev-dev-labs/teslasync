import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { QueryError, Skeleton } from '@/components/feedback';
import { cn } from '@/lib/cn';

import type { SpeedSweetSpotSectionState } from './types';

interface SpeedSweetSpotSectionBodyProps {
  state: SpeedSweetSpotSectionState;
  children: ReactNode;
  className?: string;
}

/** Status gate mounted inside each independent evidence panel shell. */
export function SpeedSweetSpotSectionBody({
  state,
  children,
  className,
}: SpeedSweetSpotSectionBodyProps) {
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
        aria-label={t(
          'sweetSpot.loading',
          'Loading speed sweet spot evidence',
        )}
        className={cn('py-4', classes)}
      >
        <Skeleton height="100%" className="min-h-44" />
      </div>
    );
  }

  return <div className={classes}>{children}</div>;
}
