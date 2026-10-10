import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import { SourceContent } from '@/components/layout';
import { getErrorMessage } from '@/lib/errorMessage';

/** A fatal source failure replaces only its own body; cached readings survive. */
export function ClimateSourceBoundary<T>({
  state, label, children,
}: {
  state: DataState<T>;
  label: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const retained = state.refreshError != null || (state.hasData && state.isRefreshBlocked);
  const retainedReason = state.refreshError
    ? getErrorMessage(state.refreshError)
    : state.isRefreshBlocked
      ? t('dataState.refreshBlocked.message', 'The device is offline, so this section is showing the last values it received.')
      : null;
  return (
    <div className="min-w-0 space-y-3" data-climate-source={label}>
      <SourceContent
        state={state.fatalError ? 'error' : retained ? 'retained' : 'ready'}
        label={label}
        error={state.fatalError}
        errorMessage={`${t('climate.page.loadFailed', 'Failed to load climate data')}: ${label}`}
        emptyMessage={label}
        retainedMessage={`${t('developerReference.stats.state.retained', 'Showing retained measurements')} · ${label}${retainedReason ? `: ${retainedReason}` : ''}`}
        errorRecovery={{ onRetry: state.retry ?? undefined, resourceName: label }}
      >
        {children}
      </SourceContent>
    </div>
  );
}
