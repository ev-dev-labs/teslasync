import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleOff } from 'lucide-react';

import { AlertBanner, Skeleton } from '@/components/feedback';
import { SourceContent } from '@/components/layout';
import { Button, Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { ShareCardQueryState } from './types';

interface ShareCardSectionBodyProps {
  state: ShareCardQueryState;
  children: ReactNode;
  className?: string;
  skeletonHeight?: number;
  showCachedStatus?: boolean;
}

function passiveBody(message: string, className?: string): ReactNode {
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

export function ShareCardSectionBody({
  state,
  children,
  className,
  skeletonHeight = 144,
  showCachedStatus = false,
}: ShareCardSectionBodyProps) {
  const { t } = useTranslation();

  const label = t('shareCard.states.loadingLabel', 'Loading share card evidence');
  const emptyContent = !state.enabled
    ? passiveBody(
      t(
        'shareCard.states.noVehicle',
        'Select a vehicle to load this selected-window evidence.',
      ),
    )
    : state.isInitialPaused
      ? passiveBody(
      t(
        'shareCard.states.paused',
        'The initial query is paused while the network is unavailable; no empty response is inferred.',
      ),
      )
      : passiveBody(
        t('shareCard.states.pending', 'Source availability has not resolved yet.'),
      );
  if (!state.hasData && state.initialError) {
    return (
      <div className={cn('flex min-h-28 flex-col items-center justify-center gap-3 py-5 text-center', className)}>
        <Text as="p" variant="bodySm">
          {t(
            'shareCard.states.error',
            'Selected-window drive evidence is unavailable.',
          )}
        </Text>
        <Button type="button" variant="outline" size="sm" onClick={state.onRetry}>
          {t('shareCard.states.retry', 'Retry evidence query')}
        </Button>
      </div>
    );
  }
  return (
    <div className={className}>
      <SourceContent
        state={!state.enabled ? 'empty'
          : !state.hasData && state.isInitialLoading ? 'loading'
          : !state.hasData && !state.isResolved ? 'empty' : 'ready'}
        label={label}
        emptyMessage={t('shareCard.states.pending', 'Source availability has not resolved yet.')}
        errorMessage={t('shareCard.states.error', 'Selected-window drive evidence is unavailable.')}
        emptyContent={emptyContent}
        loadingContent={(
          <div className="min-h-28" role="status" aria-label={label}>
            <Skeleton height={skeletonHeight} />
          </div>
        )}
      >
        {showCachedStatus && state.cachedRefreshError ? (
          <AlertBanner variant="warning" className="mb-4">
            {t(
              'shareCard.states.cachedError',
              'Cached evidence remains visible, but the refresh failed.',
            )}
          </AlertBanner>
        ) : null}
        {showCachedStatus && state.cachedRefreshPaused ? (
          <AlertBanner variant="info" className="mb-4">
            {t(
              'shareCard.states.cachedPaused',
              'Cached evidence remains visible while its refresh is paused.',
            )}
          </AlertBanner>
        ) : null}
        {showCachedStatus && state.isRefreshing && !state.cachedRefreshPaused ? (
          <AlertBanner variant="info" className="mb-4">
            {t(
              'shareCard.states.refreshing',
              'Cached evidence is visible while a refresh is in progress.',
            )}
          </AlertBanner>
        ) : null}
        {children}
      </SourceContent>
    </div>
  );
}
