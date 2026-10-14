import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import { SourceContent } from '@/components/layout';
import { StaleRefreshWarning } from '@/components/feedback';
import { Button, Caption } from '@/components/ui';
import type { DashcamSettings } from '../../lib/types';

interface DashcamSettingsSourceProps {
  source: DataState<DashcamSettings>;
  isLoading: boolean;
  children?: ReactNode;
}

/** Local settings recover independently of clip and telemetry sources. */
export function DashcamSettingsSource({ source, isLoading, children }: DashcamSettingsSourceProps) {
  const { t } = useTranslation();
  const label = t('settings.title', 'Settings');

  return (
    <section aria-label={label} className="min-w-0 space-y-3">
      <StaleRefreshWarning state={source} label={label} />
      <SourceContent
        state={source.fatalError ? 'error' : source.hasData ? 'ready' : isLoading ? 'loading' : 'empty'}
        label={label}
        error={source.fatalError}
        errorMessage={t('error.loadFailed', 'Failed to load data')}
        emptyMessage={t('dataSources.status.pending', 'Pending')}
        emptyContent={
          <div role="status" className="space-y-2">
            <Caption>{source.isRefreshBlocked
              ? t('dataSources.status.paused', 'Refresh paused')
              : t('dataSources.status.pending', 'Pending')}</Caption>
            {source.retry && (
              <Button variant="secondary" onClick={source.retry}>
                {t('error.retry', 'Retry')}
              </Button>
            )}
          </div>
        }
        errorRecovery={{ onRetry: source.retry ?? undefined, resourceName: label }}
      >
        {children}
      </SourceContent>
    </section>
  );
}
