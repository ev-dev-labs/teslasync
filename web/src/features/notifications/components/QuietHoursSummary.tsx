import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';
import { BellOff, BellRing, CircleHelp, Moon, Power, ShieldCheck } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { OperationalBrief, DataProvenanceBadge, type StatMetric } from '@/components/data-display';
import { QueryError, StatGridSkeleton, StaleRefreshWarning } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import type { QuietHoursWindow } from '@/api/hooks/useNotifications';

export interface QuietHoursSummaryProps {
  /** The quiet-hours-windows query (TanStack result) from the page. */
  query: UseQueryResult<QuietHoursWindow[]>;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseHHMM(value: string): number | null {
  if (!HHMM.test(value)) return null;
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Whether an enabled window is active at `now` in its configured zone:
 * respects the weekday bitmask (Sun=1<<0..Sat=1<<6) and cross-midnight wrap
 * (a window whose end < start spills into the next day, so the "after
 * midnight" leg is credited to the previous day's weekday bit).
 */
function isWindowActiveNow(w: QuietHoursWindow, now: Date): boolean | null {
  if (w.enabled === false) return false;
  if (w.enabled !== true) return null;
  const start = parseHHMM(w.start_local ?? '');
  const end = parseHHMM(w.end_local ?? '');
  if (start == null || end == null || start === end || !w.timezone
    || !Number.isInteger(w.weekdays) || w.weekdays < 0 || w.weekdays > 127) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: w.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now);
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    .indexOf(parts.find(part => part.type === 'weekday')?.value ?? '');
  const minutes = Number(parts.find(part => part.type === 'hour')?.value) * 60
    + Number(parts.find(part => part.type === 'minute')?.value);
  if (day < 0 || !Number.isFinite(minutes)) return null;
  const todayBit = 1 << day;
  const yesterdayBit = 1 << ((day + 6) % 7);
  const weekdays = w.weekdays;
  if (end < start) {
    if (minutes >= start && (weekdays & todayBit) !== 0) return true;
    if (minutes < end && (weekdays & yesterdayBit) !== 0) return true;
    return false;
  }
  return (weekdays & todayBit) !== 0 && minutes >= start && minutes < end;
}

export function QuietHoursSummary({ query }: QuietHoursSummaryProps) {
  const { t } = useTranslation();
  const source = useDataState(query);
  const windows = query.data ?? [];
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      setNow(Date.now());
      timer = setTimeout(update, 60_000 - Date.now() % 60_000);
    };
    update();
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  const stats = useMemo(() => {
    let enabled = 0;
    let activeNow = 0;
    let unknown = 0;
    const bypass = new Set<string>();
    for (const w of windows) {
      if (w.enabled === true) {
        enabled += 1;
        for (const sev of w.bypass_severities ?? []) bypass.add(sev);
      }
      const active = isWindowActiveNow(w, new Date(now));
      if (active === true) activeNow += 1;
      if (active === null) unknown += 1;
    }
    return { total: windows.length, enabled, activeNow, unknown, bypass: Array.from(bypass) };
  }, [windows, now]);

  const sectionLabel = t('notifications.quietHours.summary.label', 'Quiet hours summary');

  // Paused/idle initial queries need unknown metrics, not an endless skeleton.
  const firstLoad = query.isLoading && !source.hasData && !source.isRefreshBlocked;
  const unknown = t('common.unknown', 'Unknown');
  const unavailable = t('quietHours.unavailable', 'Quiet-hours windows unavailable.');
  const unresolved = !source.hasData;
  const incomplete = stats.unknown > 0;

  const isQuiet = stats.activeNow > 0;
  const statusValue = unresolved || (!isQuiet && incomplete) ? unknown : isQuiet
    ? t('notifications.quietHours.summary.statusQuiet', 'Quiet')
    : t('notifications.quietHours.summary.statusActive', 'Delivering');
  const statusSubtitle = unresolved
    ? source.isRefreshBlocked ? t('dataSources.status.paused', 'Refresh paused') : unavailable
    : !isQuiet && incomplete ? unknown : isQuiet
    ? t('notifications.quietHours.summary.statusQuietSub', '{{count}} window active now', {
        count: stats.activeNow,
      })
    : t('notifications.quietHours.summary.statusActiveSub', 'No window active now');
  const metrics: StatMetric[] = [
    {
      metricId: 'count', occurrenceId: 'quiet-windows', rawValue: unresolved ? null : stats.total,
      missingReason: unavailable,
      label: t('notifications.quietHours.summary.windows', 'Windows'),
      context: <><Moon className="h-5 w-5" aria-hidden="true" />{t('notifications.quietHours.summary.windowsSub', 'Configured schedules')}</>,
    },
    {
      metricId: 'count', occurrenceId: 'quiet-enabled',
      rawValue: unresolved || stats.total === 0 || windows.some(w => typeof w.enabled !== 'boolean') ? null : stats.enabled,
      display: { countTotal: stats.total },
      missingReason: unresolved ? unavailable : stats.total === 0
        ? t('notifications.quietHours.summary.noWindows', 'No configured windows') : unknown,
      label: t('notifications.quietHours.summary.enabled', 'Enabled'),
      context: <><Power className="h-5 w-5" aria-hidden="true" />{t('notifications.quietHours.summary.enabledSub', 'Active on schedule')}</>,
    },
    {
      metricId: 'status', occurrenceId: 'quiet-now', rawValue: statusValue,
      label: t('notifications.quietHours.summary.statusNow', 'Right now'),
      context: <>{statusValue === unknown ? <CircleHelp className="h-5 w-5" aria-hidden="true" /> : isQuiet ? <BellOff className="h-5 w-5" aria-hidden="true" /> : <BellRing className="h-5 w-5" aria-hidden="true" />}{statusSubtitle}</>,
    },
    {
      metricId: 'text', occurrenceId: 'quiet-bypass',
      rawValue: !unresolved && stats.bypass.length > 0 ? stats.bypass.map(severity => {
        if (severity === 'critical') return t('quietHours.severity.critical', 'Critical');
        if (severity === 'warn') return t('quietHours.severity.warn', 'Warning');
        if (severity === 'info') return t('quietHours.severity.info', 'Info');
        return severity;
      }).join(', ') : null,
      missingReason: unresolved ? unavailable : t('notifications.quietHours.summary.noBypass', 'No bypass severities configured'),
      label: t('notifications.quietHours.summary.alwaysAllow', 'Always allowed'),
      context: <><ShieldCheck className="h-5 w-5" aria-hidden="true" />{t('notifications.quietHours.summary.alwaysAllowSub', 'Severities that break through')}</>,
    },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  if (firstLoad) {
    return <section aria-label={sectionLabel}><StatGridSkeleton cards={4} /></section>;
  }
  if (source.fatalError) {
    return <section aria-label={sectionLabel}><GlassPanel className="p-4 sm:p-5">
      <QueryError error={source.fatalError} onRetry={() => { void query.refetch(); }}
        resourceName={t('notifications.quietHours.summary.resource', 'quiet-hours windows')} />
    </GlassPanel></section>;
  }

  return (
    <section aria-label={sectionLabel}>
      <StaleRefreshWarning state={source} label={sectionLabel} />
      <OperationalBrief
        compact
        testId="quiet-hours-brief"
        eyebrow={t('notifications.quietHours.summary.brief.eyebrow', 'Quiet-hours policy')}
        title={t('notifications.quietHours.summary.brief.title', 'Schedules, delivery status, and bypass policy')}
        description={t('notifications.quietHours.summary.periodContext', 'Enabled schedules and their bypass severities; current status uses the local weekday and time.')}
        statusLabel={source.status === 'stale'
          ? t('dataState.stale.title', 'Data may be stale')
          : unresolved ? statusSubtitle
          : incomplete ? t('dataState.partial.title', 'Partial data') : stats.total === 0
            ? t('notifications.quietHours.summary.brief.empty', 'No schedules')
            : t('notifications.quietHours.summary.brief.available', 'Schedules loaded')}
        statusTone={source.status === 'stale' || incomplete ? 'warning' : 'neutral'}
        metrics={operationalMetrics}
        scope={t('notifications.quietHours.summary.period', 'Configured schedules · right now')}
        freshness={<DataProvenanceBadge provenance={source.provenance} status={source.status} updatedAt={source.updatedAt} />}
        provenance={t('notifications.quietHours.summary.periodContext', 'Enabled schedules and their bypass severities; current status uses the local weekday and time.')}
      />
    </section>
  );
}
