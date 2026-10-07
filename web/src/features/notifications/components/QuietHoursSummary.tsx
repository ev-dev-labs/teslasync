/**
 * QuietHoursSummary — full-width KPI band for the Quiet hours page.
 *
 * Derives a responsive metric bento from `useQuietHours()` (passed in from the
 * page so it dedupes with QuietHoursPanel's own fetch). Every state — loading,
 * error — is handled here so the band is self-sufficient and stays visible
 * regardless of data availability. The empty case renders as zeros rather than
 * a blank panel: the adjacent QuietHoursPanel already owns the "add your first
 * window" call-to-action, so a second empty state here would be redundant.
 *
 * Each value states its status in words (not colour alone) so the band stays
 * legible for colour-blind users.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';
import { BellOff, BellRing, Moon, Power, ShieldCheck } from 'lucide-react';
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

/** Parse an `HH:MM` local-time string to minutes-since-midnight, or null. */
function parseHHMM(value: string): number | null {
  if (!HHMM.test(value)) return null;
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Whether an enabled window is active at `now`. Mirrors the server gate:
 * respects the weekday bitmask (Sun=1<<0..Sat=1<<6) and cross-midnight wrap
 * (a window whose end <= start spills into the next day, so the "after
 * midnight" leg is credited to the previous day's weekday bit).
 */
function isWindowActiveNow(w: QuietHoursWindow, now: Date): boolean {
  if (!w.enabled) return false;
  const start = parseHHMM(w.start_local ?? '');
  const end = parseHHMM(w.end_local ?? '');
  if (start == null || end == null) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const todayBit = 1 << now.getDay();
  const yesterdayBit = 1 << ((now.getDay() + 6) % 7);
  const weekdays = w.weekdays ?? 0;
  if (end <= start) {
    if (minutes >= start && (weekdays & todayBit) !== 0) return true;
    if (minutes < end && (weekdays & yesterdayBit) !== 0) return true;
    return false;
  }
  return (weekdays & todayBit) !== 0 && minutes >= start && minutes < end;
}

/** Responsive KPI grid summarising the configured quiet-hours windows. */
export function QuietHoursSummary({ query }: QuietHoursSummaryProps) {
  const { t } = useTranslation();
  const source = useDataState(query);
  const windows = query.data ?? [];

  const stats = useMemo(() => {
    const now = new Date();
    let enabled = 0;
    let activeNow = 0;
    const bypass = new Set<string>();
    for (const w of windows) {
      if (w.enabled) {
        enabled += 1;
        for (const sev of w.bypass_severities ?? []) bypass.add(sev);
      }
      if (isWindowActiveNow(w, now)) activeNow += 1;
    }
    return { total: windows.length, enabled, activeNow, bypass: Array.from(bypass) };
  }, [windows]);

  const sectionLabel = t('notifications.quietHours.summary.label', 'Quiet hours summary');

  // Only the genuine first load (no cached windows yet) shows the skeleton.
  // A background refetch keeps its previously-fetched windows, so we keep the
  // KPIs on screen instead of flashing an empty skeleton grid over them —
  // mirrors the firstLoad guard in the sibling InboxSummary.
  const firstLoad = query.isLoading && !source.hasData;

  const isQuiet = stats.activeNow > 0;
  const statusValue = isQuiet
    ? t('notifications.quietHours.summary.statusQuiet', 'Quiet')
    : t('notifications.quietHours.summary.statusActive', 'Delivering');
  const statusSubtitle = isQuiet
    ? t('notifications.quietHours.summary.statusQuietSub', '{{count}} window active now', {
        count: stats.activeNow,
      })
    : t('notifications.quietHours.summary.statusActiveSub', 'No window active now');
  const metrics: StatMetric[] = [
    {
      metricId: 'count', occurrenceId: 'quiet-windows', rawValue: stats.total,
      label: t('notifications.quietHours.summary.windows', 'Windows'),
      context: <><Moon className="h-5 w-5" aria-hidden="true" />{t('notifications.quietHours.summary.windowsSub', 'Configured schedules')}</>,
    },
    {
      metricId: 'count', occurrenceId: 'quiet-enabled',
      rawValue: stats.total === 0 ? null : stats.enabled,
      display: { countTotal: stats.total },
      missingReason: t('notifications.quietHours.summary.noWindows', 'No configured windows'),
      label: t('notifications.quietHours.summary.enabled', 'Enabled'),
      context: <><Power className="h-5 w-5" aria-hidden="true" />{t('notifications.quietHours.summary.enabledSub', 'Active on schedule')}</>,
    },
    {
      metricId: 'status', occurrenceId: 'quiet-now', rawValue: statusValue,
      label: t('notifications.quietHours.summary.statusNow', 'Right now'),
      context: <>{isQuiet ? <BellOff className="h-5 w-5" aria-hidden="true" /> : <BellRing className="h-5 w-5" aria-hidden="true" />}{statusSubtitle}</>,
    },
    {
      metricId: 'text', occurrenceId: 'quiet-bypass',
      rawValue: stats.bypass.length > 0 ? stats.bypass.join(', ') : null,
      missingReason: t('notifications.quietHours.summary.noBypass', 'No bypass severities configured'),
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
          : stats.total === 0
            ? t('notifications.quietHours.summary.brief.empty', 'No schedules')
            : t('notifications.quietHours.summary.brief.available', 'Schedules loaded')}
        statusTone={source.status === 'stale' ? 'warning' : 'neutral'}
        metrics={operationalMetrics}
        scope={t('notifications.quietHours.summary.period', 'Configured schedules · right now')}
        freshness={<DataProvenanceBadge provenance={source.provenance} status={source.status} updatedAt={source.updatedAt} />}
        provenance={t('notifications.quietHours.summary.periodContext', 'Enabled schedules and their bypass severities; current status uses the local weekday and time.')}
      />
    </section>
  );
}
