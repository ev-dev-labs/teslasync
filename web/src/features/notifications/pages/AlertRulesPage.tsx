import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import { PageContainer } from '@/components/layout';
import {
  GlassPanel,
  Badge,
  Button,
  DataTable,
  PanelTitle,
  Text,
  EditableText,
  ConfirmDialog,
  useSortToggle,
  type Column,
} from '@/components/ui';
import { MetricCard, MetricBar, SeverityBadge } from '@/components/data-display';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  ChartTooltip,
} from '@/components/charts';
import {
  EmptyState,
  Skeleton,
  QueryError,
  EditConflictBanner,
} from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useEditLease } from '@/hooks/useEditLease';
import { useConfirm } from '@/hooks/useConfirm';

import {
  useAlertRules,
  useBulkEnableRules,
  useBulkDisableRules,
  useDeleteAlertRule,
  useSaveAlertRule,
} from '@/api/hooks/useNotifications';
import type { AlertRule } from '@/api/types';
import { Icons } from '@/lib/icons';
import { normalizeSeverity, chartTokens } from '@/lib/tokens';
import { fmtInt } from '@/lib/numberFormat';

/* ─── Constants ──────────────────────────────────────────── */

/** Semantic severity colours for the distribution donut + legend. Mirrors the
 *  `severityTokens` dot hues so the chart reads consistently with the badges. */
const SEVERITY_COLORS: Record<'info' | 'warn' | 'critical', string> = {
  info: '#38bdf8',
  warn: '#f59e0b',
  critical: '#ef4444',
};

/** Colours for the status-breakdown bars (enabled / disabled / snoozed). */
const STATUS_COLORS = {
  enabled: '#10b981',
  disabled: '#f59e0b',
  snoozed: '#8b5cf6',
} as const;

/** Rank used by the sortable severity column (critical sorts last → first when desc). */
const SEVERITY_RANK: Record<string, number> = {
  info: 0,
  success: 0,
  warn: 1,
  critical: 2,
};

/** Human label for a rule's monitored subject — the signal name for signal
 *  rules, the metric id for computed-metric rules. */
export function subjectOf(r: AlertRule): string {
  if (r.kind === 'computed_metric') return r.metric_id ?? '—';
  return r.signal_name ?? '—';
}

/** Whether a rule is currently snoozed (snoozed_until in the future). */
export function isSnoozed(r: AlertRule, now: number): boolean {
  if (!r.snoozed_until) return false;
  const ts = new Date(r.snoozed_until).getTime();
  return Number.isFinite(ts) && ts > now;
}

/* ─── Component ──────────────────────────────────────────── */

/**
 * AlertRulesPage — full-width command surface for bulk-managing every alert
 * rule: a KPI overview, a severity / status / signal insight bento, and a
 * sortable, multi-select rules table with inline rename plus bulk
 * enable / disable / delete.
 *
 * The full CRUD studio lives at /notifications/studio (`AlertStudioPage`); rule
 * names deep-link there for editing.
 */
export default function AlertRulesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  usePageTitle(t('alertRules.title', 'Alert rules'));

  // Claim an edit lease so a second tab opening the same bulk-rules surface
  // sees a banner before its renames / bulk-enables silently race this tab.
  // The lease is scoped to the list view itself (not per-rule) because the
  // rename / bulk affordances operate across the whole rule set.
  const leaseKey = 'alert-rules/list';
  useEditLease(leaseKey);

  const rulesQuery = useAlertRules();
  const { data: rulesRaw, isLoading, isError, error, refetch } = rulesQuery;
  const rules: AlertRule[] = useMemo(() => rulesRaw ?? [], [rulesRaw]);

  const bulkEnable = useBulkEnableRules();
  const bulkDisable = useBulkDisableRules();
  const deleteOne = useDeleteAlertRule();
  const saveRule = useSaveAlertRule();
  const { confirm, dialogProps } = useConfirm();

  // DataTable-native multi-select — keys are rule ids.
  const [selectedKeys, setSelectedKeys] = useState<Array<string | number>>([]);

  /* ─── Derived stats ─── */
  const stats = useMemo(() => {
    const now = Date.now();
    let enabled = 0;
    let critical = 0;
    let warn = 0;
    let info = 0;
    let snoozed = 0;
    let computed = 0;
    const bySignal = new Map<string, number>();
    for (const r of rules) {
      if (r.enabled) enabled += 1;
      const sev = normalizeSeverity(r.severity);
      if (sev === 'critical') critical += 1;
      else if (sev === 'warn') warn += 1;
      else info += 1;
      if (isSnoozed(r, now)) snoozed += 1;
      if (r.kind === 'computed_metric') computed += 1;
      const key = subjectOf(r);
      bySignal.set(key, (bySignal.get(key) ?? 0) + 1);
    }
    return {
      total: rules.length,
      enabled,
      disabled: rules.length - enabled,
      critical,
      warn,
      info,
      snoozed,
      computed,
      bySignal,
    };
  }, [rules]);

  const severitySegments = useMemo(
    () =>
      (
        [
          { key: 'critical', label: t('severity.critical', 'Critical'), value: stats.critical },
          { key: 'warn', label: t('severity.warn', 'Warning'), value: stats.warn },
          { key: 'info', label: t('severity.info', 'Info'), value: stats.info },
        ] as const
      )
        .filter((s) => s.value > 0)
        .map((s) => ({ ...s, color: SEVERITY_COLORS[s.key] })),
    [stats.critical, stats.warn, stats.info, t],
  );

  const statusRows = useMemo(
    () => [
      { key: 'enabled', label: t('common.enabled', 'Enabled'), value: stats.enabled, color: STATUS_COLORS.enabled },
      { key: 'disabled', label: t('common.disabled', 'Disabled'), value: stats.disabled, color: STATUS_COLORS.disabled },
      { key: 'snoozed', label: t('alertRules.status.snoozed', 'Snoozed'), value: stats.snoozed, color: STATUS_COLORS.snoozed },
    ],
    [stats.enabled, stats.disabled, stats.snoozed, t],
  );

  const topSignals = useMemo(
    () =>
      Array.from(stats.bySignal.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([name, count], i) => ({
          name,
          count,
          color: chartTokens.series[i % chartTokens.series.length],
        })),
    [stats.bySignal],
  );
  const maxSignalCount = topSignals.length > 0 ? topSignals[0].count : 0;

  /* ─── Sorting (client-side, DataTable-controlled) ─── */
  const { sortKey, sortDir, onSort, sortFn } = useSortToggle('name', 'asc');
  const sortedRules = useMemo(
    () =>
      sortFn(rules, (r, key) => {
        switch (key) {
          case 'name':
            return (r.name ?? '').toLowerCase();
          case 'signal_name':
            return subjectOf(r).toLowerCase();
          case 'severity':
            return SEVERITY_RANK[normalizeSeverity(r.severity)] ?? 0;
          case 'status':
            return r.enabled ? 1 : 0;
          default:
            return '';
        }
      }),
    [rules, sortFn],
  );

  /* ─── Bulk actions ─── */
  const handleBulkDelete = useCallback(
    async (ids: number[]) => {
      const ok = await confirm({
        title: t('alertRules.bulk.deleteConfirm.title', 'Delete alert rules?'),
        message: t(
          'alertRules.bulk.deleteConfirm.body',
          'These rules will stop firing immediately. This cannot be undone.',
        ),
        confirmLabel: t('common.delete', 'Delete'),
        variant: 'danger',
      });
      if (!ok) return;
      // No bulk-delete-rules endpoint yet — fall back to per-id DELETE.
      await Promise.allSettled(ids.map((id) => deleteOne.mutateAsync(id)));
      setSelectedKeys([]);
    },
    [confirm, deleteOne, t],
  );

  // Bulk enable/disable share a shape: fire the mutation, clear the selection
  // on success, and — critically — swallow a rejected `mutateAsync` so a failed
  // batch never surfaces as an unhandled promise rejection (the async onClick
  // used to `await` directly). The failure toast is already raised by the
  // mutation's own `onError`; we deliberately KEEP the selection on failure so
  // the user can retry the batch.
  const handleBulkEnable = useCallback(
    async (ids: number[]) => {
      try {
        await bulkEnable.mutateAsync(ids);
        setSelectedKeys([]);
      } catch {
        /* keep selection; toast surfaced by the hook's onError */
      }
    },
    [bulkEnable],
  );

  const handleBulkDisable = useCallback(
    async (ids: number[]) => {
      try {
        await bulkDisable.mutateAsync(ids);
        setSelectedKeys([]);
      } catch {
        /* keep selection; toast surfaced by the hook's onError */
      }
    },
    [bulkDisable],
  );

  const renderBulkActions = useCallback(
    (selected: AlertRule[]) => {
      const ids = selected.map((r) => r.id);
      return (
        <>
          <Button
            variant="secondary"
            size="sm"
            icon={<Icons.play className="h-4 w-4" aria-hidden="true" />}
            loading={bulkEnable.isPending}
            onClick={() => handleBulkEnable(ids)}
          >
            {t('alertRules.bulk.enable', 'Enable')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<Icons.pause className="h-4 w-4" aria-hidden="true" />}
            loading={bulkDisable.isPending}
            onClick={() => handleBulkDisable(ids)}
          >
            {t('alertRules.bulk.disable', 'Disable')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            icon={<Icons.delete className="h-4 w-4" aria-hidden="true" />}
            onClick={() => handleBulkDelete(ids)}
          >
            {t('alertRules.bulk.delete', 'Delete')}
          </Button>
        </>
      );
    },
    [bulkEnable, bulkDisable, handleBulkEnable, handleBulkDisable, handleBulkDelete, t],
  );

  /* ─── Table columns ─── */
  const columns = useMemo<Column<AlertRule>[]>(
    () => [
      {
        key: 'name',
        header: t('alertRules.col.name', 'Name'),
        sortable: true,
        render: (r) => (
          <EditableText
            value={r.name}
            ariaLabel={t('editableText.rename.alertRule', 'Rename alert rule {{name}}', { name: r.name })}
            validate={(next) =>
              next.length > 120 ? t('alertRules.error.nameTooLong', 'Max 120 characters') : null
            }
            maxLength={120}
            onSave={async (next) => {
              await saveRule.mutateAsync({ id: r.id, name: next });
            }}
            display={({ value, onStartEdit }) => (
              <span className="inline-flex items-center gap-2">
                <Link
                  to={`/notifications/studio?rule=${r.id}`}
                  className="font-medium text-cyan-300 underline-offset-2 hover:underline"
                >
                  {value}
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onStartEdit}
                  aria-label={t('editableText.rename.alertRule', 'Rename alert rule {{name}}', { name: r.name })}
                  icon={<Icons.edit className="h-3.5 w-3.5" aria-hidden="true" />}
                />
              </span>
            )}
          />
        ),
      },
      {
        key: 'kind',
        header: t('alertRules.col.type', 'Type'),
        render: (r) => (
          <Badge variant="neutral" size="sm">
            {r.kind === 'computed_metric'
              ? t('alertRules.kind.metric', 'Metric')
              : t('alertRules.kind.signal', 'Signal')}
          </Badge>
        ),
      },
      {
        key: 'signal_name',
        header: t('alertRules.col.signal', 'Signal'),
        sortable: true,
        render: (r) => (
          <Text as="span" color="secondary">
            {subjectOf(r)}
          </Text>
        ),
      },
      {
        key: 'severity',
        header: t('alertRules.col.severity', 'Severity'),
        sortable: true,
        render: (r) => <SeverityBadge severity={r.severity} size="sm" />,
      },
      {
        key: 'scope',
        header: t('alertRules.col.scope', 'Scope'),
        render: (r) => {
          const count = r.vehicle_ids?.length ?? 0;
          const label = r.all_vehicles
            ? t('alertRules.scope.all', 'All vehicles')
            : count > 0
              ? t('alertRules.scope.count', '{{count}} vehicles', { count })
              : t('alertRules.scope.none', '—');
          return (
            <Text as="span" color="secondary">
              {label}
            </Text>
          );
        },
      },
      {
        key: 'status',
        header: t('alertRules.col.status', 'Status'),
        sortable: true,
        render: (r) => (
          <span className="inline-flex items-center gap-1.5">
            {r.enabled ? (
              <Badge variant="success" size="sm">
                {t('common.enabled', 'Enabled')}
              </Badge>
            ) : (
              <Badge variant="neutral" size="sm">
                {t('common.disabled', 'Disabled')}
              </Badge>
            )}
            {isSnoozed(r, Date.now()) && (
              <Badge variant="warning" size="sm">
                {t('alertRules.status.snoozed', 'Snoozed')}
              </Badge>
            )}
          </span>
        ),
      },
    ],
    [t, saveRule],
  );

  /* ─── Header actions ─── */
  const actions = (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => refetch()}
        aria-label={t('common.refresh', 'Refresh')}
        icon={<Icons.refresh className="h-4 w-4" aria-hidden="true" />}
      />
      <Button
        variant="secondary"
        size="sm"
        onClick={() => navigate('/notifications/studio')}
        icon={<Icons.add className="h-4 w-4" aria-hidden="true" />}
      >
        {t('alertRules.openStudio', 'Open Alert Studio')}
      </Button>
    </div>
  );

  return (
    <PageContainer
      title={t('alertRules.title', 'Alert rules')}
      subtitle={t(
        'alertRules.subtitle',
        'Bulk-manage alert rules. Click a rule to edit it in Alert Studio.',
      )}
      actions={actions}
      query={rulesQuery}
    >
      <EditConflictBanner
        resourceKey={leaseKey}
        resourceLabel={t('editConflict.resource.alertRules', 'Your alert rules')}
      />

      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('alertRules.kpis', 'Alert rule metrics')}
          className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6"
        >
          <MetricCard
            label={t('alertRules.kpi.total', 'Total rules')}
            value={fmtInt(stats.total)}
            icon={<Icons.notifications className="h-5 w-5" />}
            color="cyan"
          />
          <MetricCard
            label={t('common.enabled', 'Enabled')}
            value={fmtInt(stats.enabled)}
            icon={<Icons.power className="h-5 w-5" />}
            color="green"
          />
          <MetricCard
            label={t('common.disabled', 'Disabled')}
            value={fmtInt(stats.disabled)}
            icon={<Icons.pause className="h-5 w-5" />}
            color="amber"
          />
          <MetricCard
            label={t('severity.critical', 'Critical')}
            value={fmtInt(stats.critical)}
            icon={<Icons.alertCircle className="h-5 w-5" />}
            color="red"
          />
          <MetricCard
            label={t('alertRules.status.snoozed', 'Snoozed')}
            value={fmtInt(stats.snoozed)}
            icon={<Icons.moon className="h-5 w-5" />}
            color="purple"
          />
          <MetricCard
            label={t('alertRules.kpi.computed', 'Computed')}
            value={fmtInt(stats.computed)}
            icon={<Icons.activity className="h-5 w-5" />}
            color="blue"
          />
        </section>
      </FadeIn>

      {/* 2 — Insights bento */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {/* Severity distribution donut */}
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Icons.alertCircle className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('alertRules.insights.severity', 'Severity distribution')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={220} />
            ) : isError ? (
              <QueryError error={error} onRetry={() => refetch()} />
            ) : severitySegments.length === 0 ? (
              <EmptyState
                icon={<Icons.alertCircle className="h-8 w-8" />}
                message={t('alertRules.insights.noSeverity', 'No rules to summarise yet')}
              />
            ) : (
              <>
                <div className="h-56 sm:h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={severitySegments}
                        dataKey="value"
                        nameKey="label"
                        cx="50%"
                        cy="50%"
                        innerRadius="55%"
                        outerRadius="80%"
                        paddingAngle={2}
                        strokeWidth={0}
                      >
                        {severitySegments.map((seg) => (
                          <Cell key={seg.key} fill={seg.color} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} wrapperStyle={{ outline: 'none' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1">
                  {severitySegments.map((seg) => (
                    <div key={seg.key} className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: seg.color }}
                      />
                      <Text variant="bodySm">
                        {seg.label} · {fmtInt(seg.value)}
                      </Text>
                    </div>
                  ))}
                </div>
              </>
            )}
          </GlassPanel>

          {/* Status breakdown */}
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Icons.power className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('alertRules.insights.status', 'Status breakdown')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={220} />
            ) : isError ? (
              <QueryError error={error} onRetry={() => refetch()} />
            ) : stats.total === 0 ? (
              <EmptyState
                icon={<Icons.power className="h-8 w-8" />}
                message={t('alertRules.insights.noStatus', 'No rules to summarise yet')}
              />
            ) : (
              <div className="space-y-4">
                {statusRows.map((row) => (
                  <MetricBar
                    key={row.key}
                    label={row.label}
                    value={row.value}
                    max={stats.total}
                    color={row.color}
                    sublabel={fmtInt(row.value)}
                  />
                ))}
              </div>
            )}
          </GlassPanel>

          {/* Top signals */}
          <GlassPanel className="p-4 sm:p-5 md:col-span-2 xl:col-span-1">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Icons.filter className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('alertRules.insights.topSignals', 'Top monitored signals')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={220} />
            ) : isError ? (
              <QueryError error={error} onRetry={() => refetch()} />
            ) : topSignals.length === 0 ? (
              <EmptyState
                icon={<Icons.filter className="h-8 w-8" />}
                message={t('alertRules.insights.noSignals', 'No monitored signals yet')}
              />
            ) : (
              <div className="space-y-4">
                {topSignals.map((sig) => (
                  <MetricBar
                    key={sig.name}
                    label={sig.name}
                    value={sig.count}
                    max={maxSignalCount}
                    color={sig.color}
                    sublabel={fmtInt(sig.count)}
                  />
                ))}
              </div>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 3 — Rules table (full-width detail band) */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Icons.notifications className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('alertRules.table.title', 'All rules')}
          </PanelTitle>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : isError ? (
            <QueryError error={error} onRetry={() => refetch()} />
          ) : rules.length === 0 ? (
            <EmptyState
              title={t('alertRules.empty.title', 'No alert rules yet')}
              message={t(
                'alertRules.empty.body',
                'Create your first alert rule in the Alert Studio.',
              )}
              actionTo={{
                label: t('alertRules.empty.cta', 'Open Alert Studio'),
                to: '/notifications/studio',
              }}
            />
          ) : (
            <DataTable
              tableId="notifications:alert-rules"
              columns={columns}
              data={sortedRules}
              keyExtractor={(r) => r.id}
              selectable="multi"
              selectedKeys={selectedKeys}
              onSelectionChange={setSelectedKeys}
              bulkActions={renderBulkActions}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              pagination
              emptyMessage={t('alertRules.table.empty', 'No alert rules match')}
            />
          )}
        </GlassPanel>
      </FadeIn>

      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </PageContainer>
  );
}
