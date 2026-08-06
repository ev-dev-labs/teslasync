/**
 * SoftwareUpdatesPage — track firmware versions and update history.
 *
 * Modern-UI full-width bento: a KPI band, an update-cadence chart beside a
 * status breakdown, the opt-in Helix changelog summarizer, and a responsive
 * grid of chronological update cards with public release-note links. Every
 * data-bound section owns its loading / error / empty state independently.
 */

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Download, CheckCircle, Smartphone, Calendar, Clock, ExternalLink,
  ArrowUpCircle, CalendarClock, RefreshCw, BarChart3, ListChecks, History,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, Button, Pagination, PanelTitle, Text, Caption } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { RangePicker, VehicleSelect, type RangePickerValue } from '@/components/forms';
import { AISoftwareUpdateChangelogSummarizer } from '@/components/ai/AISoftwareUpdateChangelogSummarizer';

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useUrlNumber, useUrlBatch } from '@/hooks/useUrlState';
import { formatDate } from '@/lib/dateFormat';
import { fmtInt } from '@/lib/numberFormat';
import { neonColorMap } from '@/lib/tokens';
import { cn } from '@/lib/cn';
import { request } from '@/api/client';

import {
  SoftwareUpdateCadenceChart,
  type CadencePoint,
} from '../components/SoftwareUpdateCadenceChart';
import { SoftwareUpdateStatusBreakdown } from '../components/SoftwareUpdateStatusBreakdown';
import { getUpdateStatus } from '../components/softwareUpdateStatus';

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
  const { t } = useTranslation();
  usePageTitle(t('softwareUpdates.title', 'Software Updates'));

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
  }, [installedUpdates, t]);

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

  // Reset pagination to page 1 whenever the range changes, writing the range
  // AND the page in a SINGLE navigation. Two separate URL setters (setRange +
  // setPage) race under react-router v6: both callbacks read the same params
  // snapshot, so the second setSearchParams(replace) discards the first — a
  // range change made while on page ≥ 2 silently reverted the range. Batching
  // via useUrlBatch is the same fix documented in useUrlState.ts.
  const handleRangeChange = useCallback(
    (r: RangePickerValue) => {
      setUrl({ from: r.start, to: r.end, page: null });
    },
    [setUrl],
  );

  const handleRetry = useCallback(() => {
    refetch();
  }, [refetch]);

  const actions = (
    <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
      <VehicleSelect />
      <RangePicker
        value={{ start, end }}
        onChange={handleRangeChange}
        align="end"
        triggerTestId="software-updates-range"
      />
      <Button
        variant="ghost"
        onClick={handleRetry}
        aria-label={t('common.refresh', 'Refresh')}
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );

  return (
    <PageContainer
      title={t('softwareUpdates.title', 'Software Updates')}
      subtitle={t('softwareUpdates.subtitle', 'Track firmware versions and update history')}
      actions={actions}
      query={updatesQuery}
    >
      {/* 1 — KPI band ─────────────────────────────────────────────── */}
      <FadeIn>
        <section
          aria-label={t('softwareUpdates.kpi.label', 'Software update summary')}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-6"
        >
          <MetricCard icon={<Smartphone className="h-5 w-5" />} label={t('softwareUpdates.kpi.currentVersion', 'Current Version')} value={latestVersion} color="cyan" />
          <MetricCard icon={<Download className="h-5 w-5" />} label={t('softwareUpdates.kpi.totalUpdates', 'Total Updates')} value={fmtInt(totalUpdates)} color="purple" />
          <MetricCard icon={<CheckCircle className="h-5 w-5" />} label={t('softwareUpdates.kpi.installed', 'Installed')} value={fmtInt(installedCount)} color="green" />
          <MetricCard icon={<ArrowUpCircle className="h-5 w-5" />} label={t('softwareUpdates.kpi.pending', 'Pending')} value={fmtInt(pendingCount)} color="amber" />
          <MetricCard icon={<Calendar className="h-5 w-5" />} label={t('softwareUpdates.kpi.lastInstalled', 'Last Installed')} value={lastInstalledAt ? formatDate(lastInstalledAt) : '—'} color="blue" />
          <MetricCard icon={<CalendarClock className="h-5 w-5" />} label={t('softwareUpdates.kpi.avgCadence', 'Avg Cadence')} value={avgCadence} color="cyan" />
        </section>
      </FadeIn>

      {/* 2 — Cadence chart + status breakdown ─────────────────────── */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('softwareUpdates.cadence.title', 'Update Cadence')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={224} />
            ) : isError ? (
              <QueryError error={error} onRetry={handleRetry} />
            ) : cadence.length === 0 ? (
              <EmptyState
                icon={<BarChart3 className="h-8 w-8" />}
                message={t('softwareUpdates.cadence.empty', 'No update activity in this range')}
                action={
                  presetId !== 'all'
                    ? { label: t('softwareUpdates.resetRangeCta', 'View all time'), onClick: resetRange }
                    : undefined
                }
              />
            ) : (
              <SoftwareUpdateCadenceChart data={cadence} />
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('softwareUpdates.breakdown.title', 'By Status')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={160} />
            ) : isError ? (
              <QueryError error={error} onRetry={handleRetry} />
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
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 3 — Helix changelog summarizer (opt-in; absent in ai_mode=off) */}
      <FadeIn delay={0.2}>
        <AISoftwareUpdateChangelogSummarizer vehicleId={vehicleId ?? undefined} />
      </FadeIn>

      {/* 4 — Update timeline (responsive card grid) ───────────────── */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-4 flex items-center gap-2">
            <History className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('softwareUpdates.timeline.title', 'Update Timeline')}
          </PanelTitle>
          {isLoading ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-4">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
            </div>
          ) : isError ? (
            <QueryError error={error} onRetry={handleRetry} />
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
              <ol className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-4">
                {updates.map((u) => {
                  const meta = getUpdateStatus(u.status);
                  const Icon = meta.icon;
                  const nc = neonColorMap[meta.color];
                  const vName = vehicleMap.get(u.vehicle_id)
                    ?? t('softwareUpdates.timeline.vehicleFallback', 'Vehicle {{id}}', { id: u.vehicle_id });
                  return (
                    <li key={u.id}>
                      <GlassPanel className="flex h-full flex-col p-4 transition-colors hover:border-[var(--border-default)]">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-start gap-3">
                            <span className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1', nc.bg, nc.ring)}>
                              <Icon className={cn('h-4 w-4', nc.text)} aria-hidden="true" />
                            </span>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <Text size="sm" weight="semibold" color="primary" className="tabular-nums">{u.version}</Text>
                                <Badge variant={meta.badgeVariant} size="sm">{t(meta.labelKey, meta.labelFallback)}</Badge>
                              </div>
                              <Caption className="mt-0.5 block truncate">{vName}</Caption>
                            </div>
                          </div>
                          <a
                            href={`https://www.notateslaapp.com/software-updates/version/${encodeURIComponent(u.version)}/release-notes`}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={t('softwareUpdates.timeline.releaseNotes', 'Release notes for {{version}}', { version: u.version })}
                            className="-mr-1 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
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
                              <Clock className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
                              <Text size="xs" className="text-amber-300">
                                {t('softwareUpdates.timeline.scheduledFor', 'Scheduled {{date}}', { date: formatDate(u.scheduled_at) })}
                              </Text>
                            </div>
                          )}
                          <Caption className="block">
                            {t('softwareUpdates.timeline.detected', 'Detected {{date}}', { date: formatDate(u.created_at) })}
                          </Caption>
                        </div>
                      </GlassPanel>
                    </li>
                  );
                })}
              </ol>
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
    </PageContainer>
  );
}
