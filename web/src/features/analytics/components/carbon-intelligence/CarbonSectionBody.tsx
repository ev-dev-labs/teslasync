import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleOff } from 'lucide-react';

import { Skeleton } from '@/components/feedback';
import { Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { CarbonQueryState } from './types';

interface CarbonSectionBodyProps {
  state: CarbonQueryState;
  children: ReactNode;
  className?: string;
  skeletonHeight?: number;
}

function PassiveState({
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-h-28 flex-col items-center justify-center py-5 text-center',
        className,
      )}
    >
      <CircleOff
        className="mb-2 h-6 w-6 text-[var(--text-muted)]"
        aria-hidden="true"
      />
      <Text as="p" variant="bodySm" className="max-w-2xl">
        {message}
      </Text>
    </div>
  );
}

export function CarbonSectionBody({
  state,
  children,
  className,
  skeletonHeight = 144,
}: CarbonSectionBodyProps) {
  const { t } = useTranslation();

  if (!state.enabled) {
    return (
      <PassiveState
        className={className}
        message={t(
          'carbon.states.noVehicle',
          'Select a vehicle to load this vehicle-dependent evidence.',
        )}
      />
    );
  }
  if (!state.hasData && state.isLoading) {
    return (
      <div
        className={cn('min-h-28', className)}
        role="status"
        aria-label={t('carbon.states.loadingLabel', 'Loading carbon evidence')}
      >
        <Skeleton height={skeletonHeight} />
      </div>
    );
  }
  if (!state.hasData && state.isPaused) {
    return (
      <PassiveState
        className={className}
        message={t(
          'carbon.states.paused',
          'The query is paused while the network is unavailable; this is not treated as an empty response.',
        )}
      />
    );
  }
  if (!state.hasData && state.error) {
    return (
      <PassiveState
        className={className}
        message={t(
          'carbon.states.error',
          'This source is unavailable. Retry it from the source and scope ledger.',
        )}
      />
    );
  }
  if (!state.hasData && !state.isResolved) {
    return (
      <PassiveState
        className={className}
        message={t(
          'carbon.states.pending',
          'Source availability has not resolved yet.',
        )}
      />
    );
  }
  return <div className={className}>{children}</div>;
}
