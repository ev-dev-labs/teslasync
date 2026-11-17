import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import type { DataState } from '@/api/dataState';
import { AlertBanner } from '@/components/feedback';
import { Button, Text } from '@/components/ui';

interface FleetSourceStatusProps {
  label: string;
  state: DataState<unknown>;
  isFetching: boolean;
  reading?: ReactNode;
}

/** Source acquisition and retained warnings share a row instead of moving the fleet below them. */
export function FleetSourceStatus({ label, state, isFetching, reading }: FleetSourceStatusProps) {
  const { t } = useTranslation();
  const retainedWarning = state.hasData && state.status !== 'ok';
  const fetching = isFetching && !state.isRefreshBlocked;
  const fatal = state.fatalError != null;
  const message = retainedWarning
    ? state.refreshError != null
      ? t('dataSources.staleMessage', 'Previously loaded data remains visible while affected sources recover.')
      : t('dataState.stale.message', 'The latest values are temporarily unavailable. Previously loaded data remains visible.')
    : state.hasData
      ? <>{t('vehicles.evidenceBrief.status.ok', 'Source returned')}{reading != null ? <> · {reading}</> : null}</>
      : fatal
        ? t('common.unavailable', 'Unavailable')
        : state.isRefreshBlocked
          ? t('fleetOps.brief.refreshBlocked', 'Refresh paused')
          : fetching
            ? t('common.loading', 'Loading...')
            : t('common.unknown', 'Unknown');

  return (
    <AlertBanner
      variant={fatal || (retainedWarning && state.status === 'unavailable') ? 'danger' : retainedWarning ? 'warning' : 'info'}
      title={retainedWarning ? t('dataState.staleNamed.title', '{{label}} may be out of date', { label }) : label}
      role={fatal ? 'alert' : 'status'}
      aria-label={label}
      aria-live={fatal ? 'assertive' : 'polite'}
      data-testid={retainedWarning ? 'stale-refresh-warning' : undefined}
      data-refresh-blocked={state.isRefreshBlocked || undefined}
      className="h-full"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <Text as="p" variant="bodySm" color="secondary" className="min-w-0 flex-1 basis-48 break-words">
          {message}
        </Text>
        {state.retry ? (
          <Button
            data-app-part="feedback-retry"
            type="button"
            variant="ghost"
            size="sm"
            wrapLabel
            className="min-h-11 max-w-full md:min-h-9"
            onClick={state.retry}
            disabled={fetching}
            aria-busy={fetching || undefined}
            icon={<RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          >
            {!state.hasData ? t('common.retry', 'Retry') : fetching
              ? t('freshness.updating', 'Updating…')
              : t('common.refresh', 'Refresh')}
          </Button>
        ) : null}
      </div>
    </AlertBanner>
  );
}
