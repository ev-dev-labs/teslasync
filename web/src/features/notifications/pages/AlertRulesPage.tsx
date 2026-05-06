import { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { GlassPanel, Badge, EditableText } from '@/components/ui';
import { BulkActionToolbar, SeverityBadge } from '@/components/data-display';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { EmptyState, Skeleton, ErrorDisplay, EditConflictBanner } from '@/components/feedback';
import { VisuallyHidden } from '@/components/a11y';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { useEditLease } from '@/hooks/useEditLease';

import {
  useAlertRules,
  useBulkEnableRules,
  useBulkDisableRules,
  useDeleteAlertRule,
  useSaveAlertRule,
} from '@/api/hooks/useNotifications';
import type { AlertRule } from '@/api/types';
import { Icons } from '@/lib/icons';

/**
 * AlertRulesPage — focused list view of every alert rule with bulk
 * enable/disable/delete. Phase-45 / Prompt 32.
 *
 * The full CRUD studio lives at /alert-studio (`AlertStudioPage`); this
 * page is the streamlined "manage many at once" surface for power users
 * with dozens of rules. Rule names link to the studio for editing.
 */
export default function AlertRulesPage() {
  const { t } = useTranslation();
  usePageTitle(t('alertRules.title', 'Alert rules'));

  // Phase-46 / Prompt 66 — claim an edit lease so a second tab opening
  // the same bulk-rules surface sees a banner before its renames /
  // bulk-enables silently race this tab. The lease is scoped to the
  // list view itself (not per-rule) because the rename / bulk
  // affordances on this page operate across the whole rule set.
  const leaseKey = 'alert-rules/list';
  useEditLease(leaseKey);

  const { data: rulesRaw, isLoading, error } = useAlertRules();
  const rules: AlertRule[] = useMemo(() => rulesRaw ?? [], [rulesRaw]);
  const visibleIds = useMemo(() => rules.map((r) => r.id), [rules]);

  const sel = useBulkSelection<number>();
  const bulkEnable = useBulkEnableRules();
  const bulkDisable = useBulkDisableRules();
  const deleteOne = useDeleteAlertRule();
  const saveRule = useSaveAlertRule();

  const masterState = sel.masterState(visibleIds);

  const onMasterToggle = useCallback(() => {
    sel.toggleAll(visibleIds);
  }, [sel, visibleIds]);

  const onBulkDelete = useCallback(
    async (ids: Array<string | number>) => {
      // No bulk-delete-rules endpoint yet — fall back to per-id DELETE.
      // Confirmation already handled by the toolbar's `confirm` payload.
      const numericIds = ids.map((i) => Number(i));
      await Promise.allSettled(
        numericIds.map((id) => deleteOne.mutateAsync(id)),
      );
      sel.clear();
    },
    [deleteOne, sel],
  );

  return (
    <PageContainer
      title={t('alertRules.title', 'Alert rules')}
      subtitle={t(
        'alertRules.subtitle',
        'Bulk-manage alert rules. Click a rule to edit it in Alert Studio.',
      )}
    >
      <FadeIn>
        <EditConflictBanner
          resourceKey={leaseKey}
          resourceLabel={t('editConflict.resource.alertRules', 'Your alert rules')}
        />
        <BulkActionToolbar
          selectedIds={Array.from(sel.selectedIds)}
          total={visibleIds.length}
          onClear={sel.clear}
          itemNoun={{
            one: t('alertRules.noun.one', 'rule'),
            other: t('alertRules.noun.other', 'rules'),
          }}
          actions={[
            {
              id: 'enable',
              label: t('alertRules.bulk.enable', 'Enable'),
              icon: <Icons.play className="h-4 w-4" />,
              onClick: async (ids) => {
                await bulkEnable.mutateAsync(ids.map((i) => Number(i)));
                sel.clear();
              },
            },
            {
              id: 'disable',
              label: t('alertRules.bulk.disable', 'Disable'),
              icon: <Icons.pause className="h-4 w-4" />,
              onClick: async (ids) => {
                await bulkDisable.mutateAsync(ids.map((i) => Number(i)));
                sel.clear();
              },
            },
            {
              id: 'delete',
              label: t('alertRules.bulk.delete', 'Delete'),
              variant: 'danger',
              icon: <Icons.delete className="h-4 w-4" />,
              confirm: {
                title: t('alertRules.bulk.deleteConfirm.title', 'Delete alert rules?'),
                description: t(
                  'alertRules.bulk.deleteConfirm.body',
                  'These rules will stop firing immediately. This cannot be undone.',
                ),
                confirmLabel: t('common.delete', 'Delete'),
              },
              onClick: onBulkDelete,
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
          ) : rules.length === 0 ? (
            <EmptyState
              title={t('alertRules.empty.title', 'No alert rules yet')}
              message={t(
                'alertRules.empty.body',
                'Create your first alert rule in the Alert Studio.',
              )}
              actionTo={{
                label: t('alertRules.empty.cta', 'Open Alert Studio'),
                to: '/alert-studio',
              }}
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--border-subtle)] bg-[var(--surface-2)] text-left text-[var(--text-secondary)]">
                <tr>
                  <th className="w-12 px-3 py-3">
                    <VisuallyHidden as="label" htmlFor="alert-rules-master">
                      {t('bulk.selectAll', 'Select all')}
                    </VisuallyHidden>
                    <input
                      id="alert-rules-master"
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
                  <th className="px-3 py-3">{t('alertRules.col.name', 'Name')}</th>
                  <th className="px-3 py-3">{t('alertRules.col.signal', 'Signal')}</th>
                  <th className="px-3 py-3">{t('alertRules.col.severity', 'Severity')}</th>
                  <th className="px-3 py-3">{t('alertRules.col.status', 'Status')}</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => {
                  const checked = sel.isSelected(r.id);
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-[var(--border-subtle)] hover:bg-[var(--surface-2)]"
                      data-selected={checked || undefined}
                    >
                      <td className="px-3 py-3">
                        <VisuallyHidden as="label" htmlFor={`alert-rule-${r.id}`}>
                          {t('bulk.selectRow', 'Select row')}
                        </VisuallyHidden>
                        <input
                          id={`alert-rule-${r.id}`}
                          type="checkbox"
                          checked={checked}
                          onChange={() => sel.toggle(r.id)}
                          className="h-4 w-4 cursor-pointer rounded border-[var(--border-strong)] bg-transparent"
                          aria-label={t('alertRules.selectRule', 'Select rule {{name}}', { name: r.name })}
                        />
                      </td>
                      <td className="px-3 py-3 font-medium text-[var(--text-primary)]">
                        <EditableText
                          value={r.name}
                          ariaLabel={t('editableText.rename.alertRule', 'Rename alert rule {{name}}', { name: r.name })}
                          validate={(next) =>
                            next.length > 120
                              ? t('alertRules.error.nameTooLong', 'Max 120 characters')
                              : null
                          }
                          maxLength={120}
                          onSave={async (next) => {
                            await saveRule.mutateAsync({ id: r.id, name: next });
                          }}
                          display={({ value, onStartEdit }) => (
                            <span className="inline-flex items-center gap-2">
                              <Link
                                to={`/alert-studio?rule=${r.id}`}
                                className="text-cyan-300 underline-offset-2 hover:underline"
                              >
                                {value}
                              </Link>
                              <button
                                type="button"
                                onClick={onStartEdit}
                                aria-label={t('editableText.rename.alertRule', 'Rename alert rule {{name}}', { name: r.name })}
                                className="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                              >
                                <Icons.edit className="h-3.5 w-3.5" />
                              </button>
                            </span>
                          )}
                        />
                      </td>
                      <td className="px-3 py-3 text-[var(--text-secondary)]">
                        {r.signal_name}
                      </td>
                      <td className="px-3 py-3">
                        <SeverityBadge severity={r.severity} />
                      </td>
                      <td className="px-3 py-3">
                        {r.enabled ? (
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

        <div className="mt-4 flex justify-end">
          <Link
            to="/alert-studio"
            className="inline-flex items-center gap-2 rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
          >
            <Icons.add className="h-4 w-4" />
            {t('alertRules.openStudio', 'Open Alert Studio')}
          </Link>
        </div>
      </FadeIn>
    </PageContainer>
  );
}
