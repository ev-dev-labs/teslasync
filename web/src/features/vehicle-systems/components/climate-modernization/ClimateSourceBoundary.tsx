import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import { SourceContent } from '@/components/layout';
import { Text } from '@/components/ui';
import { getErrorMessage } from '@/lib/errorMessage';
import { typography } from '@/lib/tokens';

/** A fatal source failure replaces only its own body; cached readings survive. */
export function ClimateSourceBoundary<T>({
  state, label, children,
}: {
  state: DataState<T>;
  label: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const initial = !state.hasData && !state.fatalError;
  const retained = state.refreshError != null || (state.hasData && state.isRefreshBlocked);
  const retainedReason = state.refreshError
    ? getErrorMessage(state.refreshError)
    : state.isRefreshBlocked
      ? t('dataSources.status.paused', 'Refresh paused')
      : null;
  return (
    <div className="min-w-0 space-y-3" data-climate-source={label}>
      {initial && (
        <Text as="p" variant="bodySm" className={typography.color.secondary}
          role="status" aria-live="polite">
          {state.isRefreshBlocked
            ? `${t('dataSources.status.paused', 'Refresh paused')} · ${label}`
            : t('developerReference.layout.source.loading', 'Loading {{label}}', { label })}
        </Text>
      )}
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
