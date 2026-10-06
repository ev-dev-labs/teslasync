import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataStateSource } from '@/api/dataState';
import { SourceContent } from '@/components/layout';
import { Text } from '@/components/ui';
import { useDataState } from '@/hooks/useDataState';

interface PackRepositorySourceProps<T> {
  query: DataStateSource<T>;
  label: string;
  children: ReactNode;
}

export function PackRepositorySource<T>({ query, label, children }: PackRepositorySourceProps<T>) {
  const { t } = useTranslation();
  const source = useDataState(query);
  const unresolved = !source.hasData && !source.fatalError && query.fetchStatus !== 'fetching';
  const state = source.fatalError ? 'error'
    : !source.hasData ? unresolved ? 'empty' : 'loading'
      : source.refreshError || source.isRefreshBlocked ? 'retained' : 'ready';

  return (
    <SourceContent
      state={state}
      label={label}
      emptyMessage={t('intelPacks.source.unresolved', '{{label}} availability has not resolved yet.', { label })}
      emptyContent={unresolved ? (
        <Text as="p" variant="bodySm" role="status">
          {source.isRefreshBlocked
            ? t('intelPacks.source.paused', 'The local {{label}} read is paused; no empty result is inferred.', { label })
            : t('intelPacks.source.unresolved', '{{label}} availability has not resolved yet.', { label })}
        </Text>
      ) : undefined}
      error={source.fatalError}
      errorMessage={t('intelPacks.source.error', 'Could not read {{label}} from local storage.', { label })}
      errorRecovery={source.retry ? { onRetry: source.retry } : undefined}
    >
      {children}
    </SourceContent>
  );
}
