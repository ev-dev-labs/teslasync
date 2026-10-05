/**
 * SoftwareUpdatesPage — track firmware versions and update history.
 *
 * Modern-UI full-width bento: a KPI band, an update-cadence chart beside a
 * status breakdown, the opt-in Helix changelog summarizer, and a responsive
 * grid of chronological update cards with public release-note links. Every
 * data-bound section owns its loading / error / empty state independently.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Smartphone, Calendar, Clock, ExternalLink,
  RefreshCw, ListChecks, History,
} from 'lucide-react';

import { PageLayout, CardGrid, LayoutCard } from '@/components/layout/layout-reference';
import { GlassPanel, Badge, Button, Pagination, PanelTitle, Text, Caption } from '@/components/ui';
import { StatStrip, type StatMetric } from '@/components/data-display/stat-reference';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { AISoftwareUpdateChangelogSummarizer } from '@/components/ai/AISoftwareUpdateChangelogSummarizer';

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useUrlNumber, useUrlBatch } from '@/hooks/useUrlState';
import { formatDate } from '@/lib/dateFormat';

import { neonColorMap } from '@/lib/tokens';
import { cn } from '@/lib/cn';
import { request } from '@/api/client';

import { type CadencePoint } from '../components/SoftwareUpdateCadenceChart';
import { SoftwareCadenceCard } from '../components/software-updates-modernization/SoftwareCadenceCard';
import { SoftwareHistoryItem } from '../components/software-updates-modernization/SoftwareHistoryItem';
import { observedCount, softwareSourceState } from '../components/software-updates-modernization/presenter';
import { SoftwareUpdateStatusBreakdown } from '../components/SoftwareUpdateStatusBreakdown';
import { getUpdateStatus } from '../components/softwareUpdateStatus';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Wire shape from GET /software-updates (snake_case, matching Go JSON tags). */
interface SoftwareUpdate {
  id: number;
  vehicle_id: number;
  version: string;
  status: string;
  installed_at: string | null;
  scheduled_at: string | null;
  created_at: string;
}

const PAGE_SIZE = 50;

/** `YYYY-MM` → short label, e.g. `Mar '25`. */
function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return key;
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, {
    month: 'short',
    year: '2-digit',
  });
}

// ─── Page component ──────────────────────────────────────────────────────────

export default function SoftwareUpdatesPage() {
  const { fmtInt, locale } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('softwareUpdates.title', 'Software updates'));

  const { vehicleId, vehicles } = useSelectedVehicle();
  const [page, setPage] = useUrlNumber('page', 1);
  const setUrl = useUrlBatch();
  const { start, end, presetId, reset: resetRange } = useRangeState({
    persistKey: 'software-updates.range',
    defaultPresetId: 'all',
  });

  const updatesQuery = useQuery({
    queryKey: ['software-updates', vehicleId, page, start, end],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        vehicle_id: String(vehicleId),
        limit: String(PAGE_SIZE),
        offset: String((page - 1) * PAGE_SIZE),
        start,
        end,
      });
      return request<SoftwareUpdate[]>(`/software-updates?${params.toString()}`, { signal });
    },
    enabled: vehicleId !== null,
  });
  const { data, isLoading, isError, error, refetch } = updatesQuery;
  const source = softwareSourceState(data, isLoading, isError);

  // Defensive coercion — an unexpected non-array response shape must not crash
  // the derivations below.
  const updates = useMemo<SoftwareUpdate[]>(
    () => (Array.isArray(data) ? data : []),
    [data],
  );

  const vehicleMap = useMemo(() => {
    const m = new Map<number, string>();
    vehicles.forEach((v) => m.set(v.id, v.display_name || v.vin));
    return m;
  }, [vehicles]);

  // ── Derived KPIs ──
  const installedUpdates = useMemo(
    () => updates.filter((u) => u.status === 'installed'),
    [updates],
  );
  const latestVersion = updates[0]?.version ?? '—';
  const installedCount = installedUpdates.length;
  const totalUpdates = updates.length;
  const pendingCount = totalUpdates - installedCount;

  const lastInstalledAt = useMemo(() => {
    const dates = installedUpdates
      .map((u) => u.installed_at)
      .filter((d): d is string => Boolean(d))
      .sort();
    return dates.length > 0 ? dates[dates.length - 1] : null;
  }, [installedUpdates]);

  const avgCadence = useMemo(() => {
    const ms = installedUpdates
      .map((u) => (u.installed_at ? new Date(u.installed_at).getTime() : NaN))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    if (ms.length < 2) return '—';
    const spanDays = (ms[ms.length - 1] - ms[0]) / 86_400_000;
    return t('softwareUpdates.kpi.cadenceDays', '{{days}}d', {
      days: fmtInt(spanDays / (ms.length - 1)),
    });
  }, [installedUpdates, t, fmtInt]);

  // ── Cadence chart (updates per calendar month) ──
  const cadence = useMemo<CadencePoint[]>(() => {
    const buckets = new Map<string, number>();
    for (const u of updates) {
      const iso = u.installed_at ?? u.created_at;
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return Array.from(buckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, count]) => ({ month, label: monthLabel(month), count }));
  }, [updates]);

  // ── Status breakdown ──
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const u of updates) counts[u.status] = (counts[u.status] ?? 0) + 1;
    return counts;
  }, [updates]);

  const paginationTotal =
    updates.length < PAGE_SIZE
      ? (page - 1) * PAGE_SIZE + updates.length
      : page * PAGE_SIZE + 1;

  const previousRange = useRef(`${start}:${end}`);
  useEffect(() => {
    const currentRange = `${start}:${end}`;
    if (previousRange.current === currentRange) return;
    previousRange.current = currentRange;
    if (page !== 1) setUrl({ page: null });
  }, [start, end, page, setUrl]);

  const handleRetry = useCallback(() => {
    refetch();
  }, [refetch]);

  const actions = (
    <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
      <Button
        variant="ghost"
        onClick={handleRetry}
        aria-label={t('common.refresh', 'Refresh')}
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );

  // Specialist version/date/cadence strings retain their original formatters.
  // Occurrence IDs describe this page's facts, not new glossary semantics.
  const metrics: StatMetric[] = [
    { metricId: 'text', occurrenceId: 'software-current-version', label: t('softwareUpdates.kpi.currentVersion', 'Current version'), description: t('softwareUpdates.kpi.versionHelp', 'Version from the first returned update; not an independently observed installed firmware snapshot.'), rawValue: updates.length > 0 ? latestVersion : null },
    { metricId: 'count', occurrenceId: 'software-total-updates', label: t('softwareUpdates.kpi.totalUpdates', 'Total updates'), description: t('softwareUpdates.kpi.totalHelp', 'Number of updates on the loaded page.'), rawValue: observedCount(source.available, totalUpdates), display: { units: { locale } } },
    { metricId: 'count', occurrenceId: 'software-installed', label: t('softwareUpdates.kpi.installed', 'Installed'), description: t('softwareUpdates.kpi.installedHelp', 'Loaded updates whose status is installed.'), rawValue: observedCount(source.available, installedCount), display: { units: { locale } } },
    { metricId: 'count', occurrenceId: 'software-pending', label: t('softwareUpdates.kpi.pending', 'Pending'), description: t('softwareUpdates.kpi.pendingHelp', 'All loaded updates minus installed updates; includes every other status.'), rawValue: observedCount(source.available, pendingCount), display: { units: { locale } } },
    { metricId: 'text', occurrenceId: 'software-last-installed', label: t('softwareUpdates.kpi.lastInstalled', 'Last installed'), description: t('softwareUpdates.kpi.lastHelp', 'Latest nonempty installation date among loaded installed updates.'), rawValue: lastInstalledAt ? formatDate(lastInstalledAt) : null },
    { metricId: 'text', occurrenceId: 'software-average-cadence', label: t('softwareUpdates.kpi.avgCadence', 'Avg cadence'), description: t('softwareUpdates.kpi.cadenceHelp', 'Span in days divided by the number of intervals between valid installation dates on this page.'), rawValue: avgCadence === '—' ? null : avgCadence },
  ];
  const retryContent = isError ? <QueryError error={error} onRetry={handleRetry} /> : undefined;
  const resetAction = presetId !== 'all'
    ? { label: t('softwareUpdates.resetRangeCta', 'View all time'), onClick: resetRange }
    : undefined;
  const unavailableMessage = t('softwareUpdates.source.unavailable', 'Update history is not available. Select a vehicle to load its history.');

  return (
    <PageLayout
      title={t('softwareUpdates.title', 'Software updates')}
      subtitle={t('softwareUpdates.subtitle', 'Track firmware versions and update history')}
      secondaryActions={actions}
      query={updatesQuery}
    >
      {/* 1 — KPI band ─────────────────────────────────────────────── */}
      <FadeIn>
        <StatStrip
          id="software-update-summary"
          title={t('softwareUpdates.kpi.label', 'Software update summary')}
          metrics={metrics}
          loading={source.initialLoading}
          retained={source.retained}
          error={isError ? t('softwareUpdates.source.failed', 'Update history could not be refreshed. Retry to recover.') : null}
          period={{
            kind: 'unknown',
            label: t('softwareUpdates.source.period', 'Loaded update history'),
            reason: t('softwareUpdates.source.scope', 'Summary and charts describe this page of up to 50 updates in the selected range, not the complete fleet history.'),
          }}
          footer={!source.available && !isLoading ? retryContent ?? <EmptyState message={unavailableMessage} /> : undefined}
        />
      </FadeIn>

      {/* 2 — Cadence chart + status breakdown ─────────────────────── */}
      <FadeIn delay={0.1}>
        <CardGrid label={t('softwareUpdates.kpi.label', 'Software update summary')} items={[
          { id: 'software-cadence', size: 'half', content: (
            <SoftwareCadenceCard
              data={cadence}
              loading={source.initialLoading}
              error={source.fatalError ? error : undefined}
              onRetry={handleRetry}
              errorContent={source.retained ? retryContent : undefined}
              emptyMessage={source.available ? t('softwareUpdates.cadence.empty', 'No update activity in this range') : unavailableMessage}
              emptyContent={source.available && resetAction ? <Button variant="outline" onClick={resetAction.onClick}>{resetAction.label}</Button> : undefined}
            />
          ) },

          { id: 'software-status', size: 'half', content: (
          <LayoutCard title={t('softwareUpdates.breakdown.title', 'By status')}>
            {source.retained && retryContent}
            {source.initialLoading ? (
              <Skeleton height={160} />
            ) : source.fatalError ? (
              <QueryError error={error} onRetry={handleRetry} />
            ) : !source.available ? (
              <EmptyState message={unavailableMessage} />
            ) : totalUpdates === 0 ? (
              <EmptyState
                icon={<ListChecks className="h-8 w-8" />}
                message={t('softwareUpdates.breakdown.empty', 'No updates to summarize')}
                action={
                  presetId !== 'all'
                    ? { label: t('softwareUpdates.resetRangeCta', 'View all time'), onClick: resetRange }
                    : undefined
                }
              />
            ) : (
              <SoftwareUpdateStatusBreakdown counts={statusCounts} total={totalUpdates} />
            )}
          </LayoutCard>
          ) },
        ]} />
      </FadeIn>

      {/* 3 — Helix changelog summarizer (opt-in; absent in ai_mode=off) */}
      <FadeIn delay={0.2}>
        <AISoftwareUpdateChangelogSummarizer vehicleId={vehicleId ?? undefined} />
      </FadeIn>

      {/* 4 — Update timeline (responsive card grid) ───────────────── */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-4 flex items-center gap-2">
            <History className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
            {t('softwareUpdates.timeline.title', 'Update timeline')}
          </PanelTitle>
          {source.retained && retryContent}
          {source.initialLoading ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-4">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
            </div>
          ) : source.fatalError ? (
            <QueryError error={error} onRetry={handleRetry} />
          ) : !source.available ? (
            <EmptyState message={unavailableMessage} />
          ) : updates.length === 0 ? (
            <EmptyState
              icon={<Smartphone className="h-12 w-12" />}
              title={t('softwareUpdates.timeline.emptyTitle', 'No update history')}
              message={t('softwareUpdates.timeline.empty', 'No software update history available for this vehicle yet.')}
              action={
                presetId !== 'all'
                  ? { label: t('softwareUpdates.resetRangeCta', 'View all time'), onClick: resetRange }
                  : undefined
              }
            />
          ) : (
            <>
              <div role="list" aria-label={t('softwareUpdates.timeline.title', 'Update timeline')}>
              <CardGrid label={t('softwareUpdates.timeline.title', 'Update timeline')} items={updates.map((u) => {
                  const meta = getUpdateStatus(u.status);
                  const Icon = meta.icon;
                  const nc = neonColorMap[meta.color];
                  const vName = vehicleMap.get(u.vehicle_id)
                    ?? t('softwareUpdates.timeline.vehicleFallback', 'Vehicle {{id}}', { id: u.vehicle_id });
                  return { id: String(u.id), size: 'quarter' as const, content: (
                      <SoftwareHistoryItem version={u.version}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-start gap-3">
                            <span className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1', nc.bg, nc.ring)}>
                              <Icon className={cn('h-4 w-4', nc.text)} aria-hidden="true" />
                            </span>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant={meta.badgeVariant} size="sm">{t(meta.labelKey, meta.labelFallback)}</Badge>
                              </div>
                              <Caption className="mt-0.5 block break-words">{vName}</Caption>
                            </div>
                          </div>
                          <a
                            href={`https://www.notateslaapp.com/software-updates/version/${encodeURIComponent(u.version)}/release-notes`}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={t('softwareUpdates.timeline.releaseNotes', 'Release notes for {{version}}', { version: u.version })}
                            className="-mr-1 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]"
                          >
                            <ExternalLink className="h-4 w-4" aria-hidden="true" />
                          </a>
                        </div>
                        <div className="mt-3 space-y-1 border-t border-[var(--border-subtle)] pt-3">
                          {u.installed_at && (
                            <div className="flex items-center gap-1.5">
                              <Calendar className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
                              <Text variant="bodySm">
                                {t('softwareUpdates.timeline.installedOn', 'Installed {{date}}', { date: formatDate(u.installed_at) })}
                              </Text>
                            </div>
                          )}
                          {u.scheduled_at && !u.installed_at && (
                            <div className="flex items-center gap-1.5">
                              <Clock className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
                              <Text size="xs">
                                {t('softwareUpdates.timeline.scheduledFor', 'Scheduled {{date}}', { date: formatDate(u.scheduled_at) })}
                              </Text>
                            </div>
                          )}
                          <Caption className="block">
                            {t('softwareUpdates.timeline.detected', 'Detected {{date}}', { date: formatDate(u.created_at) })}
                          </Caption>
                        </div>
                      </SoftwareHistoryItem>
                  ) };
                })} />
              </div>
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={paginationTotal}
                onPageChange={setPage}
              />
            </>
          )}
        </GlassPanel>
      </FadeIn>
    </PageLayout>
  );
}
