import { type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { Text } from '@/components/ui';
import { LayoutCard, SourceContent, type SourceState } from '@/components/layout';
import type { DataStateSource } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';

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
  const message = emptyMessage ?? t('advancedIntelligence.panel.empty', 'No supported data is available.');
  const resolvedState = query
    ? dataState.fatalError ? 'error'
      : dataState.hasData ? dataState.status === 'stale' ? 'retained' : empty ? 'empty' : 'ready'
      : query.isLoading || query.fetchStatus === 'fetching' ? 'loading' : 'empty'
    : sourceState ?? (empty ? 'empty' : 'ready');
  const emptyBody = query && !dataState.hasData && !dataState.fatalError
    ? <Text as="p" variant="bodySm" role="status">
      {query.fetchStatus === 'paused'
        ? t('advancedIntelligence.panel.paused', 'The initial evidence query is paused; no empty result is inferred.')
        : t('advancedIntelligence.panel.unresolved', 'Evidence availability has not resolved yet.')}
    </Text>
    : <EmptyState icon={<Info className="h-6 w-6" aria-hidden="true" />} message={message} />;
  return (
    <div className={className}>
      <LayoutCard title={title} description={description}>
        <SourceContent
          state={resolvedState}
          label={title}
          emptyMessage={message}
          errorMessage={t('advancedIntelligence.panel.error', 'Intelligence evidence could not be loaded.')}
          error={dataState.fatalError ?? error}
          errorRecovery={{ onRetry: onRetry ?? dataState.retry ?? undefined }}
          emptyContent={emptyBody}
        >
          {empty ? emptyBody : children}
        </SourceContent>
      </LayoutCard>
    </div>
  );
}
