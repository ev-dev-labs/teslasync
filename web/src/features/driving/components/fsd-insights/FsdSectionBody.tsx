import { Car } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { cn } from '@/lib/cn';

import type { FsdSectionState } from './types';

interface FsdSectionBodyProps {
  state: FsdSectionState;
  children: ReactNode;
  className?: string;
}

/**
 * Shared no-vehicle / error / loading gate mounted INSIDE every panel shell.
 *
 * The shell itself (title, description, chrome) always renders — this only
 * swaps the body — so the page never collapses a section out of existence and
 * the operator can always see which evidence is missing.
 */
export function FsdSectionBody({ state, children, className }: FsdSectionBodyProps) {
  const { t } = useTranslation();
  const classes = cn('min-h-40', className);

  if (state.noVehicle) {
    return (
      <div className={classes}>
        <EmptyState
          icon={<Car className="h-8 w-8" aria-hidden="true" />}
          message={t('fsd.noVehicle', 'Select a vehicle to see supervised self-driving telemetry.')}
          actionTo={{ label: t('fsd.chooseVehicle', 'Choose a vehicle'), to: '/vehicles' }}
        />
      </div>
    );
  }

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
        aria-label={t('fsd.loading', 'Loading supervised self-driving telemetry')}
        className={cn('py-4', classes)}
      >
        <Skeleton height="100%" className="min-h-36" />
      </div>
    );
  }

  return <div className={classes}>{children}</div>;
}
