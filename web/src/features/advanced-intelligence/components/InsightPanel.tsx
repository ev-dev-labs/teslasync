import { type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState, StaleRefreshWarning } from '@/components/feedback';
import { DataFreshness } from '@/components/data-display';
import { Text } from '@/components/ui';
import { LayoutCard, SourceContent, type SourceState } from '@/components/layout';
import type { DataStateSource } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';

interface InsightPanelProps {
  title: string;
  description?: string;
  empty?: boolean;
  emptyMessage?: string;
  children: ReactNode;
  className?: string;
  sourceState?: SourceState;
  error?: unknown;
  onRetry?: () => void;
  query?: DataStateSource<unknown>;
}

export function InsightPanel({
  title,
  description,
  empty = false,
  emptyMessage,
  children,
  className,
  sourceState,
  error,
  onRetry,
  query,
}: InsightPanelProps) {
  const { t } = useTranslation();
  const dataState = useDataState(query ?? {});
  const retry = onRetry ?? dataState.retry ?? undefined;
  const retained = query ? dataState.hasData && dataState.status === 'stale' : sourceState === 'retained';
  const message = emptyMessage ?? t('advancedIntelligence.panel.empty', 'No supported data is available.');
  const resolvedState = query
    ? dataState.fatalError ? 'error'
      : dataState.hasData ? dataState.status === 'stale' ? 'retained' : empty ? 'empty' : 'ready'
      : query.isLoading || query.fetchStatus === 'fetching' ? 'loading' : 'empty'
    : sourceState ?? (empty ? 'empty' : 'ready');
  const emptyBody = query && !dataState.hasData && !dataState.fatalError
    ? <Text as="p" variant="bodySm" className={typography.color.secondary} role="status">
      {query.fetchStatus === 'paused'
        ? t('advancedIntelligence.panel.paused', 'The initial evidence query is paused; no empty result is inferred.')
        : t('advancedIntelligence.panel.unresolved', 'Evidence availability has not resolved yet.')}
    </Text>
    : <EmptyState
      icon={<Info className="h-6 w-6" aria-hidden="true" />}
      message={message}
      action={retry ? { label: t('common.refresh', 'Refresh'), onClick: retry } : undefined}
    />;
  return (
    <div className={cn('min-w-0 break-words', className)}>
      <LayoutCard title={title} description={description} actions={query && dataState.hasData ? (
        <DataFreshness
          source={title}
          updatedAt={dataState.updatedAt}
          isFetching={dataState.isRefreshing}
          isStale={dataState.status === 'stale' || Boolean(query.isStale)}
          isError={dataState.refreshError != null}
        />
      ) : undefined}>
        {query && retained && (
          <StaleRefreshWarning
            state={{ ...dataState, retry: retry ?? null }}
            label={title}
            message={dataState.refreshError
              ? t('tco.query.refreshFailed', 'The refresh failed; the most recently loaded evidence remains visible.')
              : dataState.isRefreshBlocked
                ? t('tco.query.refreshPaused', 'Cached evidence remains visible while its refresh is paused.')
                : undefined}
          />
        )}
        <SourceContent
          state={query && retained ? 'ready' : resolvedState}
          label={title}
          emptyMessage={message}
          errorMessage={t('advancedIntelligence.panel.error', 'Intelligence evidence could not be loaded.')}
          error={query ? dataState.fatalError : error}
          errorRecovery={{ onRetry: retry }}
          emptyContent={emptyBody}
        >
          {empty && (!retained || (Array.isArray(dataState.data) && dataState.data.length === 0)) ? emptyBody : children}
        </SourceContent>
      </LayoutCard>
    </div>
  );
}
