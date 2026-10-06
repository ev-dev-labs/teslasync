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
  return (
    <div className="min-w-0 space-y-3" data-climate-source={label}>
      <SourceContent
        state={state.fatalError ? 'error' : state.refreshError ? 'retained' : 'ready'}
        label={label}
        error={state.fatalError}
        errorMessage={`${t('climate.page.loadFailed', 'Failed to load climate data')}: ${label}`}
        emptyMessage={label}
        retainedMessage={`${t('developerReference.stats.state.retained', 'Showing retained measurements')} · ${label}: ${getErrorMessage(state.refreshError)}`}
        errorRecovery={{ onRetry: state.retry ?? undefined, resourceName: label }}
      >
        {children}
      </SourceContent>
    </div>
  );
}
