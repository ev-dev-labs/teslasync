import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import type { BenchmarkPrivacyStatus } from '@/api/hooks/useBenchmarks';
import { SourceContent } from '@/components/layout';
import { StaleRefreshWarning } from '@/components/feedback';

export function BenchmarkStatusContent({
  source, label, children,
}: {
  source?: DataState<BenchmarkPrivacyStatus>;
  label: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (!source) return <>{children}</>;
  return (
    <>
      <StaleRefreshWarning state={source} />
      <SourceContent
        state={source.fatalError ? 'error' : !source.hasData ? 'loading' : 'ready'}
        label={label}
        emptyMessage={t('benchmarks.budget.unavailable', 'Budget unavailable')}
        errorMessage={t('error.loadFailed', 'Failed to load data')}
        error={source.fatalError}
        errorRecovery={{ onRetry: source.retry ?? undefined }}
      >
        {children}
      </SourceContent>
    </>
  );
}
