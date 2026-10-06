import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { LayoutCard, PageLayout } from '@/components/layout';
import {
  Badge,
  Button,
  DataTable,
  Text,
  ConfirmDialog,
  type Column,
} from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { EmptyState, Skeleton, QueryError } from '@/components/feedback';
import { AIPiiRedactionSharedExports } from '@/components/ai';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useConfirm } from '@/hooks/useConfirm';
import { useDataState } from '@/hooks/useDataState';
import { StaleRefreshWarning } from '@/components/feedback';

import {
  useExportJobs,
  useBulkExportsDelete,
  exportDownloadUrl,
  type ExportJobSummary,
} from '@/api/hooks/useExports';
import { Icons } from '@/lib/icons';
import { formatDateTime } from '@/lib/dateFormat';


import { ExportKpiBand } from '../components/ExportKpiBand';
import { ExportStatusBreakdown } from '../components/ExportStatusBreakdown';
import { deriveExportStats, statusBadgeVariant } from '../components/exportStats';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/**
 * ExportsPage — full-width command view over past export jobs.
 *
 * Export jobs accumulate quickly (50+ stale rows is common) and the legacy
 * system/data-export page only allows deleting one at a time. This page
 * surfaces a KPI band + status breakdown derived from `/export/jobs`, the
 * opt-in Helix PII-redaction advisor, and a multi-select jobs table backed by
 * `POST /export/jobs/bulk` for bulk deletion.
 */
export default function ExportsPage() {
  const { formatBytes } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('exportsList.title', 'Exports'));

  const jobsQuery = useExportJobs();
  const jobsState = useDataState(jobsQuery);
  const { data: jobsRaw, refetch } = jobsQuery;
  const isLoading = !jobsState.hasData && jobsQuery.isLoading;
  const error = jobsState.fatalError;
  const unresolvedMessage = !jobsState.hasData && !isLoading && !error
    ? jobsQuery.fetchStatus === 'paused'
      ? t('exportsList.source.paused', 'The export-job query is paused; no empty result is inferred.')
      : t('exportsList.source.unresolved', 'Export-job availability has not resolved yet.')
    : undefined;
  const jobs: ExportJobSummary[] = useMemo(() => jobsRaw ?? [], [jobsRaw]);
  const stats = useMemo(() => deriveExportStats(jobs), [jobs]);

  const [selectedKeys, setSelectedKeys] = useState<(string | number)[]>([]);
  const bulkDelete = useBulkExportsDelete();
  const { confirm, dialogProps } = useConfirm();

  const onRetry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const handleBulkDelete = useCallback(
    async (ids: (string | number)[]) => {
      if (ids.length === 0) return;
      const ok = await confirm({
        title: t('exportsList.bulk.deleteConfirm.title', 'Delete export jobs?'),
        message: t(
          'exportsList.bulk.deleteConfirm.body',
          'Selected jobs and their downloadable artifacts will be permanently removed.',
        ),
        confirmLabel: t('common.delete', 'Delete'),
        variant: 'danger',
      });
      if (!ok) return;
      try {
        await bulkDelete.mutateAsync(ids.map((i) => String(i)));
        setSelectedKeys([]);
      } catch {
        // The mutation's onError handler surfaces a toast; keep the current
        // selection intact so the user can retry the failed bulk deletion
        // instead of silently losing their multi-select.
      }
    },
    [confirm, bulkDelete, t],
  );

  const columns = useMemo<Column<ExportJobSummary>[]>(
    () => [
      {
        key: 'type',
        filterValue: (j) => j.type || null,
        header: t('exportsList.col.type', 'Type'),
        sortable: true,
        visibleOnMobile: true,
        render: (j) => (
          <Text weight="medium" color="primary">
            {j.type || '—'}
          </Text>
        ),
      },
      {
        key: 'format',
        filterValue: (j) => j.format || null,
        filterValueLabel: (_value, j) => j.format?.toUpperCase() || '—',
        header: t('exportsList.col.format', 'Format'),
        sortable: true,
        render: (j) => (
          <Text color="secondary" className="">
            {j.format || '—'}
          </Text>
        ),
      },
      {
        key: 'file_size',
        filterValue: (j) => j.file_size ?? null,
        filterValueLabel: (_value, j) => j.file_size == null ? '—' : formatBytes(j.file_size),
        groupStart: true,
        header: t('exportsList.col.size', 'Size'),
        align: 'right',
        sortable: true,
        render: (j) => (
          <Text color="secondary" className="tabular-nums">
            {j.file_size != null ? formatBytes(j.file_size) : '—'}
          </Text>
        ),
      },
      {
        key: 'created_at',
        filterValue: (j) => j.created_at ?? null,
        filterValueLabel: (_value, j) => formatDateTime(j.created_at),
        header: t('exportsList.col.created', 'Created'),
        sortable: true,
        render: (j) => (
          <Text color="secondary">{formatDateTime(j.created_at)}</Text>
        ),
      },
      {
        key: 'status',
        filterValue: (j) => j.status ?? null,
        filterValueLabel: (_value, j) => t(`exportsList.status.${j.status}`, j.status),
        header: t('exportsList.col.status', 'Status'),
        sortable: true,
        visibleOnMobile: true,
        render: (j) => (
          <Badge variant={statusBadgeVariant(j.status)} dot>
            {t(`exportsList.status.${j.status}`, j.status)}
          </Badge>
        ),
      },
      {
        key: 'actions',
        header: t('exportsList.col.actions', 'Actions'),
        align: 'right',
        visibleOnMobile: true,
        render: (j) =>
          j.status === 'ready' ? (
            <a
              href={exportDownloadUrl(j.id)}
              download
              aria-label={t('exportsList.downloadAria', 'Download export {{id}}', {
                id: j.id,
              })}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm text-cyan-300 transition-colors hover:bg-white/[0.04] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
            >
              <Icons.download className="h-4 w-4" aria-hidden="true" />
              {t('exportsList.download', 'Download')}
            </a>
          ) : (
            <Text color="muted">—</Text>
          ),
      },
    ],
    [t, formatBytes],
  );

  const actions = (
    <Button
      variant="ghost"
      onClick={onRetry}
      aria-label={t('common.refresh', 'Refresh')}
    >
      <Icons.refresh className="h-4 w-4" aria-hidden="true" />
    </Button>
  );

  return (
    <PageLayout
      title={t('exportsList.title', 'Exports')}
      subtitle={t(
        'exportsList.subtitle',
        'Manage your past export jobs. Select rows to delete in bulk.',
      )}
      secondaryActions={actions}
      query={jobsQuery}
    >
      <div className="space-y-6">
        <StaleRefreshWarning state={jobsState} />
        {/* 1 — Loaded-list summary; independent of table filters and selection. */}
        <FadeIn>
          <ExportKpiBand stats={stats} isLoading={isLoading} hasData={jobsState.hasData} retained={jobsState.status === 'stale'} sourceState={jobsState} />
        </FadeIn>

        {/* 2 — Opt-in Helix PII-redaction advisor. Renders null when AI is off,
             so it is deliberately NOT wrapped in FadeIn (avoids an empty gap). */}
        <AIPiiRedactionSharedExports />

        {/* 3 — Detail bento: jobs table (hero, spans 2 cols) + status breakdown. */}
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
          <FadeIn delay={0.1} className="min-w-0 xl:col-span-2">
            <LayoutCard title={t('exportsList.jobs.title', 'Export jobs')}>

              {isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-11 w-full" />
                  <Skeleton className="h-11 w-full" />
                  <Skeleton className="h-11 w-full" />
                </div>
              ) : error ? (
                <QueryError
                  error={error}
                  onRetry={onRetry}
                  resourceName={t('exportsList.resource', 'Exports')}
                />
              ) : unresolvedMessage ? (
                <Text as="p" variant="bodySm" role="status">{unresolvedMessage}</Text>
              ) : jobs.length === 0 ? (
                <EmptyState /* no-action: stale-list view — exports appear automatically once generated; nothing for the user to do here */
                  icon={<Icons.package className="h-8 w-8" aria-hidden="true" />}
                  title={t('exportsList.empty.title', 'No exports yet')}
                  message={t(
                    'exportsList.empty.body',
                    'Your future exports will appear here for download or deletion.',
                  )}
                />
              ) : (
                <DataTable
                  tableId="exports:jobs"
                  columns={columns}
                  data={jobs}
                  enableValueFilters
                  keyExtractor={(j) => j.id}
                  mobileColumns={['type', 'status', 'actions']}
                  pagination={{ defaultPageSize: 25, pageSizeOptions: [25, 50, 100] }}
                  stickyHeader
                  maxHeight={640}
                  selectable="multi"
                  // A11Y: export job ids are UUIDs, which a screen
                  // reader spells out character by character. Name each
                  // row by what the user actually recognises.
                  rowLabel={(j) =>
                    t('exportsList.rowLabel', '{{type}} export, {{created}}', {
                      type: j.type || t('exportsList.unknownType', 'Unknown'),
                      created: formatDateTime(j.created_at),
                    })
                  }
                  selectedKeys={selectedKeys}
                  onSelectionChange={setSelectedKeys}
                  bulkActions={(rows) => (
                    <Button
                      size="sm"
                      variant="danger"
                      icon={<Icons.delete className="h-3.5 w-3.5" aria-hidden="true" />}
                      loading={bulkDelete.isPending}
                      onClick={() => void handleBulkDelete(rows.map((r) => r.id))}
                    >
                      {t('exportsList.bulk.delete', 'Delete')}
                    </Button>
                  )}
                />
              )}
            </LayoutCard>
          </FadeIn>

          <FadeIn delay={0.15}>
            <ExportStatusBreakdown
              stats={stats}
              isLoading={isLoading}
              error={error}
              onRetry={onRetry}
              unresolvedMessage={unresolvedMessage ?? undefined}
            />
          </FadeIn>
        </section>
      </div>

      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </PageLayout>
  );
}
