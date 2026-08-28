import { type HTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';

import { Badge, Button, Text } from '@/components/ui';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import type { UnavailabilityEvidence } from '@/lib/dataUnavailability';
import { DataStateNotice, type DataStateKind } from './DataStateNotice';

export type DataSourceStatus =
  | 'ready'
  | 'loading'
  | 'refreshing'
  | 'paused'
  | 'failed'
  | 'refreshFailed'
  | 'pending';

export interface DataSourceQuery {
  data?: unknown;
  isLoading?: boolean;
  isPending?: boolean;
  isSuccess?: boolean;
  isError?: boolean;
  isFetching?: boolean;
  fetchStatus?: 'fetching' | 'paused' | 'idle';
  refetch?: () => unknown;
  /**
   * The query's rejection value, when it has one.
   *
   * Call sites already pass whole TanStack query results (`query: someQuery`),
   * so this arrives for free at every existing caller — which is what lets the
   * HELP-04 classifier run in production without touching a single page.
   */
  error?: unknown;
}

export interface DataSourceDescriptor {
  id: string;
  label: string;
  query: DataSourceQuery;
  /** Omit conditionally disabled queries until the user has supplied their prerequisite. */
  enabled?: boolean;
}

export interface DataSourceNoticeProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'title'> {
  sources: readonly DataSourceDescriptor[];
  title?: string;
  message?: string;
  retryLabel?: string;
  /**
   * HELP-04. Extra evidence a page knows but a query result cannot express —
   * most usefully `vehicleState`, and `requestedBeforeRetention` /
   * `filtersActive` for range-scoped views.
   *
   * Merged with the evidence derived from the failing sources below, so a page
   * that supplies nothing still gets error-based classification.
   */
  evidence?: UnavailabilityEvidence;
}

interface ResolvedSource extends DataSourceDescriptor {
  status: DataSourceStatus;
}

const RETRYABLE_STATUSES = new Set<DataSourceStatus>([
  'failed',
  'refreshFailed',
  'paused',
]);

export function resolveDataSourceStatus(
  source: DataSourceDescriptor,
): DataSourceStatus {
  const { query } = source;
  const hasData = query.data !== undefined;

  if (query.isError) return hasData ? 'refreshFailed' : 'failed';
  if (!hasData && query.fetchStatus === 'paused') return 'paused';
  if (
    !hasData
    && (
      query.isLoading
      || query.isFetching
      || (query.isPending && query.fetchStatus === 'fetching')
    )
  ) {
    return 'loading';
  }
  if (hasData && query.isFetching) return 'refreshing';
  if (hasData || query.isSuccess) return 'ready';
  return 'pending';
}

function noticeState(sources: readonly ResolvedSource[]): DataStateKind | null {
  const statuses = sources.map(({ status }) => status);
  const hasUsableData = statuses.some((status) => (
    status === 'ready'
    || status === 'refreshing'
    || status === 'refreshFailed'
  ));
  const hasInitialFailure = statuses.some((status) => (
    status === 'failed' || status === 'paused'
  ));
  const hasDelayedSource = statuses.some((status) => (
    status === 'loading' || status === 'pending'
  ));
  const hasRefreshFailure = statuses.includes('refreshFailed');

  if (!hasInitialFailure && !hasDelayedSource && !hasRefreshFailure) return null;
  if (!hasUsableData && !hasInitialFailure) return null;
  if (!hasUsableData) return 'unavailable';
  if (hasRefreshFailure && !hasInitialFailure && !hasDelayedSource) return 'stale';
  return 'partial';
}

/** Source-aware, non-fatal query state that never replaces usable page content. */
export function DataSourceNotice({
  sources,
  title,
  message,
  retryLabel,
  evidence,
  ...props
}: DataSourceNoticeProps) {
  const { t } = useTranslation();
  const online = useOnlineStatus();
  const resolved = sources
    .filter((source) => source.enabled !== false)
    .map((source) => ({
      ...source,
      status: resolveDataSourceStatus(source),
    }));
  const state = noticeState(resolved);

  if (state == null) return null;

  const statusConfig: Record<
    DataSourceStatus,
    {
      label: string;
      variant: 'success' | 'info' | 'warning' | 'danger' | 'neutral';
    }
  > = {
    ready: {
      label: t('dataSources.status.ready', 'Ready'),
      variant: 'success',
    },
    loading: {
      label: t('dataSources.status.loading', 'Loading'),
      variant: 'info',
    },
    refreshing: {
      label: t('dataSources.status.refreshing', 'Refreshing'),
      variant: 'info',
    },
    paused: {
      label: t('dataSources.status.paused', 'Paused offline'),
      variant: 'warning',
    },
    failed: {
      label: t('dataSources.status.failed', 'Failed'),
      variant: 'danger',
    },
    refreshFailed: {
      label: t('dataSources.status.refreshFailed', 'Cached · refresh failed'),
      variant: 'warning',
    },
    pending: {
      label: t('dataSources.status.pending', 'Pending'),
      variant: 'neutral',
    },
  };
  const defaultMessage = state === 'stale'
    ? t(
        'dataSources.staleMessage',
        'Previously loaded data remains visible while affected sources recover.',
      )
    : state === 'unavailable'
      ? t(
          'dataSources.unavailableMessage',
          'No requested source has returned usable data yet.',
        )
      : t(
          'dataSources.partialMessage',
          'Available sections remain visible. Source status is tracked independently below.',
        );
  const retryable = resolved.filter(({ status, query }) => (
    RETRYABLE_STATUSES.has(status) && query.refetch != null
  ));
  const handleRetry = () => {
    retryable.forEach(({ query }) => {
      void query.refetch?.();
    });
  };

  /**
   * Evidence for the HELP-04 classifier.
   *
   * The first failing source's error is the honest representative: when a
   * page's queries fail together they almost always fail for the same reason
   * (one 403, one outage), and picking the first keeps the result
   * deterministic. Caller-supplied evidence wins on every field it sets —
   * a page knows things a query result cannot express, such as whether the
   * vehicle is asleep.
   */
  const firstFailure = resolved.find(
    ({ status, query }) =>
      (status === 'failed' || status === 'refreshFailed') && query.error != null,
  );
  const derivedEvidence: UnavailabilityEvidence = {
    error: firstFailure?.query.error,
    online,
    ...evidence,
  };

  return (
    <DataStateNotice
      {...props}
      state={state}
      // HELP-04. Every page that declares `dataSources` on <PageContainer>
      // reaches this line, so the classifier runs across the app without a
      // single page edit. `DataStateNotice` returns the generic copy unchanged
      // when nothing explains the failure, so this can never make a notice
      // worse — only more specific.
      evidence={derivedEvidence}
      // Only let the cause drive severity when nothing usable is on screen.
      // With cached rows still visible, a `service_outage` cause must not
      // escalate a quiet "Data may be stale" band into a red alert.
      preserveSeverity={state !== 'unavailable'}
      title={title}
      role={state === 'unavailable' ? 'alert' : 'status'}
      aria-live={state === 'unavailable' ? 'assertive' : 'polite'}
    >
      <div className="space-y-3">
        <Text as="p" variant="bodySm">{message ?? defaultMessage}</Text>
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {resolved.map((source) => {
            const config = statusConfig[source.status];
            return (
              <li
                key={source.id}
                className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2"
              >
                <Text as="span" variant="label" className="min-w-0 truncate">
                  {source.label}
                </Text>
                <Badge variant={config.variant} size="sm" dot>
                  {config.label}
                </Badge>
              </li>
            );
          })}
        </ul>
        {retryable.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleRetry}
            icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
          >
            {retryLabel ?? t('dataSources.retry', 'Retry unavailable sources')}
          </Button>
        ) : null}
      </div>
    </DataStateNotice>
  );
}
