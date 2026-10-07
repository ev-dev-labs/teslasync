import { Shapes } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { deriveDataState } from '@/api/dataState';
import { Skeleton } from '@/components/feedback';
import { SourceContent } from '@/components/layout';
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
      className="flex min-h-28 flex-col items-center justify-center py-6 text-center"
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
  const source = deriveDataState({
    data: state.hasData ? true : undefined,
    error: state.error ?? state.refreshError,
    fetchStatus: state.isPaused || state.refreshPaused ? 'paused' : state.isFetching ? 'fetching' : 'idle',
    isFetching: state.isFetching,
    refetch: state.onRetry,
  }, { provenance: 'historical' });
  const errorMessage = t(
    'archetypes.states.errorPassive',
    'Drive evidence is unavailable; retry from the evidence ledger while this section remains visible.',
  );
  let passiveMessage: string | null = null;
  if (!state.vehicleSelected) {
    passiveMessage = t(
      'archetypes.states.noVehiclePassive',
      'Select a vehicle to make its bounded drive evidence available.',
    );
  } else if (state.isPaused) {
    passiveMessage = t(
      'archetypes.states.pausedPassive',
      'Drive evidence is paused while the network is unavailable; no empty response is inferred.',
    );
  } else if (!state.isResolved) {
    passiveMessage = t(
      'archetypes.states.pendingPassive',
      'Drive-history availability has not resolved.',
    );
  } else if (requirement !== 'resolved') {
    if (requirement === 'eligible' && summary.analyzedDrives === 0) {
      passiveMessage = t(
        'archetypes.states.noEligiblePassive',
        'No returned drive passed every ID, timestamp, distance, energy, and speed eligibility gate.',
      );
    } else if (summary.status === 'insufficient_drives') {
      passiveMessage = t(
        'archetypes.states.insufficientDrivesPassive',
        '{{eligible}} eligible drives are available; at least {{required}} are required before clustering.',
        {
          eligible: summary.analyzedDrives,
          required: summary.thresholds.minDrives,
        },
      );
    } else if (summary.status === 'insufficient_variation') {
      passiveMessage = t(
        'archetypes.states.insufficientVariationPassive',
        'Eligible drives exist, but no standardized feature dimension varies enough to support a partition.',
      );
    } else if (summary.status === 'insufficient_partition') {
      passiveMessage = t(
        'archetypes.states.insufficientPartitionPassive',
        'Eligible drives vary, but no candidate realized every requested cluster; partition-dependent evidence is withheld.',
      );
    } else if (requirement === 'directory' && summary.directory.items.length === 0) {
      passiveMessage = t(
        'archetypes.states.noDirectoryPassive',
        'No clustered assignment is available for the recent-drive directory.',
      );
    }
  }
  if (requirement === 'none') return <div className={className}>{children}</div>;
  const sourceState = !state.vehicleSelected
    ? 'empty'
    : !state.hasData && state.isLoading
      ? 'loading'
      : !state.hasData && state.isPaused
        ? 'empty'
        : source.fatalError
          ? 'error'
          : passiveMessage
            ? 'empty'
            : source.hasData && source.status === 'stale'
              ? 'retained'
              : 'ready';
  return (
    <div className={cn('flex h-full min-h-0 min-w-0 flex-col', className)}>
      <SourceContent
        state={sourceState}
        label={t('archetypes.title', 'Drive archetypes')}
        emptyMessage={passiveMessage ?? ''}
        emptyContent={passiveMessage ? passive(passiveMessage) : undefined}
        loadingContent={<div className="min-h-28"><Skeleton height={skeletonHeight} /></div>}
        errorMessage={errorMessage}
        error={source.fatalError}
        errorRecovery={{ onRetry: source.retry ?? undefined }}
        retainedMessage={source.isRefreshBlocked && !source.refreshError
          ? t('archetypes.query.refreshPaused', 'The network is unavailable, so cached evidence remains visible while its refresh is paused.')
          : t('archetypes.query.refreshFailed', 'The history window could not refresh. The most recently loaded evidence remains visible.')}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">{children}</div>
      </SourceContent>
    </div>
  );
}
