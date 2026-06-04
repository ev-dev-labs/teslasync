import { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { GlassPanel, Badge } from '@/components/ui';
import { BulkActionToolbar } from '@/components/data-display';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { EmptyState, Skeleton, ErrorDisplay } from '@/components/feedback';
import { VisuallyHidden } from '@/components/a11y';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useBulkSelection } from '@/hooks/useBulkSelection';

import {
  useAutomations,
  useBulkAutomationsUpdate,
} from '@/api/hooks/useAutomations';
import type { Automation } from '@/api/types';
import { Icons } from '@/lib/icons';

/**
 * AutomationListPage — focused list view of every automation with bulk
 * enable, disable, and delete actions.
 *
 * Acts as the streamlined "manage many at once" alternative to the
 * card-based AutomationsListPage, which surfaces the rich preview UI
 * for browsing one at a time. Both pages co-exist; users with dozens of
 * automations gain bulk control here.
 */
export default function AutomationListPage() {
  const { t } = useTranslation();
  usePageTitle(t('automationList.title', 'Automations (list)'));

  const { data: rowsRaw, isLoading, error } = useAutomations();
  const automations: Automation[] = useMemo(() => rowsRaw ?? [], [rowsRaw]);
  const visibleIds = useMemo(() => automations.map((a) => a.id), [automations]);

  const sel = useBulkSelection<number>();
  const bulkUpdate = useBulkAutomationsUpdate();

  const masterState = sel.masterState(visibleIds);

  const onMasterToggle = useCallback(() => {
    sel.toggleAll(visibleIds);
  }, [sel, visibleIds]);

  return (
    <PageContainer
      title={t('automationList.title', 'Automations (list)')}
      subtitle={t(
        'automationList.subtitle',
        'Bulk-manage automations. Click an automation to edit it in the builder.',
      )}
    >
      <FadeIn>
        <BulkActionToolbar
          selectedIds={Array.from(sel.selectedIds)}
          total={visibleIds.length}
          onClear={sel.clear}
          itemNoun={{
            one: t('automationList.noun.one', 'automation'),
            other: t('automationList.noun.other', 'automations'),
          }}
          actions={[
            {
              id: 'enable',
              label: t('automationList.bulk.enable', 'Enable'),
              icon: <Icons.play className="h-4 w-4" />,
              onClick: async (ids) => {
                await bulkUpdate.mutateAsync({
                  ids: ids.map((i) => Number(i)),
                  op: 'enable',
                });
                sel.clear();
              },
            },
            {
              id: 'disable',
              label: t('automationList.bulk.disable', 'Disable'),
              icon: <Icons.pause className="h-4 w-4" />,
              onClick: async (ids) => {
                await bulkUpdate.mutateAsync({
                  ids: ids.map((i) => Number(i)),
                  op: 'disable',
                });
                sel.clear();
              },
            },
            {
              id: 'delete',
              label: t('automationList.bulk.delete', 'Delete'),
              variant: 'danger',
              icon: <Icons.delete className="h-4 w-4" />,
              confirm: {
                title: t(
                  'automationList.bulk.deleteConfirm.title',
                  'Delete automations?',
                ),
                description: t(
                  'automationList.bulk.deleteConfirm.body',
                  'Selected automations will stop running and be removed permanently. This cannot be undone.',
                ),
                confirmLabel: t('common.delete', 'Delete'),
              },
              onClick: async (ids) => {
                await bulkUpdate.mutateAsync({
                  ids: ids.map((i) => Number(i)),
                  op: 'delete',
                });
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
          ) : automations.length === 0 ? (
            <EmptyState
              title={t('automationList.empty.title', 'No automations yet')}
              message={t(
                'automationList.empty.body',
                'Create your first automation in the builder.',
              )}
              actionTo={{
                label: t('automationList.empty.cta', 'Open builder'),
                to: '/automations/new',
              }}
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--border-subtle)] bg-[var(--surface-2)] text-left text-[var(--text-secondary)]">
                <tr>
                  <th className="w-12 px-3 py-3">
                    <VisuallyHidden as="label" htmlFor="automations-master">
                      {t('bulk.selectAll', 'Select all')}
                    </VisuallyHidden>
                    <input
                      id="automations-master"
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
                  <th className="px-3 py-3">{t('automationList.col.name', 'Name')}</th>
                  <th className="px-3 py-3">{t('automationList.col.desc', 'Description')}</th>
                  <th className="px-3 py-3">{t('automationList.col.runs', 'Runs')}</th>
                  <th className="px-3 py-3">{t('automationList.col.status', 'Status')}</th>
                </tr>
              </thead>
              <tbody>
                {automations.map((a) => {
                  const checked = sel.isSelected(a.id);
                  return (
                    <tr
                      key={a.id}
                      className="border-b border-[var(--border-subtle)] hover:bg-[var(--surface-2)]"
                      data-selected={checked || undefined}
                    >
                      <td className="px-3 py-3">
                        <VisuallyHidden as="label" htmlFor={`automation-${a.id}`}>
                          {t('bulk.selectRow', 'Select row')}
                        </VisuallyHidden>
                        <input
                          id={`automation-${a.id}`}
                          type="checkbox"
                          checked={checked}
                          onChange={() => sel.toggle(a.id)}
                          className="h-4 w-4 cursor-pointer rounded border-[var(--border-strong)] bg-transparent"
                          aria-label={t('automationList.selectAutomation', 'Select automation {{name}}', { name: a.name })}
                        />
                      </td>
                      <td className="px-3 py-3 font-medium text-[var(--text-primary)]">
                        <Link
                          to={`/automations/${a.id}`}
                          className="text-cyan-300 underline-offset-2 hover:underline"
                        >
                          {a.name}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-[var(--text-secondary)]">
                        {a.description ?? '—'}
                      </td>
                      <td className="px-3 py-3 text-[var(--text-secondary)]">
                        {a.execution_count ?? 0}
                      </td>
                      <td className="px-3 py-3">
                        {a.enabled ? (
                          <Badge variant="success">{t('common.enabled', 'Enabled')}</Badge>
                        ) : (
                          <Badge variant="neutral">{t('common.disabled', 'Disabled')}</Badge>
                        )}
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
