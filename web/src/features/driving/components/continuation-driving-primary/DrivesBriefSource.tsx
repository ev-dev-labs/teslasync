import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutCard, SourceContent } from '@/components/layout';
import { DataStateNotice, Skeleton } from '@/components/feedback';
import { Button } from '@/components/ui';

interface DrivesBriefSourceProps {
  initial: boolean;
  unavailable?: boolean;
  fatalError: Error | null;
  onRetry: () => void;
  children: ReactNode;
}

export function DrivesBriefSource({ initial, unavailable = false, fatalError, onRetry, children }: DrivesBriefSourceProps) {
  const { t } = useTranslation();
  // The ready brief already owns its surface; only unresolved bodies need a shell.
  if (!initial && !fatalError && !unavailable) return <>{children}</>;
  return (
    <LayoutCard title={t('operations.drives.title', 'Activity, efficiency, and exceptions in context')}>
      <SourceContent
        state={initial ? 'loading' : fatalError ? 'error' : 'empty'}
        label={t('operations.drives.historySource', 'Drive history')}
        emptyMessage={t('drives.noStatsRange', 'No drives in this range')}
        errorMessage={t('drives.sourceError', 'Drive history could not be loaded')}
        error={fatalError}
        errorRecovery={{ onRetry }}
        loadingContent={<Skeleton className="h-32" />}
        emptyContent={<DataStateNotice state="unavailable"
          title={t('drives.sourceUnavailable', 'Drive history is unavailable')}>
          <Button variant="secondary" size="sm" wrapLabel onClick={onRetry}>{t('common.retry', 'Retry')}</Button>
        </DataStateNotice>}
      >{null}</SourceContent>
    </LayoutCard>
  );
}
