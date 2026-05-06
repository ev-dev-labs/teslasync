import { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, Badge } from '@/components/ui';
import { BulkActionToolbar } from '@/components/data-display';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { EmptyState, Skeleton, ErrorDisplay } from '@/components/feedback';
import { VisuallyHidden } from '@/components/a11y';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useBulkSelection } from '@/hooks/useBulkSelection';

import {
  useExportJobs,
  useBulkExportsDelete,
  exportDownloadUrl,
  type ExportJobSummary,
} from '@/api/hooks/useExports';
import { Icons } from '@/lib/icons';
import { formatDateTime } from '@/lib/dateFormat';
import { formatBytes } from '@/lib/numberFormat';

/**
 * ExportsPage — list of past export jobs with bulk delete. Phase-45 / 32.
 *
 * Export jobs accumulate quickly (50+ stale rows is common) and the
 * existing system/data-export page only allows deleting one at a time.
 * This page re-uses the same /export/jobs query and offers a bulk-delete
 * action backed by `POST /export/jobs/bulk`.
 */
export default function ExportsPage() {
  const { t } = useTranslation();
  usePageTitle(t('exportsList.title', 'Exports'));

  const { data: jobsRaw, isLoading, error } = useExportJobs();
  const jobs: ExportJobSummary[] = useMemo(() => jobsRaw ?? [], [jobsRaw]);
  const visibleIds = useMemo(() => jobs.map((j) => j.id), [jobs]);

  const sel = useBulkSelection<string>();
  const bulkDelete = useBulkExportsDelete();

  const masterState = sel.masterState(visibleIds);

  const onMasterToggle = useCallback(() => {
    sel.toggleAll(visibleIds);
  }, [sel, visibleIds]);

  const statusVariant = (s: ExportJobSummary['status']) => {
    if (s === 'ready') return 'success' as const;
    if (s === 'failed') return 'danger' as const;
    if (s === 'processing' || s === 'queued') return 'info' as const;
    return 'neutral' as const;
  };

  return (
    <PageContainer
      title={t('exportsList.title', 'Exports')}
      subtitle={t(
        'exportsList.subtitle',
        'Manage your past export jobs. Select rows to delete in bulk.',
      )}
    >
      <FadeIn>
        <BulkActionToolbar
          selectedIds={Array.from(sel.selectedIds)}
          total={visibleIds.length}
          onClear={sel.clear}
          itemNoun={{
            one: t('exportsList.noun.one', 'export'),
            other: t('exportsList.noun.other', 'exports'),
          }}
          actions={[
            {
              id: 'delete',
              label: t('exportsList.bulk.delete', 'Delete'),
              variant: 'danger',
              icon: <Icons.delete className="h-4 w-4" />,
              confirm: {
                title: t('exportsList.bulk.deleteConfirm.title', 'Delete export jobs?'),
                description: t(
                  'exportsList.bulk.deleteConfirm.body',
                  'Selected jobs and their downloadable artifacts will be permanently removed.',
                ),
                confirmLabel: t('common.delete', 'Delete'),
              },
              onClick: async (ids) => {
                await bulkDelete.mutateAsync(ids.map((i) => String(i)));
                sel.clear();
              },
            },
          ]}
        />

        <GlassPanel className="overflow-hidden">
          {isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : error ? (
            <ErrorDisplay error={error} />
          ) : jobs.length === 0 ? (
            <EmptyState /* no-action: stale-list view — exports show up automatically when generated; user has no direct action to take from this empty state */
              title={t('exportsList.empty.title', 'No exports yet')}
              message={t(
                'exportsList.empty.body',
                'Your future exports will appear here for download or deletion.',
              )}
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--border-subtle)] bg-[var(--surface-2)] text-left text-[var(--text-secondary)]">
                <tr>
                  <th className="w-12 px-3 py-3">
                    <VisuallyHidden as="label" htmlFor="exports-master">
                      {t('bulk.selectAll', 'Select all')}
                    </VisuallyHidden>
                    <input
                      id="exports-master"
                      type="checkbox"
                      checked={masterState === 'all'}
                      ref={(el) => {
                        if (el) el.indeterminate = masterState === 'some';
                      }}
                      onChange={onMasterToggle}
                      className="h-4 w-4 cursor-pointer rounded border-[var(--border-strong)] bg-transparent"
                      aria-label={t('bulk.selectAll', 'Select all')}
                    />
                  </th>
                  <th className="px-3 py-3">{t('exportsList.col.type', 'Type')}</th>
                  <th className="px-3 py-3">{t('exportsList.col.format', 'Format')}</th>
                  <th className="px-3 py-3">{t('exportsList.col.size', 'Size')}</th>
                  <th className="px-3 py-3">{t('exportsList.col.created', 'Created')}</th>
                  <th className="px-3 py-3">{t('exportsList.col.status', 'Status')}</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const checked = sel.isSelected(j.id);
                  return (
                    <tr
                      key={j.id}
                      className="border-b border-[var(--border-subtle)] hover:bg-[var(--surface-2)]"
                      data-selected={checked || undefined}
                    >
                      <td className="px-3 py-3">
                        <VisuallyHidden as="label" htmlFor={`export-${j.id}`}>
                          {t('bulk.selectRow', 'Select row')}
                        </VisuallyHidden>
                        <input
                          id={`export-${j.id}`}
                          type="checkbox"
                          checked={checked}
                          onChange={() => sel.toggle(j.id)}
                          className="h-4 w-4 cursor-pointer rounded border-[var(--border-strong)] bg-transparent"
                          aria-label={t('exportsList.selectExport', 'Select export {{id}}', { id: j.id })}
                        />
                      </td>
                      <td className="px-3 py-3 text-[var(--text-primary)]">{j.type}</td>
                      <td className="px-3 py-3 text-[var(--text-secondary)] uppercase">
                        {j.format}
                      </td>
                      <td className="px-3 py-3 text-[var(--text-secondary)]">
                        {j.file_size != null ? formatBytes(j.file_size) : '—'}
                      </td>
                      <td className="px-3 py-3 text-[var(--text-secondary)]">
                        {formatDateTime(j.created_at)}
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant={statusVariant(j.status)}>
                          {t(`exportsList.status.${j.status}`, j.status)}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-right">
                        {j.status === 'ready' ? (
                          <a
                            href={exportDownloadUrl(j.id)}
                            className="text-cyan-300 underline-offset-2 hover:underline"
                            download
                          >
                            {t('exportsList.download', 'Download')}
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
