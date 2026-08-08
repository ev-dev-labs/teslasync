import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import { Badge, Button, Text } from '@/components/ui';
import type { CarbonQueryState, CarbonQueryStates } from './types';

interface CarbonSourceRowProps {
  id: keyof CarbonQueryStates;
  name: string;
  scope: string;
  state: CarbonQueryState;
}

function statusLabel(
  state: CarbonQueryState,
  t: ReturnType<typeof useTranslation>['t'],
): {
  label: string;
  variant: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
} {
  if (!state.enabled) {
    return {
      label: t('carbon.source.status.disabled', 'Vehicle required'),
      variant: 'neutral',
    };
  }
  if (!state.hasData && state.isLoading) {
    return {
      label: t('carbon.source.status.loading', 'Loading'),
      variant: 'info',
    };
  }
  if (!state.hasData && state.isPaused) {
    return {
      label: t('carbon.source.status.paused', 'Paused'),
      variant: 'warning',
    };
  }
  if (!state.hasData && state.error) {
    return {
      label: t('carbon.source.status.failed', 'Failed'),
      variant: 'danger',
    };
  }
  if (state.refreshError) {
    return {
      label: t('carbon.source.status.cachedError', 'Cached · refresh failed'),
      variant: 'warning',
    };
  }
  if (state.refreshPaused) {
    return {
      label: t('carbon.source.status.cachedPaused', 'Cached · refresh paused'),
      variant: 'warning',
    };
  }
  if (state.isFetching) {
    return {
      label: t('carbon.source.status.refreshing', 'Refreshing cached data'),
      variant: 'info',
    };
  }
  if (state.hasData) {
    return {
      label: t('carbon.source.status.ready', 'Ready'),
      variant: 'success',
    };
  }
  return {
    label: t('carbon.source.status.pending', 'Pending'),
    variant: 'neutral',
  };
}

function failureLabel(
  id: keyof CarbonQueryStates,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (id === 'intensity') {
    return t('carbon.source.intensityFailed', 'Intensity query failed');
  }
  if (id === 'period') {
    return t('carbon.source.periodFailed', 'Selected-period query failed');
  }
  if (id === 'lifetime') {
    return t('carbon.source.lifetimeFailed', 'Lifetime summary query failed');
  }
  return t('carbon.source.recommendationFailed', 'Recommendation query failed');
}

export function CarbonSourceRow({
  id,
  name,
  scope,
  state,
}: CarbonSourceRowProps) {
  const { t } = useTranslation();
  const status = statusLabel(state, t);

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Text as="p" variant="label">{name}</Text>
          <Text as="p" variant="caption">{scope}</Text>
        </div>
        <Badge variant={status.variant} dot>{status.label}</Badge>
      </div>
      {state.enabled && !state.hasData && state.error ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <Text as="p" variant="bodySm">{failureLabel(id, t)}</Text>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={state.onRetry}
            icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
          >
            {t('carbon.source.retry', 'Retry')}
          </Button>
        </div>
      ) : null}
      {state.refreshError ? (
        <AlertBanner
          className="mt-3"
          variant="warning"
          icon={<AlertTriangle className="h-4 w-4" />}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Text as="p" variant="caption">
              {t(
                'carbon.source.cachedRefreshError',
                'Refresh failed; the most recently loaded evidence remains visible.',
              )}
            </Text>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={state.onRetry}
            >
              {t('carbon.source.retryRefresh', 'Retry refresh')}
            </Button>
          </div>
        </AlertBanner>
      ) : state.refreshPaused ? (
        <AlertBanner className="mt-3" variant="warning">
          {t(
            'carbon.source.cachedRefreshPaused',
            'The network is unavailable; cached evidence remains visible while refresh is paused.',
          )}
        </AlertBanner>
      ) : null}
    </div>
  );
}
