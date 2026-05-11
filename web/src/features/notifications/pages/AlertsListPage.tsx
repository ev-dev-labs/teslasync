/**
 * AlertsListPage — alert-entity list with stats, gauges, charts and
 * acknowledge/timeline actions. Was the "Alerts" tab of the legacy
 * AlertsPage; promoted to its own top-level route under the
 * Notifications group as part of the alerts/notifications consolidation.
 *
 * The History/Preferences tabs from the old page are gone — History was a
 * duplicate of /notifications/inbox, and Preferences was a localStorage-only
 * fallback for what /notifications/quiet-hours owns canonically.
 */

import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { TabNav } from '@/components/ui/TabNav';
import { PinButton } from '@/components/ui/PinButton';
import { PrintButton } from '@/components/ui/PrintButton';
import { useUrlEnum, useUrlNumber, useUrlString } from '@/hooks/useUrlState';

import { AnimatedNumber } from '@/components/data-display/AnimatedNumber';
import { SavedViewMenu } from '@/components/data-display/SavedViewMenu';
import { DataFreshnessAuto } from '@/components/data-display';
import { useSavedViewUrl } from '@/hooks/useSavedViewUrl';
import { fmtInt } from '@/lib/numberFormat';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { FadeIn } from '@/components/motion/FadeIn';
import { StaggerContainer } from '@/components/motion/StaggerContainer';
import { StaggerItem } from '@/components/motion/StaggerItem';
import { RadialGauge } from '@/components/charts/RadialGauge';
import { ChartTooltip } from '@/components/charts/ChartTooltip';
import { SearchInput, FilterBar, ActiveFilterChips, RangePicker, type FilterChipDescriptor } from '@/components/forms';
import { useFilteredList } from '@/hooks/useFilteredList';
import { useRangeState } from '@/hooks/useRangeState';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from '@/components/charts';
import { useToast } from '@/components/feedback/Toast';
import { usePageTitle } from '@/hooks/usePageTitle';
import { CHART_COLORS } from '@/lib/colors';
import {
  useAlerts, useMarkAlertRead, useAlertRules,
  useAcknowledgeAlert as useAcknowledgeAlertHook,
  useReopenAlert as useReopenAlertHook,
  useAlertDetail as useAlertDetailHook,
} from '@/api/hooks/useNotifications';
import { usePinned } from '@/api/hooks/usePinned';
import type { Alert } from '@/api/types';
import { Icons } from '@/lib/icons';
import { AcknowledgeAlertDialog } from '@/features/admin/components/AcknowledgeAlertDialog';
import { AlertDetailTimeline } from '@/features/admin/components/AlertDetailTimeline';
import { Modal } from '@/components/ui/Modal';
import { AlertCard } from '../components/AlertCard';

type AlertSeverity = 'info' | 'warning' | 'critical';

interface QuietHours { start: string; end: string; enabled: boolean }

function loadQuietHours(): QuietHours {
  try {
    const raw = localStorage.getItem('teslasync-quiet-hours');
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { start: '22:00', end: '07:00', enabled: false };
}

function isQuietHoursActive(qh: QuietHours): boolean {
  if (!qh.enabled) return false;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (qh.start <= qh.end) return hhmm >= qh.start && hhmm < qh.end;
  return hhmm >= qh.start || hhmm < qh.end;
}

export default function AlertsListPage() {
  const { t } = useTranslation();
  usePageTitle(t('Alerts'));
  const toast = useToast();
  const savedView = useSavedViewUrl();

  const [filter, setFilter] = useUrlEnum<'all' | 'unread' | 'critical'>(
    'filter',
    ['all', 'unread', 'critical'] as const,
    'all',
  );
  const [alertSearch, setAlertSearch] = useUrlString('q', '');
  const [alertPage, setAlertPage] = useUrlNumber('page', 1);
  const alertsPerPage = 20;

  const alertsQuery = useAlerts();
  const { data: rawAlerts, isLoading, error } = alertsQuery;

  const { start, end, setRange } = useRangeState({
    persistKey: 'alerts.range',
    defaultPresetId: 'all',
  });
  const alerts = useMemo(() => {
    if (!rawAlerts?.length) return rawAlerts;
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return rawAlerts.filter((a) => {
      if (!a.created_at) return false;
      const t = new Date(a.created_at).getTime();
      return t >= startMs && t <= endMs;
    });
  }, [rawAlerts, start, end]);
  const { data: rules } = useAlertRules();
  const markReadMut = useMarkAlertRead();
  const ackMut = useAcknowledgeAlertHook();
  const reopenMut = useReopenAlertHook();
  const [ackDialogId, setAckDialogId] = useState<number | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const detailQuery = useAlertDetailHook(detailId, { enabled: detailId !== null });
  const ackTarget = useMemo(() => alerts?.find((a) => a.id === ackDialogId) ?? null, [alerts, ackDialogId]);
  const { data: rulePins = [] } = usePinned('alert_rule');
  const pinnedRules = useMemo(() => {
    if (!rules || rulePins.length === 0) return [];
    const order = new Map<string, number>();
    rulePins.forEach(p => order.set(String(p.item_id), p.position));
    return rules
      .filter(r => order.has(String(r.id)))
      .sort((a, b) => (order.get(String(a.id)) ?? 0) - (order.get(String(b.id)) ?? 0));
  }, [rules, rulePins]);

  const tabFilteredAlerts = useMemo(() => alerts?.filter(a => {
    if (filter === 'unread') return !a.is_read;
    if (filter === 'critical') return a.severity === 'critical';
    return true;
  }) ?? [], [alerts, filter]);

  const alertSearchFields = useMemo(
    () => ['title', 'message'] as const satisfies ReadonlyArray<keyof Alert>,
    [],
  );
  const filteredAlerts = useFilteredList(tabFilteredAlerts, alertSearch, alertSearchFields);

  const totalPages = Math.max(1, Math.ceil(filteredAlerts.length / alertsPerPage));
  const safeAlertPage = Math.min(alertPage, totalPages);
  const pagedAlerts = filteredAlerts.slice((safeAlertPage - 1) * alertsPerPage, safeAlertPage * alertsPerPage);

  const totalCount = alerts?.length ?? 0;
  const unreadCount = useMemo(() => alerts?.filter(a => !a.is_read).length ?? 0, [alerts]);
  const criticalCount = useMemo(() => alerts?.filter(a => a.severity === 'critical' && !a.is_read).length ?? 0, [alerts]);
  const infoCount = useMemo(() => alerts?.filter(a => (a.severity ?? 'info') === 'info').length ?? 0, [alerts]);
  const warningCount = useMemo(() => alerts?.filter(a => a.severity === 'warning').length ?? 0, [alerts]);
  const readCount = useMemo(() => alerts?.filter(a => a.is_read === true).length ?? 0, [alerts]);
  const enabledRules = rules?.filter(r => r.enabled).length ?? 0;

  const alertsByType = useMemo(() => {
    if (!alerts?.length) return [];
    const counts: Record<string, number> = {};
    alerts.forEach(a => {
      const key = a.type ?? 'notification';
      counts[key] = (counts[key] ?? 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count], i) => ({
        name: (type ?? 'notification').replace(/_/g, ' '),
        value: count,
        fill: CHART_COLORS[i % CHART_COLORS.length],
      }));
  }, [alerts]);

  const alertsByDay = useMemo(() => {
    if (!alerts?.length) return [];
    const days: Record<string, { info: number; warning: number; critical: number }> = {};
    const now = Date.now();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      const key = d.toLocaleDateString(undefined, { weekday: 'short' });
      days[key] = { info: 0, warning: 0, critical: 0 };
    }
    alerts.forEach(a => {
      const d = new Date(a.created_at);
      if (now - d.getTime() > 7 * 86400000) return;
      const key = d.toLocaleDateString(undefined, { weekday: 'short' });
      const sev = a.severity as AlertSeverity;
      if (days[key] && (sev === 'info' || sev === 'warning' || sev === 'critical')) {
        days[key][sev]++;
      }
    });
    return Object.entries(days).map(([day, v]) => ({ day, ...v }));
  }, [alerts]);

  const weekAlertCount = useMemo(() =>
    alertsByDay.reduce((s, d) => s + d.info + d.warning + d.critical, 0),
  [alertsByDay]);

  const [quietHours] = useState<QuietHours>(loadQuietHours);
  const quietActive = isQuietHoursActive(quietHours);

  const handleMarkRead = useCallback((id: number) => {
    markReadMut.mutate(String(id), {
      onSuccess: () => toast.info(t('Alert marked as read')),
    });
  }, [markReadMut, toast, t]);

  const handleAcknowledgeSubmit = useCallback((note: string) => {
    if (ackDialogId === null) return;
    const id = ackDialogId;
    setAckDialogId(null);
    ackMut.mutate(
      { id, note },
      {
        onSuccess: () => {
          toast.toast({
            type: 'success',
            title: t('alerts.ack.success', 'Alert acknowledged'),
            duration: 5000,
            action: {
              label: t('alerts.ack.undo', 'Undo'),
              onClick: () => {
                reopenMut.mutate(id);
              },
            },
          });
        },
      },
    );
  }, [ackDialogId, ackMut, reopenMut, toast, t]);

  const handleReopen = useCallback((id: number) => {
    reopenMut.mutate(id);
  }, [reopenMut]);

  return (
    <PageContainer
      title={t('Alerts')}
      subtitle={t('alerts.subtitle', 'Live alert events from your fleet')}
      loading={isLoading}
      error={error as Error | null}
      copyLink
      actions={
        <div className="flex flex-wrap items-center justify-end gap-3">
          <RangePicker
            value={{ start, end }}
            onChange={(r) => {
              setRange(r);
              if (alertPage !== 1) setAlertPage(1);
            }}
            align="end"
            triggerTestId="alerts-range"
          />
          <DataFreshnessAuto query={alertsQuery} />
          {quietActive && <Badge variant="info" size="sm">{t('Quiet hours')}</Badge>}
          {unreadCount > 0 && <Badge variant="info" size="sm">{unreadCount} {t('unread')}</Badge>}
          {criticalCount > 0 && <Badge variant="danger" size="sm">{criticalCount} {t('critical')}</Badge>}
          <div data-print-hide className="flex items-center gap-2">
            {/* Saved-view route key is intentionally pinned to '/alerts' so
                pre-existing user-saved views from the legacy /alerts route
                continue to apply on this new page. */}
            <SavedViewMenu
              route="/alerts"
              currentQuery={savedView.currentQuery}
              onApply={savedView.apply}
            />
            <PrintButton />
          </div>
        </div>
      }
    >
      <FadeIn>
        <GlassPanel className="p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-8 text-center">
            <div>
              <span className="text-lg font-bold text-cyan-300"><AnimatedNumber value={totalCount} /></span>
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block">{t('Total')}</span>
            </div>
            <div className="h-8 w-px bg-white/[0.06] hidden sm:block" />
            <div>
              <span className="text-lg font-bold text-amber-300"><AnimatedNumber value={weekAlertCount} /></span>
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block">{t('This Week')}</span>
            </div>
            <div className="h-8 w-px bg-white/[0.06] hidden sm:block" />
            <div>
              <span className="text-lg font-bold text-purple-300"><AnimatedNumber value={unreadCount} /></span>
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block">{t('Unread')}</span>
            </div>
            <div className="h-8 w-px bg-white/[0.06] hidden sm:block" />
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 text-xs"><Icons.info className="h-3 w-3 text-cyan-300" /><span className="font-mono text-cyan-300">{infoCount}</span></span>
              <span className="flex items-center gap-1 text-xs"><Icons.severityWarn className="h-3 w-3 text-amber-300" /><span className="font-mono text-amber-300">{warningCount}</span></span>
              <span className="flex items-center gap-1 text-xs"><Icons.alertCircle className="h-3 w-3 text-rose-300" /><span className="font-mono text-rose-300">{criticalCount}</span></span>
            </div>
          </div>
        </GlassPanel>
      </FadeIn>

      <FadeIn>
        <GlassPanel className="p-4 sm:p-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 items-center">
            <RadialGauge value={totalCount} max={Math.max(totalCount, 20)} label={t('Total')} unit="" color="#00f0ff" />
            <RadialGauge value={unreadCount} max={Math.max(totalCount, 1)} label={t('Unread')} unit="" color="#f59e0b" />
            <RadialGauge value={criticalCount} max={Math.max(totalCount, 1)} label={t('Critical')} unit="" color="#ef4444" />
            <div className="flex flex-col items-center text-center">
              <div className="flex items-center gap-2">
                <Icons.info className="h-4 w-4 text-neon-cyan" />
                <span className="text-lg font-bold text-cyan-300"><AnimatedNumber value={infoCount} /></span>
              </div>
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-1">{t('Info')}</span>
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="flex items-center gap-2">
                <Icons.severityWarn className="h-4 w-4 text-neon-amber" />
                <span className="text-lg font-bold text-amber-300"><AnimatedNumber value={warningCount} /></span>
              </div>
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-1">{t('Warnings')}</span>
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="flex items-center gap-2">
                <Icons.success className="h-4 w-4 text-neon-green" />
                <span className="text-lg font-bold text-emerald-300"><AnimatedNumber value={readCount} /></span>
              </div>
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-1">{t('Resolved')}</span>
            </div>
          </div>
        </GlassPanel>
      </FadeIn>

      <FadeIn>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <a href="/notifications/studio">
            <GlassPanel className="p-3 text-center cursor-pointer hover:border-neon-cyan/30 transition-colors">
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1 block">{t('Active Rules')}</span>
              <span className="text-sm font-bold text-cyan-300">{enabledRules}/{rules?.length ?? 0}</span>
              <span className="text-[9px] text-cyan-300 mt-1 block">→ {t('Alert Studio')}</span>
            </GlassPanel>
          </a>
          <GlassPanel className="p-3 text-center">
            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1 block">{t('Read Rate')}</span>
            <span className="text-sm font-bold text-emerald-300">{totalCount > 0 ? `${fmtInt((readCount / totalCount) * 100)}%` : '—'}</span>
          </GlassPanel>
          <GlassPanel className="p-3 text-center">
            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1 block">{t('Most Common')}</span>
            <span className="text-sm font-bold text-purple-300">{alertsByType[0]?.name ?? '—'}</span>
          </GlassPanel>
          <GlassPanel className="p-3 text-center">
            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1 block">{t('Last 7 Days')}</span>
            <span className="text-sm font-bold text-amber-300">{weekAlertCount}</span>
          </GlassPanel>
        </div>
      </FadeIn>

      {totalCount > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <FadeIn>
            <GlassPanel className="p-4 sm:p-6">
              <span className="section-title mb-4 flex items-center gap-2">
                <Icons.notifications className="h-4 w-4 text-cyan-300" /> {t('Alert Trend (7 Days)')}
              </span>
              <div className="h-40 sm:h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={alertsByDay}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="day" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="critical" name={t('Critical')} stackId="a" fill="#ef4444" fillOpacity={0.7} radius={[0, 0, 0, 0]} />
                    <Bar dataKey="warning" name={t('Warning')} stackId="a" fill="#f59e0b" fillOpacity={0.6} />
                    <Bar dataKey="info" name={t('Info')} stackId="a" fill="#00f0ff" fillOpacity={0.5} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </GlassPanel>
          </FadeIn>

          <FadeIn>
            <GlassPanel className="p-4 sm:p-6">
              <span className="section-title mb-4 flex items-center gap-2">
                <Icons.filter className="h-4 w-4 text-purple-300" /> {t('Alerts by Type')}
              </span>
              <div className="h-40 sm:h-48 flex flex-col sm:flex-row items-center">
                <ResponsiveContainer width="60%" height="100%">
                  <PieChart>
                    <Pie data={alertsByType} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={2} dataKey="value">
                      {alertsByType.map((entry, i) => <Cell key={i} fill={entry.fill} stroke="transparent" />)}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-1.5">
                  {alertsByType.map((d, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: d.fill }} />
                      <span className="text-[var(--text-secondary)] truncate">{d.name}</span>
                      <span className="ml-auto text-[var(--text-primary)] font-mono">{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </GlassPanel>
          </FadeIn>
        </div>
      )}

      {pinnedRules.length > 0 && (
        <FadeIn>
          <GlassPanel className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-amber-300">
              <Icons.notifications className="h-4 w-4" />
              <span className="font-medium">{t('pinned.section.watching', 'Watching')}</span>
              <span className="text-[var(--text-muted)] normal-case tracking-normal">({pinnedRules.length})</span>
            </div>
            <ul className="divide-y divide-white/5">
              {pinnedRules.map(rule => (
                <li key={rule.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--text-primary)] truncate">{rule.name || `${t('alerts.rule', 'Rule')} #${rule.id}`}</span>
                      {rule.enabled ? (
                        <Badge variant="success" size="sm">{t('common.enabled', 'Enabled')}</Badge>
                      ) : (
                        <Badge variant="neutral" size="sm">{t('common.disabled', 'Disabled')}</Badge>
                      )}
                    </div>
                  </div>
                  <PinButton itemType="alert_rule" itemId={rule.id} size="sm" />
                </li>
              ))}
            </ul>
          </GlassPanel>
        </FadeIn>
      )}

      <FadeIn>
        <FilterBar>
          <SearchInput
            value={alertSearch}
            onChange={(v) => { setAlertSearch(v); setAlertPage(1); }}
            placeholder={t('alerts.searchPlaceholder', 'Search by title or message…')}
            className="w-full sm:w-72"
            historyScope="alerts"
          />
          <div className="flex items-center gap-2" data-tour="alerts-filters">
            <Icons.filter className="h-4 w-4 text-[var(--text-muted)]" />
            <TabNav
              tabs={[
                { key: 'all', label: `${t('All')} (${totalCount})` },
                { key: 'unread', label: `${t('Unread')} (${unreadCount})` },
                { key: 'critical', label: `${t('Critical')} (${criticalCount})` },
              ]}
              active={filter}
              onChange={k => { setFilter(k as 'all' | 'unread' | 'critical'); setAlertPage(1); }}
            />
          </div>
        </FilterBar>
        <ActiveFilterChips
          className="mt-3"
          filters={
            ([
              alertSearch
                ? {
                    key: 'q',
                    label: t('alerts.filterLabel.search', 'Search'),
                    value: alertSearch,
                    onRemove: () => { setAlertSearch(''); setAlertPage(1); },
                  } satisfies FilterChipDescriptor
                : null,
              filter !== 'all'
                ? {
                    key: 'filter',
                    label: t('alerts.filterLabel.status', 'Status'),
                    value:
                      filter === 'unread'
                        ? t('Unread')
                        : t('Critical'),
                    onRemove: () => { setFilter('all'); setAlertPage(1); },
                  } satisfies FilterChipDescriptor
                : null,
            ].filter(Boolean) as FilterChipDescriptor[]) as readonly FilterChipDescriptor[]
          }
          onClearAll={() => {
            setAlertSearch('');
            setFilter('all');
            setAlertPage(1);
          }}
        />
      </FadeIn>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : filteredAlerts.length > 0 ? (
        <div data-tour="alerts-list">
          <StaggerContainer className="space-y-2">
            {pagedAlerts.map(a => (
              <StaggerItem key={a.id}>
                <AlertCard
                  alert={a}
                  onMarkRead={() => handleMarkRead(a.id)}
                  onAcknowledge={() => setAckDialogId(a.id)}
                  onReopen={() => handleReopen(a.id)}
                  onOpenDetail={() => setDetailId(a.id)}
                  t={t}
                />
              </StaggerItem>
            ))}
          </StaggerContainer>

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <span className="text-xs text-[var(--text-muted)]">
                Showing {(safeAlertPage - 1) * alertsPerPage + 1}–{Math.min(safeAlertPage * alertsPerPage, filteredAlerts.length)} of {filteredAlerts.length}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" disabled={safeAlertPage <= 1} onClick={() => setAlertPage(1)}>«</Button>
                <Button variant="ghost" size="sm" disabled={safeAlertPage <= 1} onClick={() => setAlertPage(p => Math.max(1, p - 1))}>‹</Button>
                <span className="px-3 text-xs text-[var(--text-secondary)]">{safeAlertPage} / {totalPages}</span>
                <Button variant="ghost" size="sm" disabled={safeAlertPage >= totalPages} onClick={() => setAlertPage(p => Math.min(totalPages, p + 1))}>›</Button>
                <Button variant="ghost" size="sm" disabled={safeAlertPage >= totalPages} onClick={() => setAlertPage(totalPages)}>»</Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Icons.notificationsMuted className="h-8 w-8" />}
          title={t('No alerts')}
          message={
            alertSearch
              ? t('No alerts match your search.')
              : filter === 'all'
                ? t('Your fleet is running smoothly. Alerts will appear here.')
                : t(`No ${filter} alerts right now.`)
          }
        />
      )}

      <AcknowledgeAlertDialog
        open={ackDialogId !== null}
        onClose={() => setAckDialogId(null)}
        onSubmit={handleAcknowledgeSubmit}
        submitting={ackMut.isPending}
        alertTitle={ackTarget?.title}
      />
      <Modal
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        title={t('alerts.timeline.title', 'Audit timeline')}
        size="md"
      >
        <div className="space-y-4">
          {detailQuery.isLoading ? (
            <Skeleton className="h-32" />
          ) : detailQuery.data ? (
            <>
              <div className="space-y-1">
                <span className="block text-sm font-medium text-[var(--text-primary)]">
                  {detailQuery.data.title}
                </span>
                <span className="block text-xs text-[var(--text-muted)]">
                  {detailQuery.data.message}
                </span>
              </div>
              <AlertDetailTimeline events={detailQuery.data.events} />
            </>
          ) : (
            <EmptyState /* no-action: detail load failed; reopening the modal will retry */
              icon={<Icons.notifications className="h-6 w-6" />}
              title={t('alerts.timeline.empty', 'No events yet')}
              message={t('alerts.timeline.empty', 'No events yet')}
            />
          )}
        </div>
      </Modal>
    </PageContainer>
  );
}
