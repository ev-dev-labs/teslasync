import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleOff } from 'lucide-react';

import { deriveDataState } from '@/api/dataState';
import { Skeleton } from '@/components/feedback';
import { SourceContent } from '@/components/layout';
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
  const source = deriveDataState({
    data: state.hasData ? true : undefined,
    error: state.error ?? state.refreshError,
    fetchStatus: state.isPaused || state.refreshPaused ? 'paused' : state.isFetching ? 'fetching' : 'idle',
    isFetching: state.isFetching,
    refetch: state.onRetry,
  });
  const errorMessage = t(
    'carbon.states.error',
    'This source is unavailable. Retry it from the source and scope ledger.',
  );
  const passiveMessage = !state.enabled
    ? t(
        'carbon.states.noVehicle',
        'Select a vehicle to load this vehicle-dependent evidence.',
      )
    : !state.hasData && state.isPaused
      ? t(
          'carbon.states.paused',
          'The query is paused while the network is unavailable; this is not treated as an empty response.',
        )
      : !state.hasData && !state.isResolved
        ? t(
            'carbon.states.pending',
            'Source availability has not resolved yet.',
          )
        : null;
  const sourceState = !state.enabled
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
        label={t('carbon.title', 'Carbon intelligence')}
        emptyMessage={passiveMessage ?? ''}
        emptyContent={passiveMessage ? <PassiveState message={passiveMessage} /> : undefined}
        loadingContent={(
          <div className="min-h-28" role="status" aria-label={t('carbon.states.loadingLabel', 'Loading carbon evidence')}>
            <Skeleton height={skeletonHeight} />
          </div>
        )}
        errorMessage={errorMessage}
        error={source.fatalError}
        errorRecovery={{ onRetry: source.retry ?? undefined }}
        retainedMessage={source.isRefreshBlocked && !source.refreshError
          ? t('carbon.source.cachedRefreshPaused', 'The network is unavailable; cached evidence remains visible while refresh is paused.')
          : t('carbon.source.cachedRefreshError', 'Refresh failed; the most recently loaded evidence remains visible.')}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">{children}</div>
      </SourceContent>
    </div>
  );
}
