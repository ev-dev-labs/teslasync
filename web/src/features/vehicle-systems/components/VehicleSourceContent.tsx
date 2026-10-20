import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import { SourceContent } from '@/components/layout';
import { getErrorMessage } from '@/lib/errorMessage';

/** Specialist loading, missing signals and vehicle prerequisites stay with the
 * caller. Only a fatal source error may replace those retained presentations. */
export function VehicleSourceContent<T>({
  source, label, enabled = true, children,
}: {
  source: DataState<T>;
  label: string;
  enabled?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const retained = source.refreshError != null || (source.hasData && source.isRefreshBlocked);
  return (
    <SourceContent
      state={!enabled ? 'ready' : source.fatalError ? 'error' : retained ? 'retained' : 'ready'}
      label={label}
      error={source.fatalError}
      errorMessage={`${t('error.loadFailed', 'Failed to load data')}: ${label}`}
      emptyMessage={label}
      retainedMessage={`${t('dataSources.staleMessage', 'Previously loaded data remains visible while affected sources recover.')} · ${label}${source.refreshError ? `: ${getErrorMessage(source.refreshError)}` : ''}`}
      errorRecovery={{ onRetry: source.retry ?? undefined, resourceName: label }}
    >
      {children}
    </SourceContent>
  );
}
