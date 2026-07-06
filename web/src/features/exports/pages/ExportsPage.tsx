import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageContainer } from '@/components/layout';
import {
  GlassPanel,
  Badge,
  Button,
  DataTable,
  PanelTitle,
  Text,
  ConfirmDialog,
  type Column,
} from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { EmptyState, Skeleton, QueryError } from '@/components/feedback';
import { AIPiiRedactionSharedExports } from '@/components/ai/AIPiiRedactionSharedExports';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useConfirm } from '@/hooks/useConfirm';

import {
  useExportJobs,
  useBulkExportsDelete,
  exportDownloadUrl,
  type ExportJobSummary,
} from '@/api/hooks/useExports';
import { Icons } from '@/lib/icons';
import { formatDateTime } from '@/lib/dateFormat';
import { formatBytes } from '@/lib/numberFormat';

import { ExportKpiBand } from '../components/ExportKpiBand';
import { ExportStatusBreakdown } from '../components/ExportStatusBreakdown';
import { deriveExportStats, statusBadgeVariant } from '../components/exportStats';

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
  const { t } = useTranslation();
  usePageTitle(t('exportsList.title', 'Exports'));

  const jobsQuery = useExportJobs();
  const { data: jobsRaw, isLoading, error, refetch } = jobsQuery;
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
        header: t('exportsList.col.format', 'Format'),
        sortable: true,
        render: (j) => (
          <Text color="secondary" className="uppercase">
            {j.format || '—'}
          </Text>
        ),
      },
      {
        key: 'file_size',
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
        header: t('exportsList.col.created', 'Created'),
        sortable: true,
        render: (j) => (
          <Text color="secondary">{formatDateTime(j.created_at)}</Text>
        ),
      },
      {
        key: 'status',
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
    [t],
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
    <PageContainer
      title={t('exportsList.title', 'Exports')}
      subtitle={t(
        'exportsList.subtitle',
        'Manage your past export jobs. Select rows to delete in bulk.',
      )}
      actions={actions}
      query={jobsQuery}
    >
      <div className="space-y-6">
        {/* 1 — KPI band: full-width, reflows up to 5 columns on wide screens. */}
        <FadeIn>
          <ExportKpiBand stats={stats} isLoading={isLoading} />
        </FadeIn>

        {/* 2 — Opt-in Helix PII-redaction advisor. Renders null when AI is off,
             so it is deliberately NOT wrapped in FadeIn (avoids an empty gap). */}
        <AIPiiRedactionSharedExports />

        {/* 3 — Detail bento: jobs table (hero, spans 2 cols) + status breakdown. */}
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
          <FadeIn delay={0.1} className="xl:col-span-2">
            <GlassPanel className="flex h-full flex-col overflow-hidden p-4 sm:p-5">
              <PanelTitle className="mb-3 flex items-center gap-2">
                <Icons.package className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('exportsList.jobs.title', 'Export Jobs')}
              </PanelTitle>

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
                  keyExtractor={(j) => j.id}
                  mobileColumns={['type', 'status', 'actions']}
                  pagination={{ defaultPageSize: 25, pageSizeOptions: [25, 50, 100] }}
                  stickyHeader
                  maxHeight={640}
                  selectable="multi"
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
            </GlassPanel>
          </FadeIn>

          <FadeIn delay={0.15}>
            <ExportStatusBreakdown
              stats={stats}
              isLoading={isLoading}
              error={error}
              onRetry={onRetry}
            />
          </FadeIn>
        </section>
      </div>

      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </PageContainer>
  );
}
