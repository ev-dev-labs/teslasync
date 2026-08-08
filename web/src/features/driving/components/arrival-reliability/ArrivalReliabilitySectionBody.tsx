import type { ReactNode } from 'react';
import { Clock3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/feedback';
import { Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { ArrivalReliabilityResult } from '../../lib/arrivalReliability';
import type {
  ArrivalReliabilityQueryState,
  ArrivalSectionRequirement,
} from './types';

interface ArrivalReliabilitySectionBodyProps {
  analysis: ArrivalReliabilityResult;
  state: ArrivalReliabilityQueryState;
  children: ReactNode;
  requirement?: ArrivalSectionRequirement;
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
        'flex min-h-44 flex-col items-center justify-center py-10 text-center',
        className,
      )}
    >
      <Clock3
        className="mb-3 h-8 w-8 text-[var(--text-muted)]"
        aria-hidden="true"
      />
      <Text as="p" variant="bodySm" className="max-w-xl">
        {message}
      </Text>
    </div>
  );
}

/** Passive repeated state gate; the KPI band owns the live query status. */
export function ArrivalReliabilitySectionBody({
  analysis,
  state,
  children,
  requirement = 'routes',
  className,
  skeletonHeight = 240,
}: ArrivalReliabilitySectionBodyProps) {
  const { t } = useTranslation();

  if (!state.vehicleSelected) {
    return (
      <PassiveState
        className={className}
        message={t(
          'arrivalReliability.states.noVehiclePassive',
          'Select a vehicle to make its returned timing evidence available.',
        )}
      />
    );
  }
  if (state.isLoading) {
    return (
      <div
        className={cn('min-h-44', className)}
        aria-label={t(
          'arrivalReliability.states.loadingAria',
          'Loading arrival timing history',
        )}
      >
        <Skeleton height={skeletonHeight} />
      </div>
    );
  }
  if (state.error) {
    return (
      <PassiveState
        className={className}
        message={t(
          'arrivalReliability.states.errorPassive',
          'Timing history is unavailable; retry from the evidence status above.',
        )}
      />
    );
  }
  if (!state.isResolved) {
    return (
      <PassiveState
        className={className}
        message={t(
          'arrivalReliability.states.pendingPassive',
          'Timing-history availability has not resolved.',
        )}
      />
    );
  }
  if (
    requirement !== 'none'
    && analysis.accounting.includedRows === 0
  ) {
    return (
      <PassiveState
        className={className}
        message={
          analysis.accounting.returnedRows === 0
            ? t(
                'arrivalReliability.states.emptyPassive',
                'No drives were returned, so there is no route timing evidence.',
              )
            : t(
                'arrivalReliability.states.noQualifiedPassive',
                'No returned rows had complete, valid, non-future timing and usable route endpoints.',
              )
        }
      />
    );
  }
  if (
    (requirement === 'routes' || requirement === 'windows')
    && analysis.routes.length === 0
  ) {
    return (
      <PassiveState
        className={className}
        message={t(
          'arrivalReliability.states.insufficientRoutesPassive',
          'No directional route has the three included drives needed for supported route evidence.',
        )}
      />
    );
  }
  if (
    requirement === 'windows'
    && analysis.supportedWindows.length === 0
  ) {
    return (
      <PassiveState
        className={className}
        message={t(
          'arrivalReliability.states.insufficientWindowsPassive',
          'No route and local two-hour window combination has three included drives.',
        )}
      />
    );
  }
  return <div className={className}>{children}</div>;
}
