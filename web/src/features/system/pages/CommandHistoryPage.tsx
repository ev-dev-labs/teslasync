/**
 * CommandHistoryPage — modern-ui full-width redesign.
 *
 * A full-bleed command-center audit log of every vehicle command:
 *   1. KPI band        — 6 at-a-glance metrics (all-time + 24h context)
 *   2. Filter bar      — status tabs + live command search
 *   3. Insights bento  — daily success/failure activity chart (hero) +
 *                        most-used command breakdown
 *   4. Detail band     — paginated command timeline + status breakdown rail
 *
 * Scoping model: the workspace header scopes all command history and
 * analytics. Status and search additionally scope the timeline and its
 * pagination, while the KPI band reflects the complete selected window.
 */

import { useDeferredValue, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { PageLayout } from '@/components/layout';
import {
  GlassPanel, Input as ControlInput,
  TabNav, Pagination, PanelTitle, Text, Caption, Badge,
} from '@/components/ui';
import { OperationalBrief, MetricBar, Timeline } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { EmptyState, Skeleton, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ChartLegend,
  ResponsiveContainer, ChartTooltip, CHART_COLORS, axisTickSm, EmbeddedChart,
} from '@/components/charts';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useRangeState } from '@/hooks/useRangeState';
import { useProductPreferences } from '@/hooks/useProductPreferences';
import { useUrlBatch, useUrlEnum, useUrlNumber, useUrlString } from '@/hooks/useUrlState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useCommandReliabilityHistory, type CommandLogEntry } from '@/api/hooks/useCommands';
import { formatDateTime, formatRelative } from '@/lib/dateFormat';
import { localDayKey } from '@/lib/drivesAggregation';
import { useTimezone } from '@/lib/timezone';
import {
  CheckCircle, XCircle, Terminal, History,
  Search, Gamepad2, ListChecks, BarChart3, ShieldCheck,
} from 'lucide-react';
import { commandHistoryMetrics } from '../components/statstrip-command-summaries/commandSummaryMetrics';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const COMMAND_LABELS: Record<string, string> = {
  lock: 'Lock',
  unlock: 'Unlock',
  wake_up: 'Wake up',
  climate_on: 'Climate ON',
  climate_off: 'Climate OFF',
  honk_horn: 'Honk horn',
  flash_lights: 'Flash lights',
  charge_start: 'Start charging',
  charge_stop: 'Stop charging',
  set_charge_limit: 'Set charge limit',
  set_temps: 'Set temperature',
  actuate_trunk: 'Open/close trunk',
  actuate_frunk: 'Open frunk',
  window_control: 'Window control',
  sun_roof_control: 'Sunroof control',
  remote_start_drive: 'Remote start',
  set_sentry_mode: 'Sentry mode',
  set_speed_limit: 'Speed limit',
  clear_speed_limit: 'Clear speed limit',
  set_valet_mode: 'Valet mode',
  reset_valet_pin: 'Reset valet PIN',
  schedule_software_update: 'Schedule update',
  cancel_software_update: 'Cancel update',
  media_toggle_playback: 'Media play/pause',
  media_next_track: 'Next track',
  media_prev_track: 'Previous track',
  media_volume_up: 'Volume up',
  media_volume_down: 'Volume down',
  adjust_volume: 'Adjust volume',
  navigation_request: 'Navigate',
  share: 'Share to vehicle',
  trigger_homelink: 'Trigger HomeLink',
  set_bioweapon_mode: 'Bioweapon defense',
  set_climate_keeper: 'Climate keeper',
  set_cop_temp: 'Cabin overheat protection',
  dog_mode_on: 'Dog mode ON',
  dog_mode_off: 'Dog mode OFF',
  camp_mode_on: 'Camp mode ON',
  camp_mode_off: 'Camp mode OFF',
  set_scheduled_departure: 'Scheduled departure',
  set_scheduled_charging: 'Scheduled charging',
  set_preconditioning_max: 'Max preconditioning',
  auto_conditioning_start: 'Start preconditioning',
  auto_conditioning_stop: 'Stop preconditioning',
  remote_seat_heater_request: 'Seat heater',
  remote_seat_cooler_request: 'Seat cooler',
  remote_steering_wheel_heater_request: 'Steering wheel heater',
  close_charge_port: 'Close charge port',
  open_charge_port: 'Open charge port',
  set_pin_to_drive: 'PIN to drive',
};

/** Component `t` function type — lets module-level helpers resolve i18n keys. */
type TranslateFn = ReturnType<typeof useTranslation>['t'];

/** Curated English fallback, with sentence case for unknown commands. */
function commandFallbackLabel(cmd: string): string {
  return (
    COMMAND_LABELS[cmd] ??
    cmd
      .replace(/_/g, ' ')
      .replace(/^\w/, (c) => c.toUpperCase())
  );
}

/**
 * Resolve a command's user-facing label through i18n. Keys follow
 * `commandHistory.commands.<raw_command>` so translators can localize each
 * label; the curated English map is the default value.
 */
function formatCommandName(cmd: string, t: TranslateFn): string {
  return t(`commandHistory.commands.${cmd}`, commandFallbackLabel(cmd));
}

const PAGE_SIZE = 25;

const STATUS_FILTERS = ['all', 'success', 'failed'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

// Semantic status colors reused by the chart, timeline dots, and bars.
const SUCCESS_COLOR = '#22c55e';
const FAILED_COLOR = '#ef4444';
const OTHER_COLOR = '#64748b';

// ─── Page ────────────────────────────────────────────────────────────────────

export default function CommandHistoryPage() {
  const { t } = useTranslation();
  const { fmtPercent, precision } = useNumberFormatting();
  const pctLabel = (n: number, total: number): string =>
    fmtPercent(total > 0 ? (n / total) * 100 : 0);
  usePageTitle(t('commandHistory.title', 'Command history'));

  const { vehicleId } = useSelectedVehicle();
  const activeVehicleId = vehicleId != null ? String(vehicleId) : undefined;
  const noVehicle = !activeVehicleId;

  const { preferences } = useProductPreferences();
  const timeZone = useTimezone('vehicle');
  const { startInstant, endInstantExclusive } = useRangeState({
    defaultPresetId: preferences.defaultAnalysisRange,
    timezone: timeZone,
  });
  // Data — keep the full query so PageContainer can drive a freshness chip and
  // each panel can react to loading/error independently.
  const commandsQuery = useCommandReliabilityHistory(activeVehicleId, startInstant, endInstantExclusive);
  const { data: commands, isLoading, refetch } = commandsQuery;
  const state = useDataState(commandsQuery, { provenance: 'historical' });
  const error = state.fatalError;
  const allCommands = commands ?? [];

  // Filters
  const [statusFilter] = useUrlEnum<StatusFilter>('status', STATUS_FILTERS, 'all');
  const [searchQuery] = useUrlString('q', '');
  const [page, setPage] = useUrlNumber('page', 1);

  // useUrlBatch — atomically write multiple URL params in one navigation.
  // Using two single-key setters in the same handler races: the second
  // setSearchParams call sees the same `prev` snapshot and discards the
  // first write (see useUrlState.ts:60-67). That's why clicking Success/
  // Failed previously did nothing — `setPage(1)` clobbered the status change.
  const setUrl = useUrlBatch();

  // Defer the search query so the input stays responsive while the timeline +
  // stats + pagination chain re-renders at non-urgent priority.
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const isSearchPending = !Object.is(searchQuery, deferredSearchQuery);

  // Reset page when filters change — write both keys atomically.
  const handleStatusChange = (key: string) => {
    setUrl({ status: key === 'all' ? null : (key as StatusFilter), page: null });
  };
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Setting the search text AND resetting pagination are two URL writes.
    // Firing two single-key setters in the same synchronous handler races
    // under react-router v6 — both callbacks read the same `prev` snapshot,
    // so the second navigate(replace) discards the first (see useUrlState.ts).
    // That previously dropped the typed character whenever the user searched
    // while on page ≥ 2 (setPage(1) clobbered setSearchQuery). useUrlBatch
    // lands both keys in one navigation; useDeferredValue keeps typing smooth.
    const value = e.target.value;
    setUrl({ q: value || null, page: null });
  };
  // Timeline set — workspace range + status + search.
  const filtered = useMemo(() => {
    let result = allCommands;
    if (statusFilter !== 'all') {
      result = result.filter((c) => c.status === statusFilter);
    }
    if (deferredSearchQuery.trim()) {
      const q = deferredSearchQuery.toLowerCase();
      result = result.filter(
        (c) =>
          c.command.toLowerCase().includes(q) ||
          formatCommandName(c.command, t).toLowerCase().includes(q),
      );
    }
    return result;
  }, [allCommands, statusFilter, deferredSearchQuery, t]);

  // Clamp the URL-driven page into range before slicing. Guards two cases:
  //   1. A filter/range change shrinks `filtered` while the user is on a later
  //      page — without clamping, `slice` returns an empty window and the
  //      timeline renders blank even though data exists on an earlier page.
  //   2. A hand-edited `?page=` (0, negative, or beyond the last page) —
  //      `slice((0-1)*25, 0)` would silently surface the wrong rows.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), totalPages);

  const paginatedCommands = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage],
  );

  // KPI stats — computed from the full selected window, not the status/search view.
  const stats = useMemo(() => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const total = allCommands.length;
    const total24h = allCommands.filter(
      (c) => now - new Date(c.created_at).getTime() < dayMs,
    ).length;
    const successCount = allCommands.filter((c) => c.status === 'success').length;
    const failedCount = total - successCount;
    const successRate = total > 0 ? (successCount / total) * 100 : 0;

    const cmdCounts: Record<string, number> = {};
    for (const c of allCommands) {
      cmdCounts[c.command] = (cmdCounts[c.command] ?? 0) + 1;
    }
    const mostUsed =
      Object.keys(cmdCounts).length > 0
        ? Object.entries(cmdCounts).sort((a, b) => b[1] - a[1])[0][0]
        : null;

    const lastCommand = total > 0 ? allCommands[0] : null;

    return { total, total24h, successRate, failedCount, mostUsed, lastCommand };
  }, [allCommands]);

  // Daily activity — success/failed counts per calendar day within the range.
  const dailyActivity = useMemo(() => {
    if (allCommands.length === 0) return [];
    const buckets = new Map<
      string,
      { day: string; label: string; success: number; failed: number }
    >();
    for (const c of allCommands) {
      // Bucket by the vehicle's calendar day: UTC slicing misattributed
      // near-midnight commands for every non-UTC user.
      const day = localDayKey(c.created_at, timeZone);
      if (!day) continue;
      const bucket = buckets.get(day) ?? { day, label: day.slice(5), success: 0, failed: 0 };
      if (c.status === 'success') bucket.success += 1;
      else bucket.failed += 1;
      buckets.set(day, bucket);
    }
    return Array.from(buckets.values()).sort((a, b) => a.day.localeCompare(b.day));
  }, [allCommands, timeZone]);

  // Top commands — most-used commands in the range, for the breakdown rail.
  const topCommands = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of allCommands) {
      counts[c.command] = (counts[c.command] ?? 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([command, count], i) => ({
        command,
        count,
        color: CHART_COLORS[i % CHART_COLORS.length],
      }));
  }, [allCommands]);
  const topCommandsMax = topCommands.length > 0 ? topCommands[0].count : 0;

  // Status breakdown — success / failed / other tallies in the range.
  const statusBreakdown = useMemo(() => {
    const total = allCommands.length;
    const success = allCommands.filter((c) => c.status === 'success').length;
    const failed = allCommands.filter((c) => c.status === 'failed').length;
    const other = Math.max(0, total - success - failed);
    return { total, success, failed, other };
  }, [allCommands]);

  // Timeline data
  const timelineItems = useMemo(
    () =>
      paginatedCommands.map((cmd) => ({
        icon:
          cmd.status === 'success' ? (
            <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
          ),
        title: formatCommandName(cmd.command, t),
        subtitle: buildSubtitle(cmd, t),
        time: formatRelative(cmd.created_at, { tz: 'UTC' }),
        color: cmd.status === 'success' ? SUCCESS_COLOR : FAILED_COLOR,
      })),
    [paginatedCommands, t],
  );

  const statusTabs = [
    { key: 'all', label: t('commandHistory.filterAll', 'All'), icon: <Terminal className="h-3.5 w-3.5" aria-hidden="true" /> },
    { key: 'success', label: t('commandHistory.filterSuccess', 'Success'), icon: <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" /> },
    { key: 'failed', label: t('commandHistory.filterFailed', 'Failed'), icon: <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> },
  ];

  const analyticsEmptyMsg = noVehicle
    ? t('commandHistory.selectVehiclePrompt', 'Select a vehicle to view command activity')
    : t('commandHistory.noRangeData', 'No commands in the selected range');

  const timelineEmptyMsg =
    searchQuery || statusFilter !== 'all'
      ? t('commandHistory.noFilterResults', 'No commands match the current filters')
      : noVehicle
        ? t('commandHistory.selectVehiclePrompt', 'Select a vehicle to view command history')
        : t('commandHistory.noCommands', 'No commands have been sent yet');
  const operationalMetrics = useOperationalMetrics(commandHistoryMetrics(
    !noVehicle && commands != null ? stats : null,
    t, (command) => formatCommandName(command, t), precision,
  ));

  return (
    <PageLayout
      title={t('commandHistory.title', 'Command history')}
      subtitle={t('commandHistory.subtitle', 'Audit log of all vehicle commands')}
      query={commandsQuery}
      secondaryActions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <Link
            to="/commands"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          >
            <Gamepad2 className="h-3.5 w-3.5" aria-hidden="true" />
            {t('commandHistory.backToCommands', 'Commands')}
          </Link>
        </div>
      }
    >
      <StaleRefreshWarning state={state} />
      {/* ── Section 1: KPI band ──────────────────────────────────────────── */}
      <FadeIn>
        <section
          aria-label={t('commandHistory.kpis', 'Command metrics')}
        >
          {error ? (
            <QueryError
              error={error}
              onRetry={() => refetch()}
            />
          ) : (
            <OperationalBrief
              compact
              testId="command-history-summary"
              eyebrow={t('commandHistory.kpis', 'Command metrics')}
              title={t('commandHistory.brief.title', 'Command history summary')}
              description={t('commandHistory.summary.scope', 'Selected vehicle history; status and search filters apply only to the timeline.')}
              metrics={operationalMetrics}
              loading={isLoading}
              scope={`${formatDateTime(startInstant, { tz: timeZone })} → ${formatDateTime(endInstantExclusive, { tz: timeZone })}`}
              provenance={t('commandHistory.summary.scope', 'Selected vehicle history; status and search filters apply only to the timeline.')}
              statusLabel={noVehicle
                ? t('commandHistory.selectVehiclePrompt', 'Select a vehicle to view command history')
                : isLoading ? t('commandHistory.brief.loading', 'Loading command history')
                  : state.status === 'stale' ? t('dataState.stale.title', 'Data may be stale')
                    : commands == null ? t('commandHistory.brief.unavailable', 'Command history unavailable')
                      : commands.length === 0 ? t('commandHistory.brief.empty', 'No commands recorded')
                        : t('commandHistory.brief.recorded', 'Recorded command history')}
              statusTone={state.status === 'stale' ? 'warning' : 'neutral'}
              freshness={state.updatedAt != null
                ? formatDateTime(new Date(state.updatedAt).toISOString()) : undefined}
            />
          )}
        </section>
      </FadeIn>

      {/* ── Section 2: Filter bar ────────────────────────────────────────── */}
      <FadeIn delay={0.05}>
        <GlassPanel className="p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <TabNav tabs={statusTabs} active={statusFilter} onChange={handleStatusChange} />

            <div className="relative w-full sm:w-64">
              <ControlInput
                type="text"
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder={t('commandHistory.searchPlaceholder', 'Search commands…')}
                aria-label={t('commandHistory.searchCommands', 'Search commands')}
                icon={<Search className="h-3.5 w-3.5" aria-hidden="true" />}
                size="sm"
                className="pr-9"
              />
              {isSearchPending && (
                <span
                  role="status"
                  aria-live="polite"
                  aria-label={t('filter.pending', 'Filtering…')}
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-cyan-400/40 border-t-cyan-400"
                />
              )}
            </div>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* ── Section 3: Insights bento ────────────────────────────────────── */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {/* Daily activity — hero, spans two columns on wide screens. */}
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('commandHistory.dailyActivity', 'Daily activity')}
            </PanelTitle>
            <EmbeddedChart
              chartKey="system-command-daily-activity"
              title={t('commandHistory.dailyActivity', 'Daily activity')}
              ariaLabel={t('commandHistory.dailyActivityAria', 'Stacked bar chart of daily command success and failure counts')}
              loading={isLoading}
              error={error ?? undefined}
              onRetry={() => refetch()}
              empty={!isLoading && !error && dailyActivity.length === 0}
              emptyMessage={analyticsEmptyMsg}
              data={dailyActivity}
              dataColumns={[
                { key: 'label', label: t('commandHistory.col.day', 'Day') },
                { key: 'success', label: t('commandHistory.success', 'Success') },
                { key: 'failed', label: t('commandHistory.failedLabel', 'Failed') },
              ]}
            >
              {({ hiddenSeries }) => (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyActivity}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="label" tick={axisTickSm} />
                    <YAxis tick={axisTickSm} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <ChartLegend />
                    <Bar dataKey="success" name={t('commandHistory.success', 'Success')} stackId="a" fill={SUCCESS_COLOR} fillOpacity={0.85} hide={hiddenSeries?.isHidden('success') ?? false} />
                    <Bar dataKey="failed" name={t('commandHistory.failedLabel', 'Failed')} stackId="a" fill={FAILED_COLOR} fillOpacity={0.85} radius={[4, 4, 0, 0]} hide={hiddenSeries?.isHidden('failed') ?? false} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </EmbeddedChart>
          </GlassPanel>

          {/* Top commands — most-used commands in the range. */}
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('commandHistory.topCommands', 'Top commands')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={240} />
            ) : error ? (
              <QueryError error={error} onRetry={() => refetch()} />
            ) : topCommands.length === 0 ? (
              <EmptyState /* no-action: transient — no commands to rank in the selected window */
                icon={<ListChecks className="h-8 w-8" />}
                message={analyticsEmptyMsg}
              />
            ) : (
              <div className="space-y-3">
                {topCommands.map((c) => (
                  <MetricBar
                    key={c.command}
                    label={formatCommandName(c.command, t)}
                    value={c.count}
                    max={topCommandsMax || c.count}
                    color={c.color}
                    sublabel={String(c.count)}
                  />
                ))}
              </div>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* ── Section 4: Timeline + status breakdown ───────────────────────── */}
      <FadeIn delay={0.15}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {/* Command timeline — hero detail band, spans two columns. */}
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <div className="mb-4 flex items-center gap-2">
              <History className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
              <PanelTitle>{t('commandHistory.timelineTitle', 'Command timeline')}</PanelTitle>
              <Badge variant="neutral" size="sm" className="ml-auto">
                {t('commandHistory.showing', '{{count}} commands', { count: filtered.length })}
              </Badge>
            </div>
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton height={56} />
                <Skeleton height={56} />
                <Skeleton height={56} />
                <Skeleton height={56} />
              </div>
            ) : error ? (
              <QueryError error={error} onRetry={() => refetch()} />
            ) : filtered.length === 0 ? (
              <EmptyState /* no-action: transient — no matching command executions */
                icon={<History className="h-5 w-5" />}
                message={timelineEmptyMsg}
              />
            ) : (
              <>
                <Timeline
                  items={timelineItems}
                  chronology="newest-first"
                  label={t('commandHistory.timelineTitle', 'Command timeline')}
                />
                {filtered.length > PAGE_SIZE && (
                  <Pagination
                    page={currentPage}
                    pageSize={PAGE_SIZE}
                    total={filtered.length}
                    onPageChange={setPage}
                  />
                )}
              </>
            )}
          </GlassPanel>

          {/* Status breakdown — success / failed / other in the range. */}
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('commandHistory.statusBreakdown', 'Status breakdown')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={200} />
            ) : error ? (
              <QueryError error={error} onRetry={() => refetch()} />
            ) : statusBreakdown.total === 0 ? (
              <EmptyState /* no-action: transient — no command outcomes in the selected window */
                icon={<ShieldCheck className="h-8 w-8" />}
                message={analyticsEmptyMsg}
              />
            ) : (
              <div className="space-y-4">
                <MetricBar
                  label={t('commandHistory.success', 'Success')}
                  value={statusBreakdown.success}
                  max={statusBreakdown.total}
                  color={SUCCESS_COLOR}
                  sublabel={`${statusBreakdown.success} · ${pctLabel(statusBreakdown.success, statusBreakdown.total)}`}
                />
                <MetricBar
                  label={t('commandHistory.failedLabel', 'Failed')}
                  value={statusBreakdown.failed}
                  max={statusBreakdown.total}
                  color={FAILED_COLOR}
                  sublabel={`${statusBreakdown.failed} · ${pctLabel(statusBreakdown.failed, statusBreakdown.total)}`}
                />
                {statusBreakdown.other > 0 && (
                  <MetricBar
                    label={t('commandHistory.other', 'Other')}
                    value={statusBreakdown.other}
                    max={statusBreakdown.total}
                    color={OTHER_COLOR}
                    sublabel={`${statusBreakdown.other} · ${pctLabel(statusBreakdown.other, statusBreakdown.total)}`}
                  />
                )}
                <div className="flex items-center justify-between border-t border-white/[0.06] pt-3">
                  <Caption>{t('commandHistory.totalInRange', 'Total in range')}</Caption>
                  <Text size="sm" weight="semibold" color="primary" className="tabular-nums">
                    {statusBreakdown.total}
                  </Text>
                </div>
              </div>
            )}
          </GlassPanel>
        </section>
      </FadeIn>
    </PageLayout>
  );
}

// ─── Subtitle builder ────────────────────────────────────────────────────────

function buildSubtitle(cmd: CommandLogEntry, t: TranslateFn): string {
  const parts: string[] = [];

  if (cmd.params && cmd.params !== '{}' && cmd.params !== '') {
    try {
      const parsed = JSON.parse(cmd.params);
      const entries = Object.entries(parsed);
      if (entries.length > 0) {
        parts.push(
          entries
            .map(([k, v]) => `${k}: ${v}`)
            .join(', '),
        );
      }
    } catch {
      parts.push(cmd.params);
    }
  }

  if (cmd.error) {
    parts.push(t('commandHistory.errorPrefix', 'Error: {{msg}}', { msg: cmd.error }));
  }

  if (parts.length === 0) {
    parts.push(formatDateTime(cmd.created_at, { tz: 'UTC' }));
  }

  return parts.join(' · ');
}
