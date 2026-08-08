import { Shapes } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/feedback';
import { Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { ArchetypeSummary } from '../../lib/driveArchetypes';
import type {
  ArchetypeQueryState,
  ArchetypeSectionRequirement,
} from './types';

interface ArchetypeSectionBodyProps {
  summary: ArchetypeSummary;
  state: ArchetypeQueryState;
  children: ReactNode;
  requirement?: ArchetypeSectionRequirement;
  className?: string;
  skeletonHeight?: number;
}

export function ArchetypeSectionBody({
  summary,
  state,
  children,
  requirement = 'clustered',
  className,
  skeletonHeight = 144,
}: ArchetypeSectionBodyProps) {
  const { t } = useTranslation();
  const passive = (message: string) => (
    <div
      className={cn(
        'flex min-h-28 flex-col items-center justify-center py-6 text-center',
        className,
      )}
    >
      <Shapes
        className="mb-2 h-6 w-6 text-[var(--text-muted)]"
        aria-hidden="true"
      />
      <Text as="p" variant="bodySm" className="max-w-2xl">
        {message}
      </Text>
    </div>
  );

  if (requirement === 'none') return <div className={className}>{children}</div>;
  if (!state.vehicleSelected) {
    return passive(t(
      'archetypes.states.noVehiclePassive',
      'Select a vehicle to make its bounded drive evidence available.',
    ));
  }
  if (state.isLoading) {
    return (
      <div className={cn('min-h-28', className)}>
        <Skeleton height={skeletonHeight} />
      </div>
    );
  }
  if (state.isPaused) {
    return passive(t(
      'archetypes.states.pausedPassive',
      'Drive evidence is paused while the network is unavailable; no empty response is inferred.',
    ));
  }
  if (state.error) {
    return passive(t(
      'archetypes.states.errorPassive',
      'Drive evidence is unavailable; retry from the evidence ledger while this section remains visible.',
    ));
  }
  if (!state.isResolved) {
    return passive(t(
      'archetypes.states.pendingPassive',
      'Drive-history availability has not resolved.',
    ));
  }
  if (requirement === 'resolved') {
    return <div className={className}>{children}</div>;
  }
  if (requirement === 'eligible' && summary.analyzedDrives === 0) {
    return passive(t(
      'archetypes.states.noEligiblePassive',
      'No returned drive passed every ID, timestamp, distance, energy, and speed eligibility gate.',
    ));
  }
  if (summary.status === 'insufficient_drives') {
    return passive(t(
      'archetypes.states.insufficientDrivesPassive',
      '{{eligible}} eligible drives are available; at least {{required}} are required before clustering.',
      {
        eligible: summary.analyzedDrives,
        required: summary.thresholds.minDrives,
      },
    ));
  }
  if (summary.status === 'insufficient_variation') {
    return passive(t(
      'archetypes.states.insufficientVariationPassive',
      'Eligible drives exist, but no standardized feature dimension varies enough to support a partition.',
    ));
  }
  if (summary.status === 'insufficient_partition') {
    return passive(t(
      'archetypes.states.insufficientPartitionPassive',
      'Eligible drives vary, but no candidate realized every requested cluster; partition-dependent evidence is withheld.',
    ));
  }
  if (requirement === 'directory' && summary.directory.items.length === 0) {
    return passive(t(
      'archetypes.states.noDirectoryPassive',
      'No clustered assignment is available for the recent-drive directory.',
    ));
  }
  return <div className={className}>{children}</div>;
}
