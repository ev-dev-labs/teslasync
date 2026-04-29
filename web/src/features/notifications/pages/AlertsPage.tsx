/**
 * AlertsPage — alert history, analytics, notification log, and preferences.
 *
 * Three tabs: Alerts (list + charts), History (notification log), Preferences (quiet hours, digest).
 */

import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TabNav } from '@/components/ui/TabNav';
import { Toggle } from '@/components/ui/Toggle';
import { DataTable, type Column } from '@/components/ui/DataTable';

import { MetricCard } from '@/components/data-display/MetricCard';
import { AnimatedNumber } from '@/components/data-display/AnimatedNumber';
import { fmtInt } from '@/lib/numberFormat';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { FadeIn } from '@/components/motion/FadeIn';
import { StaggerContainer } from '@/components/motion/StaggerContainer';
import { StaggerItem } from '@/components/motion/StaggerItem';
import { RadialGauge } from '@/components/charts/RadialGauge';
import { ChartTooltip } from '@/components/charts/ChartTooltip';
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
import type { Alert, NotificationLog } from '@/api/types';
import {
  Bell, BellOff, AlertTriangle, Info, AlertCircle, MapPin, Battery,
  Zap, Shield, Gauge, Thermometer, Eye, Filter, Settings2, CheckCircle,
  Clock, Moon, Send, TrendingDown, Lock, Droplets, BarChart3,
  PieChart as PieChartIcon, Database, Radio, Wifi, HardDrive, Activity,
} from 'lucide-react';

// ─── Severity config ─────────────────────────────────────────────────────────

const severityConfig = {
  info: { icon: Info, color: 'text-neon-cyan', bg: 'bg-neon-cyan/10', border: 'border-neon-cyan/20', dot: 'bg-neon-cyan' },
  warning: { icon: AlertTriangle, color: 'text-neon-amber', bg: 'bg-neon-amber/10', border: 'border-neon-amber/20', dot: 'bg-neon-amber' },
  critical: { icon: AlertCircle, color: 'text-neon-red', bg: 'bg-neon-red/10', border: 'border-neon-red/20', dot: 'bg-neon-red' },
} as const;

type Severity = keyof typeof severityConfig;

// ─── Alert type → icon mapping ───────────────────────────────────────────────

const typeIcons: Record<string, React.ElementType> = {
  geofence_exit: MapPin, geofence_enter: MapPin,
  low_battery: Battery, battery_low: Battery, battery_high: Battery,
  charging_complete: Zap, charging_cost: Zap,
  sentry_event: Shield, speed_limit: Gauge, temperature: Thermometer,
  software_update: Settings2, vampire_drain: TrendingDown,
  tire_pressure_low: Droplets, idle_unlocked: Lock, efficiency_drop: BarChart3,
  system_database: Database, system_mqtt: Wifi, system_redis: HardDrive,
  system_tesla_api: Radio, system_worker: Activity,
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

function AlertCard({ alert, onMarkRead, t }: { alert: Alert; onMarkRead: () => void; t: (k: string) => string }) {
  const sev = severityConfig[alert.severity as Severity] ?? severityConfig.info;
  const Icon = typeIcons[alert.type] || Bell;
  const timeAgo = getTimeAgo(alert.created_at);

  return (
    <GlassPanel
      className={cn(
        'p-4 flex items-start gap-4 transition-all duration-200 group',
        !alert.is_read && `${sev.border} ${sev.bg.replace('/10', '/5')}`,
      )}
    >
      <div className="flex flex-col items-center gap-1 shrink-0">
        <div className={cn('rounded-xl p-2.5 ring-1', sev.bg, sev.border)}>
          <Icon className={cn('h-4 w-4', sev.color)} />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className={cn('text-sm font-medium block', alert.is_read ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]')}>
              {alert.title}
            </span>
            <span className="text-xs text-[var(--text-muted)] mt-0.5 line-clamp-2 block">{alert.message}</span>
          </div>
          {!alert.is_read && (
            <span className={cn('h-2 w-2 rounded-full shrink-0 mt-1.5 animate-pulse', sev.dot)} />
          )}
        </div>
        <div className="flex items-center gap-3 mt-2">
          <span className="text-[10px] text-[var(--text-muted)] flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" />{timeAgo}
          </span>
          <Badge variant={alert.severity === 'critical' ? 'danger' : alert.severity === 'warning' ? 'warning' : 'info'} size="sm">
            {alert.severity}
          </Badge>
          <span className="text-[10px] text-[var(--text-muted)]">{alert.type.replace(/_/g, ' ')}</span>
          {!alert.is_read && (
            <Button variant="ghost" size="sm" icon={<Eye className="h-3 w-3" />} onClick={onMarkRead} className="ml-auto opacity-0 group-hover:opacity-100">
              {t('Mark read')}
            </Button>
          )}
        </div>
      </div>
    </GlassPanel>
  );
}

// ─── NotificationHistory sub-component ───────────────────────────────────────

function NotificationHistory({ t }: { t: (k: string) => string }) {

  const { data: logs, isLoading: logsLoading } = useNotificationLogs();
  const { data: stats } = useNotificationStats();
  const { data: channels } = useNotificationChannels();

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

  const logColumns: Column<NotificationLog>[] = useMemo(() => [
    { key: 'time', header: t('Time'), render: (log) => <span className="text-[var(--text-muted)] whitespace-nowrap">{formatDateTime(log.created_at)}</span> },
    { key: 'title', header: t('Title'), render: (log) => <span className="text-[var(--text-primary)] max-w-[200px] truncate block">{log.title}</span> },
    { key: 'channel', header: t('Channel'), render: (log) => <span className="text-[var(--text-secondary)]">{channelMap[log.channel_id] || `#${log.channel_id}`}</span> },
    { key: 'status', header: t('Status'), render: (log) => <Badge variant={log.status === 'sent' ? 'success' : log.status === 'failed' ? 'danger' : 'warning'} size="sm">{log.status}</Badge> },
  ], [channelMap, t]);

  return (
    <div className="space-y-6">
      {/* Analytics cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label={t('Total Sent')} value={totalSent} icon={<Send className="h-4 w-4" />} color="cyan" />
        <MetricCard label={t('Failed')} value={totalFailed} icon={<AlertCircle className="h-4 w-4" />} color="red" />
        <MetricCard label={t('Success Rate')} value={`${fmtInt(successRate)}%`} icon={<CheckCircle className="h-4 w-4" />} color="green" />
        <MetricCard label={t('Channels')} value={`${stats?.enabled_channels ?? 0} / ${stats?.total_channels ?? 0}`} icon={<Bell className="h-4 w-4" />} color="purple" />
      </div>

      {/* Delivery status pie */}
      <GlassPanel className="p-4 sm:p-6">
        <span className="section-title mb-4 flex items-center gap-2">
          <PieChartIcon className="h-4 w-4 text-neon-purple" /> {t('Delivery Status')}
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
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-[var(--text-muted)]">
            <Activity className="h-8 w-8 opacity-20" />
            <p className="text-xs">{t('common.noData')}</p>
          </div>
        )}
      </GlassPanel>

      {/* Log table */}
      <GlassPanel className="p-4 sm:p-6">
        <span className="section-title mb-4 flex items-center gap-2">
          <Send className="h-4 w-4 text-neon-cyan" /> {t('Notification Log')}
        </span>
        {logsLoading ? (
          <div className="space-y-2">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10" />)}</div>
        ) : (logs ?? []).length > 0 ? (
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <DataTable
                columns={logColumns}
                data={logs ?? []}
                keyExtractor={(log) => log.id}
                compact
                pagination={{ defaultPageSize: 50 }}
              />
            </div>
        ) : (
          <EmptyState
            icon={<Send className="h-8 w-8" />}
            title={t('No notification logs')}
            message={t('Notification logs will appear here once alerts are sent.')}
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
          <Moon className="h-4 w-4 text-neon-purple" />
          <span className="text-xs font-medium text-neon-purple">
            {t('Quiet hours active')} ({quietHours.start} – {quietHours.end})
          </span>
          <span className="text-[10px] text-[var(--text-muted)] ml-2">{t('Only critical alerts send notifications')}</span>
        </GlassPanel>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Quiet Hours */}
        <GlassPanel className="p-5">
          <span className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
            <Moon className="h-4 w-4 text-neon-purple" /> {t('Quiet Hours')}
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
            <Settings2 className="h-4 w-4 text-neon-amber" /> {t('Alert Digest')}
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
                <span className={cn('text-xs font-medium block', digestMode === opt.value ? 'text-neon-amber' : 'text-[var(--text-secondary)]')}>
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
          <BarChart3 className="h-4 w-4 text-neon-green" /> {t('Rule Management')}
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

  const [tab, setTab] = useState<'alerts' | 'history' | 'preferences'>('alerts');
  const [filter, setFilter] = useState<'all' | 'unread' | 'critical'>('all');
  const [alertPage, setAlertPage] = useState(1);
  const alertsPerPage = 20;

  // Queries
  const { data: alerts, isLoading, error } = useAlerts();
  const { data: rules } = useAlertRules();
  const markReadMut = useMarkAlertRead();

  // Computed
  const filteredAlerts = useMemo(() => alerts?.filter(a => {
    if (filter === 'unread') return !a.is_read;
    if (filter === 'critical') return a.severity === 'critical';
    return true;
  }) ?? [], [alerts, filter]);

  // Reset page when filter changes
  const totalPages = Math.max(1, Math.ceil(filteredAlerts.length / alertsPerPage));
  const safeAlertPage = Math.min(alertPage, totalPages);
  const pagedAlerts = filteredAlerts.slice((safeAlertPage - 1) * alertsPerPage, safeAlertPage * alertsPerPage);

  const totalCount = alerts?.length ?? 0;
  const unreadCount = useMemo(() => alerts?.filter(a => !a.is_read).length ?? 0, [alerts]);
  const criticalCount = useMemo(() => alerts?.filter(a => a.severity === 'critical' && !a.is_read).length ?? 0, [alerts]);
  const infoCount = useMemo(() => alerts?.filter(a => a.severity === 'info').length ?? 0, [alerts]);
  const warningCount = useMemo(() => alerts?.filter(a => a.severity === 'warning').length ?? 0, [alerts]);
  const readCount = useMemo(() => alerts?.filter(a => a.is_read).length ?? 0, [alerts]);
  const enabledRules = rules?.filter(r => r.enabled).length ?? 0;

  const alertsByType = useMemo(() => {
    if (!alerts?.length) return [];
    const counts: Record<string, number> = {};
    alerts.forEach(a => { counts[a.type] = (counts[a.type] || 0) + 1; });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count], i) => ({ name: type.replace(/_/g, ' '), value: count, fill: CHART_COLORS[i % CHART_COLORS.length] }));
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
      if (days[key]) days[key][a.severity as Severity]++;
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
      actions={
        <div className="flex items-center gap-3">
          {quietActive && <Badge variant="info" size="sm">{t('Quiet hours')}</Badge>}
          {unreadCount > 0 && <Badge variant="info" size="sm">{unreadCount} {t('unread')}</Badge>}
          {criticalCount > 0 && <Badge variant="danger" size="sm">{criticalCount} {t('critical')}</Badge>}
        </div>
      }
    >
      {/* ── Alert stats row ──────────────────────────────────────────── */}
      <FadeIn>
        <GlassPanel className="p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-8 text-center">
            <div>
              <span className="text-lg font-bold text-neon-cyan"><AnimatedNumber value={totalCount} /></span>
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block">{t('Total')}</span>
            </div>
            <div className="h-8 w-px bg-white/[0.06] hidden sm:block" />
            <div>
              <span className="text-lg font-bold text-neon-amber"><AnimatedNumber value={weekAlertCount} /></span>
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block">{t('This Week')}</span>
            </div>
            <div className="h-8 w-px bg-white/[0.06] hidden sm:block" />
            <div>
              <span className="text-lg font-bold text-neon-purple"><AnimatedNumber value={unreadCount} /></span>
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block">{t('Unread')}</span>
            </div>
            <div className="h-8 w-px bg-white/[0.06] hidden sm:block" />
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 text-xs"><Info className="h-3 w-3 text-neon-cyan" /><span className="font-mono text-neon-cyan">{infoCount}</span></span>
              <span className="flex items-center gap-1 text-xs"><AlertTriangle className="h-3 w-3 text-neon-amber" /><span className="font-mono text-neon-amber">{warningCount}</span></span>
              <span className="flex items-center gap-1 text-xs"><AlertCircle className="h-3 w-3 text-neon-red" /><span className="font-mono text-neon-red">{criticalCount}</span></span>
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
                <Info className="h-4 w-4 text-neon-cyan" />
                <span className="text-lg font-bold text-neon-cyan"><AnimatedNumber value={infoCount} /></span>
              </div>
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-1">{t('Info')}</span>
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-neon-amber" />
                <span className="text-lg font-bold text-neon-amber"><AnimatedNumber value={warningCount} /></span>
              </div>
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-1">{t('Warnings')}</span>
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-neon-green" />
                <span className="text-lg font-bold text-neon-green"><AnimatedNumber value={readCount} /></span>
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
              <span className="text-sm font-bold text-neon-cyan">{enabledRules}/{rules?.length ?? 0}</span>
              <span className="text-[9px] text-neon-cyan mt-1 block">→ {t('Alert Studio')}</span>
            </GlassPanel>
          </a>
          <GlassPanel className="p-3 text-center">
            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1 block">{t('Read Rate')}</span>
            <span className="text-sm font-bold text-neon-green">{totalCount > 0 ? `${fmtInt((readCount / totalCount) * 100)}%` : '—'}</span>
          </GlassPanel>
          <GlassPanel className="p-3 text-center">
            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1 block">{t('Most Common')}</span>
            <span className="text-sm font-bold text-neon-purple">{alertsByType[0]?.name ?? '—'}</span>
          </GlassPanel>
          <GlassPanel className="p-3 text-center">
            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1 block">{t('Last 7 Days')}</span>
            <span className="text-sm font-bold text-neon-amber">{weekAlertCount}</span>
          </GlassPanel>
        </div>
      </FadeIn>

      {/* ── Charts: severity trend + type breakdown ──────────────────── */}
      {totalCount > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <FadeIn>
            <GlassPanel className="p-4 sm:p-6">
              <span className="section-title mb-4 flex items-center gap-2">
                <Bell className="h-4 w-4 text-neon-cyan" /> {t('Alert Trend (7 Days)')}
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
                <Filter className="h-4 w-4 text-neon-purple" /> {t('Alerts by Type')}
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
            { key: 'alerts', label: t('Alerts'), icon: <Bell className="h-4 w-4" /> },
            { key: 'history', label: t('History'), icon: <Send className="h-4 w-4" /> },
            { key: 'preferences', label: t('Preferences'), icon: <Settings2 className="h-4 w-4" /> },
          ]}
          active={tab}
          onChange={k => setTab(k as typeof tab)}
        />
      </FadeIn>

      {/* ── Alerts Tab ───────────────────────────────────────────────── */}
      {tab === 'alerts' && (
        <>
          <FadeIn>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-[var(--text-muted)]" />
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
          </FadeIn>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-20" />)}
            </div>
          ) : filteredAlerts.length > 0 ? (
            <>
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
            </>
          ) : (
            <EmptyState
              icon={<BellOff className="h-8 w-8" />}
              title={t('No alerts')}
              message={filter === 'all' ? t('Your fleet is running smoothly. Alerts will appear here.') : t(`No ${filter} alerts right now.`)}
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
