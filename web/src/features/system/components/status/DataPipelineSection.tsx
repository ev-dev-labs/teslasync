import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Archive, TrendingUp, HardDrive, BarChart3, Clock, Activity,
  CheckCircle, XCircle,
} from 'lucide-react';
import { Grid } from '@/components/layout';
import { Badge, DataTable, type Column } from '@/components/ui';
import { MetricCard, StatCard } from '@/components/data-display';
import { RadialGauge } from '@/components/charts';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';
import { formatDateTime } from '@/lib/dateFormat';
import { getCompressionStats, getExportJobs as getDevtoolsExportJobs } from '@/api/devtools';
import type { ExportJobSummary } from '@/api/types';
import { AccordionSection } from './AccordionSection';
import { getStatusIcon, statusTextClass, formatBytes } from './helpers';

export function DataPipelineSection() {
  const { t } = useTranslation();

  const {
    data: compression,
    isLoading: compLoading,
    error: compError,
    refetch: refetchCompression,
  } = useQuery({
    queryKey: ['system-status', 'compression'],
    queryFn: getCompressionStats,
    refetchInterval: 30_000,
  });

  const {
    data: exportJobs,
    isLoading: exportLoading,
    error: exportError,
    refetch: refetchExportJobs,
  } = useQuery({
    queryKey: ['system-status', 'export-jobs'],
    queryFn: () => getDevtoolsExportJobs(),
    refetchInterval: 15_000,
  });

  const isLoading = compLoading || exportLoading;

  const exportColumns = useMemo<Column<ExportJobSummary>[]>(() => [
    {
      key: 'status', header: t('Status'),
      render: (row) => (
        <div className="flex items-center gap-2">
          {getStatusIcon(row.status)}
          <span className={statusTextClass(row.status)}>{row.status}</span>
        </div>
      ),
    },
    { key: 'type', header: t('Type'), render: (row) => row.type },
    { key: 'format', header: t('Format'), render: (row) => <Badge variant="neutral" size="sm">{row.format}</Badge> },
    {
      key: 'file_name', header: t('File'),
      render: (row) => <span className="font-mono text-xs truncate max-w-[200px] block">{row.file_name}</span>,
    },
    { key: 'record_count', header: t('Records'), sortable: true, render: (row) => fmtInt(row.record_count) },
    { key: 'created_at', header: t('Created'), render: (row) => formatDateTime(row.created_at) },
  ], [t]);

  const { pendingJobs, processingJobs, completedJobs, failedJobs } = useMemo(() => {
    const list = exportJobs ?? [];
    return {
      pendingJobs: list.filter((j) => j.status === 'queued').length,
      processingJobs: list.filter((j) => j.status === 'processing').length,
      completedJobs: list.filter((j) => j.status === 'ready').length,
      failedJobs: list.filter((j) => j.status === 'failed').length,
    };
  }, [exportJobs]);

  const hasJobs = (exportJobs?.length ?? 0) > 0;

  return (
    <AccordionSection
      icon={<Archive className="h-5 w-5" />}
      title={t('Data Pipeline')}
      description={t('Compression statistics and export job queue')}
      badges={
        <>
          {compression && (
            <Badge variant="info" size="sm">{fmtPercent(compression.savings_percent)} {t('saved')}</Badge>
          )}
          {pendingJobs + processingJobs > 0 && (
            <Badge variant="warning" size="sm">{pendingJobs + processingJobs} {t('active')}</Badge>
          )}
        </>
      }
    >
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-48" />
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{t('Compression Statistics')}</h4>
            {compError ? (
              <QueryError error={compError} onRetry={() => refetchCompression()} />
            ) : compression ? (
              <>
                <Grid cols={{ default: 2, md: 4 }} gap={3}>
                  <MetricCard label={t('Compression Ratio')} value={fmtPercent(compression.savings_percent)} icon={<TrendingUp className="h-4 w-4" />} color="green" />
                  <MetricCard label={t('Estimated Savings')} value={formatBytes(compression.estimated_saved_bytes)} icon={<HardDrive className="h-4 w-4" />} color="cyan" />
                  <MetricCard label={t('Total Positions')} value={fmtInt(compression.total_positions)} icon={<BarChart3 className="h-4 w-4" />} color="purple" />
                  <MetricCard label={t('Compressed')} value={fmtInt(compression.compressed_positions)} icon={<Archive className="h-4 w-4" />} color="cyan" />
                </Grid>
                <div className="mt-4 flex justify-center">
                  <RadialGauge value={compression.savings_percent} max={100} label={t('Savings')} unit="%" color="#22c55e" size={140} />
                </div>
              </>
            ) : (
              <EmptyState /* no-action: transient empty state - surfaces when compression stats are unavailable; no specific recovery action applies */ message={t('No compression statistics available')} />
            )}
          </div>

          <div>
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{t('Export Job Queue')}</h4>
            {exportError ? (
              <QueryError error={exportError} onRetry={() => refetchExportJobs()} />
            ) : hasJobs ? (
              <>
                <Grid cols={{ default: 2, md: 4 }} gap={3} className="mb-4">
                  <StatCard label={t('Pending')} value={pendingJobs} icon={<Clock className="h-4 w-4" />} />
                  <StatCard label={t('Processing')} value={processingJobs} icon={<Activity className="h-4 w-4" />} />
                  <StatCard label={t('Completed')} value={completedJobs} icon={<CheckCircle className="h-4 w-4" />} />
                  <StatCard label={t('Failed')} value={failedJobs} icon={<XCircle className="h-4 w-4" />} />
                </Grid>
                <DataTable
                  tableId="system:pipeline-export-jobs"
                  columns={exportColumns}
                  data={exportJobs ?? []}
                  keyExtractor={(j) => j.id}
                  compact
                  pagination
                  emptyMessage={t('No export jobs')}
                />
              </>
            ) : (
              <EmptyState /* no-action: transient empty state - surfaces when source data is missing; no specific recovery action available */ message={t('No export jobs in queue')} />
            )}
          </div>
        </div>
      )}
    </AccordionSection>
  );
}
