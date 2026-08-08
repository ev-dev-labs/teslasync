import { ThermometerSun } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/feedback';
import { Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { PreconditioningSummary } from '../../lib/preconditioningEffectiveness';
import type {
  PreconditioningQueryState,
  PreconditioningRequirement,
  PreconditioningSourceQueryState,
} from './types';

interface PreconditioningSectionBodyProps {
  summary: PreconditioningSummary;
  state: PreconditioningQueryState;
  children: ReactNode;
  requirement?: PreconditioningRequirement;
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
        'flex min-h-24 flex-col items-center justify-center py-5 text-center',
        className,
      )}
    >
      <ThermometerSun
        className="mb-2 h-6 w-6 text-[var(--text-muted)]"
        aria-hidden="true"
      />
      <Text as="p" variant="bodySm" className="max-w-2xl">
        {message}
      </Text>
    </div>
  );
}

function relevantSources(
  state: PreconditioningQueryState,
  requirement: PreconditioningRequirement,
): PreconditioningSourceQueryState[] {
  if (requirement === 'climate') return [state.climate];
  if (requirement === 'drives') return [state.drives];
  if (requirement === 'none') return [];
  return [state.climate, state.drives];
}

export function PreconditioningSectionBody({
  summary,
  state,
  children,
  requirement = 'analysis',
  className,
  skeletonHeight = 128,
}: PreconditioningSectionBodyProps) {
  const { t } = useTranslation();
  const sources = relevantSources(state, requirement);

  if (!state.vehicleSelected) {
    return (
      <PassiveState
        className={className}
        message={t(
          'preconditioningEffectiveness.states.noVehiclePassive',
          'Select a vehicle to make its climate and departure evidence available.',
        )}
      />
    );
  }
  if (sources.some((source) => source.isLoading)) {
    return (
      <div className={cn('min-h-24', className)}>
        <Skeleton height={skeletonHeight} />
      </div>
    );
  }
  if (sources.some((source) => source.error)) {
    return (
      <PassiveState
        className={className}
        message={t(
          'preconditioningEffectiveness.states.sourceErrorPassive',
          'A required source is unavailable; retry from the evidence ledger while this section shell remains visible.',
        )}
      />
    );
  }
  if (sources.some((source) => !source.isResolved)) {
    return (
      <PassiveState
        className={className}
        message={t(
          'preconditioningEffectiveness.states.pendingPassive',
          'Required source availability has not resolved.',
        )}
      />
    );
  }
  if (
    requirement === 'classified'
    && summary.joinedDepartures === 0
  ) {
    return (
      <PassiveState
        className={className}
        message={t(
          'preconditioningEffectiveness.states.noClassifiedPassive',
          'No departure passed every temporal, thermal, target, and HVAC classification gate; exclusions remain visible elsewhere.',
        )}
      />
    );
  }
  if (requirement === 'comparison' && summary.overall.evidence === 'none') {
    return (
      <PassiveState
        className={className}
        message={t(
          'preconditioningEffectiveness.states.noComparisonPassive',
          'Comparison is withheld until both observed HVAC-active pre-drive and explicitly HVAC-off control departures are classified.',
        )}
      />
    );
  }
  if (requirement === 'directory' && summary.directory.total === 0) {
    return (
      <PassiveState
        className={className}
        message={t(
          'preconditioningEffectiveness.states.noDirectoryPassive',
          'No unique valid drive departure is available for the evidence directory.',
        )}
      />
    );
  }
  return <div className={className}>{children}</div>;
}
