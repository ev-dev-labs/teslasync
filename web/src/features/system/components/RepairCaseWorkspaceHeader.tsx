import { Activity, Radar } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RepairCaseStats as RepairCaseStatsData } from '@/api/hooks/useRepairCaseStats';
import type { DataState } from '@/api/dataState';
import { QueryError, StaleRefreshWarning } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import { Badge, Button, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { formatDateTime } from '@/lib/dateFormat';
import { RepairCaseStats } from './RepairCaseStats';

interface RepairCaseWorkspaceHeaderProps {
  statistics?: RepairCaseStatsData;
  statisticsLoading: boolean;
  statisticsBusy: boolean;
  statisticsError: unknown;
  statisticsState?: DataState<RepairCaseStatsData>;
  scanPending: boolean;
  canWrite: boolean;
  writeBlockReason?: string;
  onScan: () => void;
  onRetryStatistics: () => void;
}

export function RepairCaseWorkspaceHeader({
  statistics,
  statisticsLoading,
  statisticsBusy,
  statisticsError,
  statisticsState: suppliedStatisticsState,
  scanPending,
  canWrite,
  writeBlockReason,
  onScan,
  onRetryStatistics,
}: RepairCaseWorkspaceHeaderProps) {
  const { t } = useTranslation();
  const fallbackStatisticsState = useDataState({
    data: statistics,
    error: statisticsError,
    isLoading: statisticsLoading,
    isFetching: statisticsBusy,
    refetch: onRetryStatistics,
  });
  const statisticsState = suppliedStatisticsState ?? fallbackStatisticsState;

  return (
    <GlassPanel className="relative overflow-hidden p-0">
      <div className="flex flex-col gap-5 p-5 sm:p-6 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-shape-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-secondary)]">
            <Activity className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <PanelTitle id="repair-case-workspace-title">
                {t('dataRepair.cases.workspaceTitle', 'Integrity command center')}
              </PanelTitle>
              <Badge
                variant={statisticsState.fatalError ? 'danger' : statisticsState.status === 'stale' ? 'warning' : !statisticsState.hasData ? 'neutral' : statisticsState.isRefreshing ? 'info' : 'success'}
                dot
              >
                {statisticsState.isRefreshBlocked
                  ? t('dataSources.status.paused', 'Refresh paused')
                  : statisticsLoading
                  ? t('common.loading', 'Loading')
                  : !statisticsState.hasData
                  ? t('dataRepair.cases.metricsUnavailable', 'Metrics unavailable')
                  : statisticsState.refreshError
                    ? t('dataRepair.cases.metricsRetained', 'Retained metrics')
                  : statisticsState.isRefreshing
                    ? t('dataRepair.cases.refreshing', 'Refreshing')
                    : t('dataRepair.cases.monitoring', 'Monitoring')}
              </Badge>
            </div>
            <Text as="p" variant="bodySm" className="mt-1 max-w-3xl">
              {t(
                'dataRepair.cases.workspaceDescription',
                'Continuous detection creates durable, assignable cases. No repair is applied without operator review.',
              )}
            </Text>
            <Text as="p" variant="caption" className="mt-2">
              {!statisticsState.hasData
                ? '—'
                : statisticsState.data?.last_scan_at
                ? t('dataRepair.cases.lastScan', 'Last scan: {{time}}', {
                    time: formatDateTime(statisticsState.data.last_scan_at),
                  })
                : t('dataRepair.cases.noScan', 'No completed scan recorded yet')}
            </Text>
          </div>
        </div>
        <Button
          variant="primary"
          icon={<Radar className="h-4 w-4" aria-hidden="true" />}
          loading={scanPending}
          onClick={onScan}
          disabled={!canWrite}
          title={!canWrite ? writeBlockReason : undefined}
          className="min-h-11 shrink-0"
        >
          {t('dataRepair.cases.scanNow', 'Run integrity scan')}
        </Button>
      </div>
      <StaleRefreshWarning state={statisticsState} label={t('dataRepair.cases.metricsResource', 'Repair case metrics')} className="px-4 sm:px-5" />
      {statisticsState.fatalError ? (
        <div className="border-t border-[var(--border-subtle)] p-4 sm:p-5">
          <QueryError
            error={statisticsState.fatalError}
            resourceName={t('dataRepair.cases.metricsResource', 'Repair case metrics')}
            onRetry={onRetryStatistics}
          />
        </div>
      ) : null}
      <RepairCaseStats statistics={statisticsState.data} loading={statisticsLoading && !statisticsState.hasData}
        retained={statisticsState.hasData && statisticsState.status !== 'ok'} />
    </GlassPanel>
  );
}
