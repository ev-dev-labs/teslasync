import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { QueryError, Skeleton } from '@/components/feedback';
import { cn } from '@/lib/cn';

import type { DrivingRhythmSectionState } from './types';

interface DrivingRhythmSectionBodyProps {
  state: DrivingRhythmSectionState;
  children: ReactNode;
  className?: string;
}

/** Shared loading/error gate kept inside every independently mounted shell. */
export function DrivingRhythmSectionBody({
  state,
  children,
  className,
}: DrivingRhythmSectionBodyProps) {
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
          'rhythm.loading',
          'Loading driving rhythm evidence',
        )}
        className={cn('py-4', classes)}
      >
        <Skeleton height="100%" className="min-h-44" />
      </div>
    );
  }

  return <div className={classes}>{children}</div>;
}
