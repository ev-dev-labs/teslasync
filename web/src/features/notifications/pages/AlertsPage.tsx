/**
 * AlertsPage — alert history, analytics, notification log, and preferences.
 *
 * Three tabs: Alerts (list + charts), History (notification log), Preferences (quiet hours, digest).
 */

import { useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { cn } from '@/lib/cn';
import { severityTokens, normalizeSeverity } from '@/lib/tokens';
import { getAlertDrillthroughHref } from '@/lib/alertDrillthrough';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TabNav } from '@/components/ui/TabNav';
import { Toggle } from '@/components/ui/Toggle';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { PinButton } from '@/components/ui/PinButton';
import { PrintButton } from '@/components/ui/PrintButton';
import { useUrlEnum, useUrlNumber, useUrlString } from '@/hooks/useUrlState';

import { MetricCard } from '@/components/data-display/MetricCard';
import { AnimatedNumber } from '@/components/data-display/AnimatedNumber';
import { SeverityBadge } from '@/components/data-display/SeverityBadge';
import { StatusDot } from '@/components/data-display/StatusDot';
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
import { SearchInput, FilterBar, ActiveFilterChips, type FilterChipDescriptor } from '@/components/forms';
import { useFilteredList } from '@/hooks/useFilteredList';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from '@/components/charts';
import { useToast } from '@/components/feedback/Toast';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime } from '@/lib/dateFormat';
import { CHART_COLORS } from '@/lib/colors';
import {
  useAlerts, useMarkAlertRead, useAlertRules,
  useNotificationChannels, useNotificationLogs, useNotificationStats,
} from '@/api/hooks/useNotifications';
import { usePinned } from '@/api/hooks/usePinned';
import type { Alert, NotificationLog } from '@/api/types';
import { Icons } from '@/lib/icons';

// ─── Severity helpers ────────────────────────────────────────────────────────
//
// Severity styling lives in @/lib/tokens (severityTokens) and is rendered via
// the shared <SeverityBadge> / <StatusDot> components from @/components/data-display.
// `Alert.severity` is the wire-level type: 'info' | 'warning' | 'critical'. Use
// `normalizeSeverity` to map onto the canonical 'info' | 'warn' | 'critical'
// keys before reading from severityTokens.

type AlertSeverity = 'info' | 'warning' | 'critical';

// ─── Alert type → icon mapping ───────────────────────────────────────────────

const typeIcons: Record<string, React.ElementType> = {
  geofence_exit: Icons.location, geofence_enter: Icons.location,
  low_battery: Icons.battery, battery_low: Icons.battery, battery_high: Icons.battery,
  charging_complete: Icons.charging, charging_cost: Icons.charging,
  sentry_event: Icons.security, speed_limit: Icons.speed, temperature: Icons.climate,
  software_update: Icons.settingsAlt, vampire_drain: Icons.trendDown,
  tire_pressure_low: Icons.droplets, idle_unlocked: Icons.locked, efficiency_drop: Icons.analytics,
  system_database: Icons.database, system_mqtt: Icons.wifi, system_redis: Icons.hardDrive,
  system_tesla_api: Icons.radio, system_worker: Icons.efficiency,
};

// ─── Time helpers ────────────────────────────────────────────────────────────

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ─── Quiet hours helpers ─────────────────────────────────────────────────────

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

// ─── Digest mode ─────────────────────────────────────────────────────────────

type DigestMode = 'instant' | 'hourly' | 'daily';

function loadDigestMode(): DigestMode {
  const v = localStorage.getItem('teslasync-alert-digest');
  if (v === 'hourly' || v === 'daily') return v;
  return 'instant';
}

// ─── AlertCard sub-component ─────────────────────────────────────────────────

function AlertCard({ alert, onMarkRead, t }: { alert: Alert; onMarkRead: () => void; t: TFunction }) {
  const sev = normalizeSeverity(alert.severity);
  const tokens = severityTokens[sev];
  const Icon = typeIcons[alert.type] || Icons.notifications;
  const timeAgo = getTimeAgo(alert.created_at);
  const drillHref = getAlertDrillthroughHref(alert);

  return (
    <GlassPanel
      className={cn(
        'p-4 flex items-start gap-4 transition-all duration-normal group',
        !alert.is_read && cn(tokens.border, tokens.bg.replace('/10', '/5')),
      )}
    >
      <div className="flex flex-col items-center gap-1 shrink-0">
        <div className={cn('rounded-xl p-2.5 ring-1', tokens.bg, tokens.border)}>
          <Icon className={cn('h-4 w-4', tokens.fg)} />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <Link
            to={drillHref}
            className="block min-w-0 flex-1 -m-1 p-1 rounded-md hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400/60"
            aria-label={t('alerts.viewContext', 'View context')}
          >
            <span className={cn('text-sm font-medium block', alert.is_read ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]')}>
              {alert.title}
            </span>
            <span className="text-xs text-[var(--text-muted)] mt-0.5 line-clamp-2 block">{alert.message}</span>
          </Link>
          {!alert.is_read && (
            <StatusDot
              severity={alert.severity}
              className="mt-1.5 shrink-0 animate-pulse"
              label={t('Unread')}
            />
          )}
        </div>
        <div className="flex items-center gap-3 mt-2">
          <span className="text-[10px] text-[var(--text-muted)] flex items-center gap-1">
            <Icons.clock className="h-2.5 w-2.5" />{timeAgo}
          </span>
          <SeverityBadge severity={alert.severity} size="sm" showIcon={false}>
            {alert.severity}
          </SeverityBadge>
          <span className="text-[10px] text-[var(--text-muted)]">{(alert.type ?? 'notification').replace(/_/g, ' ')}</span>
          <Link
            to={drillHref}
            className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-cyan-300 hover:text-cyan-200 underline-offset-2 hover:underline opacity-0 group-hover:opacity-100 transition-opacity"
          >
            {t('alerts.viewContext', 'View context')}
            <Icons.next className="h-3 w-3" />
          </Link>
          {!alert.is_read && (
            <Button variant="ghost" size="sm" icon={<Icons.show className="h-3 w-3" />} onClick={onMarkRead}>
              {t('Mark read')}
            </Button>
          )}
        </div>
      </div>
    </GlassPanel>
  );
}

// ─── NotificationHistory sub-component ───────────────────────────────────────

function NotificationHistory({ t }: { t: TFunction }) {

  const { data: logs, isLoading: logsLoading } = useNotificationLogs();
  const { data: stats } = useNotificationStats();
  const { data: channels } = useNotificationChannels();
  const [logSearch, setLogSearch] = useState('');

  const channelMap = useMemo(() => {
    const m: Record<number, string> = {};
    channels?.forEach(c => { m[c.id] = `${c.name} (${c.kind})`; });
    return m;
  }, [channels]);

  const totalSent = stats?.sent ?? 0;
  const totalFailed = stats?.failed ?? 0;
  const total = stats?.total_sent ?? (totalSent + totalFailed + (stats?.pending ?? 0));
  const successRate = total > 0 ? (totalSent / total) * 100 : 0;

  const logTypeCounts = useMemo(() => {
    if (!logs?.length) return [];
    const counts: Record<string, number> = {};
    logs.forEach(l => { counts[l.status] = (counts[l.status] || 0) + 1; });
    const colors: Record<string, string> = { sent: '#10b981', failed: '#ef4444', pending: '#f59e0b' };
    return Object.entries(counts).map(([status, value]) => ({
      name: status, value, fill: colors[status] || '#00f0ff',
    }));
  }, [logs]);

  const logSearchFields = useMemo(
    () => [
      'title' as keyof NotificationLog,
      (log: NotificationLog) => channelMap[log.channel_id] ?? '',
    ],
    [channelMap],
  );
  const filteredLogs = useFilteredList(logs, logSearch, logSearchFields);

  const logColumns: Column<NotificationLog>[] = useMemo(() => [
    { key: 'time', header: t('Time'), render: (log) => <span className="text-[var(--text-muted)] whitespace-nowrap">{formatDateTime(log.created_at)}</span>, visibleOnMobile: true },
    { key: 'title', header: t('Title'), render: (log) => <span className="text-[var(--text-primary)] max-w-[200px] truncate block">{log.title}</span>, visibleOnMobile: true },
    { key: 'channel', header: t('Channel'), render: (log) => <span className="text-[var(--text-secondary)]">{channelMap[log.channel_id] || `#${log.channel_id}`}</span> },
    { key: 'status', header: t('Status'), render: (log) => {
      // Phase-46 / Prompt 19 — surface DND-deferred rows distinctly so
      // the user can tell their notification is held (not lost).
      if (log.status === 'deferred_dnd') {
        return (
          <Badge variant="warning" size="sm" title={t('quietHours.deferredTooltip', 'Held until the active quiet-hours window ends.')}>
            {t('quietHours.deferred', 'DND deferred')}
          </Badge>
        );
      }
      const variant = log.status === 'sent' ? 'success' : log.status === 'failed' ? 'danger' : 'warning';
      return <Badge variant={variant} size="sm">{log.status}</Badge>;
    }, visibleOnMobile: true },
  ], [channelMap, t]);

  return (
    <div className="space-y-6">
      {/* Analytics cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label={t('Total Sent')} value={totalSent} icon={<Icons.send className="h-4 w-4" />} color="cyan" />
        <MetricCard label={t('Failed')} value={totalFailed} icon={<Icons.alertCircle className="h-4 w-4" />} color="red" />
        <MetricCard label={t('Success Rate')} value={`${fmtInt(successRate)}%`} icon={<Icons.success className="h-4 w-4" />} color="green" />
        <MetricCard label={t('Channels')} value={`${stats?.enabled_channels ?? 0} / ${stats?.total_channels ?? 0}`} icon={<Icons.notifications className="h-4 w-4" />} color="purple" />
      </div>

      {/* Delivery status pie */}
      <GlassPanel className="p-4 sm:p-6">
        <span className="section-title mb-4 flex items-center gap-2">
          <Icons.pieChart className="h-4 w-4 text-purple-300" /> {t('Delivery Status')}
        </span>
        {logTypeCounts.length > 0 ? (
          <div className="h-40 flex flex-col sm:flex-row items-center">
            <ResponsiveContainer width="50%" height="100%">
              <PieChart>
                <Pie data={logTypeCounts} cx="50%" cy="50%" innerRadius={35} outerRadius={60} paddingAngle={3} dataKey="value">
                  {logTypeCounts.map((entry, i) => <Cell key={i} fill={entry.fill} stroke="transparent" />)}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-2">
              {logTypeCounts.map(d => (
                <div key={d.name} className="flex items-center gap-2 text-xs">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: d.fill }} />
                  <span className="text-[var(--text-secondary)] capitalize">{d.name}</span>
                  <span className="ml-auto text-[var(--text-primary)] font-mono">{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Icons.efficiency className="h-8 w-8 opacity-20" />}
            message={t('common.noData')}
            className="py-8"
          />
        )}
      </GlassPanel>

      {/* Log table */}
      <GlassPanel className="p-4 sm:p-6">
        <span className="section-title mb-4 flex items-center gap-2">
          <Icons.send className="h-4 w-4 text-cyan-300" /> {t('Notification Log')}
        </span>
        <FilterBar className="mb-3">
          <SearchInput
            value={logSearch}
            onChange={setLogSearch}
            placeholder={t('Search by title or channel…')}
            className="w-full sm:w-72"
            historyScope="alerts:logs"
          />
        </FilterBar>
        <ActiveFilterChips
          className="mb-3"
          filters={
            (logSearch
              ? [
                  {
                    key: 'q',
                    label: t('notifications.log.filterLabel.search', 'Search'),
                    value: logSearch,
                    onRemove: () => setLogSearch(''),
                  } satisfies FilterChipDescriptor,
                ]
              : []) as readonly FilterChipDescriptor[]
          }
          onClearAll={() => setLogSearch('')}
        />
        {logsLoading ? (
          <div className="space-y-2">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10" />)}</div>
        ) : filteredLogs.length > 0 ? (
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <DataTable
                columns={logColumns}
                data={filteredLogs}
                keyExtractor={(log) => log.id}
                compact
                virtualized
                rowHeight={36}
                pagination={{ defaultPageSize: 500 }}
                tableId="alerts-logs"
                showColumnsMenu
                stickyHeader
                maxHeight={520}
              />
            </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Icons.send className="h-8 w-8" />}
            title={t('No notification logs')}
            message={
              logSearch
                ? t('No logs match your search.')
                : t('Notification logs will appear here once alerts are sent.')
            }
          />
        )}
      </GlassPanel>
    </div>
  );
}

// ─── PreferencesSection sub-component ────────────────────────────────────────

function PreferencesSection({ t }: { t: (k: string) => string }) {
  const [quietHours, setQuietHours] = useState<QuietHours>(loadQuietHours);
  const [digestMode, setDigestMode] = useState<DigestMode>(loadDigestMode);
  const toast = useToast();

  const saveQuietHours = useCallback((qh: QuietHours) => {
    setQuietHours(qh);
    localStorage.setItem('teslasync-quiet-hours', JSON.stringify(qh));
  }, []);

  const saveDigest = useCallback((mode: DigestMode) => {
    setDigestMode(mode);
    localStorage.setItem('teslasync-alert-digest', mode);
  }, []);

  const quietActive = isQuietHoursActive(quietHours);

  const digestOptions = [
    { value: 'instant' as const, label: t('Instant'), desc: t('Every alert notifies immediately') },
    { value: 'hourly' as const, label: t('Hourly Digest'), desc: t('Batch non-critical alerts every hour') },
    { value: 'daily' as const, label: t('Daily Digest'), desc: t('Batch non-critical alerts into daily summary') },
  ];

  return (
    <div className="space-y-6">
      {quietActive && (
        <GlassPanel className="p-3 flex items-center gap-2 bg-neon-purple/10 border-neon-purple/20">
          <Icons.moon className="h-4 w-4 text-neon-purple" />
          <span className="text-xs font-medium text-purple-300">
            {t('Quiet hours active')} ({quietHours.start} – {quietHours.end})
          </span>
          <span className="text-[10px] text-[var(--text-muted)] ml-2">{t('Only critical alerts send notifications')}</span>
        </GlassPanel>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Quiet Hours */}
        <GlassPanel className="p-5">
          <span className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
            <Icons.moon className="h-4 w-4 text-purple-300" /> {t('Quiet Hours')}
          </span>
          <span className="text-xs text-[var(--text-muted)] mb-3 block">
            {t('During quiet hours, only critical alerts send notifications.')}
          </span>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-[var(--text-secondary)]">{t('Enable quiet hours')}</span>
            <Toggle
              checked={quietHours.enabled}
              onChange={(v) => {
                saveQuietHours({ ...quietHours, enabled: v });
                toast.info(v ? t('Quiet hours enabled') : t('Quiet hours disabled'));
              }}
            />
          </div>
          {quietHours.enabled && (
            <div className="flex items-center gap-3">
              <Input
                label={t('Start')}
                type="time"
                value={quietHours.start}
                onChange={e => saveQuietHours({ ...quietHours, start: e.target.value })}
              />
              <span className="text-[var(--text-muted)] mt-4">—</span>
              <Input
                label={t('End')}
                type="time"
                value={quietHours.end}
                onChange={e => saveQuietHours({ ...quietHours, end: e.target.value })}
              />
            </div>
          )}
        </GlassPanel>

        {/* Alert Digest */}
        <GlassPanel className="p-5">
          <span className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
            <Icons.settingsAlt className="h-4 w-4 text-amber-300" /> {t('Alert Digest')}
          </span>
          <span className="text-xs text-[var(--text-muted)] mb-3 block">
            {t('Choose how non-critical alerts are delivered.')}
          </span>
          <div className="space-y-2">
            {digestOptions.map(opt => (
              <GlassPanel
                key={opt.value}
                className={cn(
                  'p-3 cursor-pointer transition-all',
                  digestMode === opt.value ? 'bg-neon-amber/10 border-neon-amber/20' : 'hover:bg-white/[0.03]',
                )}
                onClick={() => {
                  saveDigest(opt.value);
                  toast.info(`${t('Alert digest set to')} ${opt.label}`);
                }}
              >
                <span className={cn('text-xs font-medium block', digestMode === opt.value ? 'text-amber-300' : 'text-[var(--text-secondary)]')}>
                  {opt.label}
                </span>
                <span className="text-[10px] text-[var(--text-muted)]">{opt.desc}</span>
              </GlassPanel>
            ))}
          </div>
        </GlassPanel>
      </div>

      {/* Alert Studio link */}
      <GlassPanel className="p-5">
        <span className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-2">
          <Icons.analytics className="h-4 w-4 text-emerald-300" /> {t('Rule Management')}
        </span>
        <span className="text-xs text-[var(--text-muted)] mb-3 block">
          {t('Create, edit, and manage typed alert rules in Alert Studio using supported Fleet Telemetry signal contracts.')}
        </span>
        <a
          href="/alert-studio"
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium bg-neon-cyan/15 text-neon-cyan ring-1 ring-neon-cyan/25 hover:bg-neon-cyan/25 transition-all"
        >
          {t('Open Alert Studio')} →
        </a>
      </GlassPanel>
    </div>
  );
}

// ─── Main page component ─────────────────────────────────────────────────────

export default function AlertsPage() {
  const { t } = useTranslation();
  usePageTitle(t('Alerts'));
  const toast = useToast();
  const savedView = useSavedViewUrl();

  // Phase 40 / Prompt 33 — tab + filter live in the URL so a "?tab=history&filter=critical"
  // deep link works and can be shared.
  const [tab, setTab] = useUrlEnum<'alerts' | 'history' | 'preferences'>(
    'tab',
    ['alerts', 'history', 'preferences'] as const,
    'alerts',
  );
  const [filter, setFilter] = useUrlEnum<'all' | 'unread' | 'critical'>(
    'filter',
    ['all', 'unread', 'critical'] as const,
    'all',
  );
  const [alertSearch, setAlertSearch] = useUrlString('q', '');
  const [alertPage, setAlertPage] = useUrlNumber('page', 1);
  const alertsPerPage = 20;

  // Queries
  const alertsQuery = useAlerts();
  const { data: alerts, isLoading, error } = alertsQuery;
  const { data: rules } = useAlertRules();
  const markReadMut = useMarkAlertRead();
  const { data: rulePins = [] } = usePinned('alert_rule');
  const pinnedRules = useMemo(() => {
    if (!rules || rulePins.length === 0) return [];
    const order = new Map<string, number>();
    rulePins.forEach(p => order.set(String(p.item_id), p.position));
    return rules
      .filter(r => order.has(String(r.id)))
      .sort((a, b) => (order.get(String(a.id)) ?? 0) - (order.get(String(b.id)) ?? 0));
  }, [rules, rulePins]);

  // Computed
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

  // Reset page when filter changes
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

  return (
    <PageContainer
      title={t('Alerts & Notifications')}
      subtitle={t('Monitor events, configure typed alert rules, and stay informed')}
      loading={isLoading}
      error={error as Error | null}
      copyLink
      actions={
        <div className="flex items-center gap-3">
          <DataFreshnessAuto query={alertsQuery} />
          {quietActive && <Badge variant="info" size="sm">{t('Quiet hours')}</Badge>}
          {unreadCount > 0 && <Badge variant="info" size="sm">{unreadCount} {t('unread')}</Badge>}
          {criticalCount > 0 && <Badge variant="danger" size="sm">{criticalCount} {t('critical')}</Badge>}
          <div data-print-hide className="flex items-center gap-2">
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
      {/* ── Alert stats row ──────────────────────────────────────────── */}
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

      {/* ── Summary gauges ───────────────────────────────────────────── */}
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

      {/* ── Quick metrics ────────────────────────────────────────────── */}
      <FadeIn>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <a href="/alert-studio">
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

      {/* ── Charts: severity trend + type breakdown ──────────────────── */}
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

      {/* ── Tab navigation ───────────────────────────────────────────── */}
      <FadeIn>
        <TabNav
          tabs={[
            { key: 'alerts', label: t('Alerts'), icon: <Icons.notifications className="h-4 w-4" /> },
            { key: 'history', label: t('History'), icon: <Icons.send className="h-4 w-4" /> },
            { key: 'preferences', label: t('Preferences'), icon: <Icons.settingsAlt className="h-4 w-4" /> },
          ]}
          active={tab}
          onChange={k => setTab(k as typeof tab, { push: true })}
        />
      </FadeIn>

      {/* ── Alerts Tab ───────────────────────────────────────────────── */}
      {tab === 'alerts' && (
        <>
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
            <>
            <div data-tour="alerts-list">
            <StaggerContainer className="space-y-2">
              {pagedAlerts.map(a => (
                <StaggerItem key={a.id}>
                  <AlertCard alert={a} onMarkRead={() => handleMarkRead(a.id)} t={t} />
                </StaggerItem>
              ))}
            </StaggerContainer>

            {/* Pagination */}
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
            </>
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
        </>
      )}

      {/* ── History Tab ──────────────────────────────────────────────── */}
      {tab === 'history' && <NotificationHistory t={t} />}

      {/* ── Preferences Tab ──────────────────────────────────────────── */}
      {tab === 'preferences' && <PreferencesSection t={t} />}
    </PageContainer>
  );
}
