import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import { AlertBanner, ErrorDisplay } from '@/components/feedback';
import { Button } from '@/components/ui';
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
  if (state.fatalError) {
    return (
      <div className="space-y-3" data-climate-source={label}>
        <ErrorDisplay compact error={state.fatalError}
          message={`${t('climate.page.loadFailed', 'Failed to load climate data')}: ${label}`} />
        {state.retry && <Button variant="secondary" size="sm" onClick={state.retry}>
          {t('common.retry', 'Retry')}
        </Button>}
      </div>
    );
  }
  return (
    <div className="min-w-0 space-y-3" data-climate-source={label}>
      {state.refreshError && <AlertBanner variant="warning">
        {t('developerReference.stats.state.retained', 'Showing retained measurements')}
        {' · '}{label}: {getErrorMessage(state.refreshError)}
        {state.retry && <Button variant="ghost" size="sm" onClick={state.retry}>
          {t('common.retry', 'Retry')}
        </Button>}
      </AlertBanner>}
      {children}
    </div>
  );
}
