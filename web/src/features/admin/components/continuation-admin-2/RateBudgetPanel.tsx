import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import type { useRateLimitStatus } from '@/api/hooks/useSystem';
import { deriveDataState } from '@/api/dataState';
import { LayoutCard } from '@/components/layout';
import { Button, Caption, Text } from '@/components/ui';
import { ListSkeleton, AlertBanner } from '@/components/feedback';
import { formatRelative } from '@/lib/dateFormat';
import { AdminSourceContent } from './AdminSourceContent';
import { RateBudgetRow } from './RateBudgetRow';

export function RateBudgetPanel({ query }: { query: ReturnType<typeof useRateLimitStatus> }) {
  const { t } = useTranslation();
  const source = deriveDataState(query);
  const scopes = source.data?.scopes ?? [];
  return (
    <div data-testid="rate-limit-status-panel" className="min-w-0">
      <LayoutCard title={t('rateLimitStatus.title', 'Rate-limit budgets')}
        description={t('rateLimitStatus.subtitle', 'Live view of active request throttles and the shared UTC-daily Tesla Fleet API spend guard. Cost rows are conservative estimates reserved before outbound calls.')}
        actions={<Button variant="ghost" wrapLabel onClick={() => { void query.refetch(); }} loading={query.isFetching && !query.isLoading} disabled={query.isFetching}
          icon={<RefreshCw className="h-4 w-4" aria-hidden />} data-testid="rate-limit-refresh-button">{t('rateLimitStatus.refresh', 'Refresh')}</Button>}>
        {source.data?.generated_at && <Caption>{t('rateLimitStatus.lastUpdated', 'Updated {{when}}', { when: formatRelative(source.data.generated_at) })}</Caption>}
        {!!source.data?.warnings?.length && <AlertBanner variant="warning" data-testid="rate-limit-warning">
          {source.data.warnings.map((warning) => <Text key={warning} variant="bodySm">{warning}</Text>)}
        </AlertBanner>}
        <AdminSourceContent source={source} fatalTestId="rate-limit-error" retryOnRetained={false} label={t('rateLimitStatus.title', 'Rate-limit budgets')} emptyMessage={t('rateLimitStatus.empty', 'No rate-limited resources are currently observed. Counters appear here once the API has handled at least one request.')}
          fatalMessage={<Text variant="error">{t('rateLimitStatus.error', 'Could not load rate-limit status. Check API logs and try again.')}</Text>}
          loadingContent={<ListSkeleton rows={3} label={t('rateLimitStatus.loading', 'Loading rate-limit status…')} testId="rate-limit-loading" />}>
          {scopes.length === 0 ? <Text variant="bodySm" data-testid="rate-limit-empty">{t('rateLimitStatus.empty', 'No rate-limited resources are currently observed. Counters appear here once the API has handled at least one request.')}</Text>
            : <div className="space-y-5" data-testid="rate-limit-rows">{scopes.map((scope) => <RateBudgetRow key={scope.id} scope={scope} />)}</div>}
        </AdminSourceContent>
      </LayoutCard>
    </div>
  );
}
