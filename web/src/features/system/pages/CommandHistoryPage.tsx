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
 * Scoping model: the RangePicker in the header scopes the analytics (daily
 * chart, top commands, status breakdown). The filter bar (status + search)
 * additionally scopes the timeline list, its count, and pagination. The KPI
 * band reflects the full command history, not the filtered view.
 */

import { useDeferredValue, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { PageContainer } from '@/components/layout';
import {
  GlassPanel, Input as ControlInput, Select as ControlSelect,
  TabNav, Pagination, PanelTitle, Text, Caption, Badge,
} from '@/components/ui';
import { MetricCard, MetricBar, Timeline } from '@/components/data-display';
import { EmptyState, Skeleton, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { RangePicker } from '@/components/forms';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ChartTooltip, CHART_COLORS, axisTickSm,
} from '@/components/charts';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useUrlBatch, useUrlEnum, useUrlNumber, useUrlString } from '@/hooks/useUrlState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useCommandHistory, type CommandLogEntry } from '@/api/hooks/useCommands';
import { formatDateTime, formatRelative } from '@/lib/dateFormat';
import {
  History, CheckCircle, XCircle, Terminal, Clock, TrendingUp,
  Award, Search, Gamepad2, ListChecks, BarChart3, ShieldCheck,
} from 'lucide-react';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const COMMAND_LABELS: Record<string, string> = {
  lock: 'Lock',
  unlock: 'Unlock',
  wake_up: 'Wake Up',
  climate_on: 'Climate ON',
  climate_off: 'Climate OFF',
  honk_horn: 'Honk Horn',
  flash_lights: 'Flash Lights',
  charge_start: 'Start Charging',
  charge_stop: 'Stop Charging',
  set_charge_limit: 'Set Charge Limit',
  set_temps: 'Set Temperature',
  actuate_trunk: 'Open/Close Trunk',
  actuate_frunk: 'Open Frunk',
  window_control: 'Window Control',
  sun_roof_control: 'Sunroof Control',
  remote_start_drive: 'Remote Start',
  set_sentry_mode: 'Sentry Mode',
  set_speed_limit: 'Speed Limit',
  clear_speed_limit: 'Clear Speed Limit',
  set_valet_mode: 'Valet Mode',
  reset_valet_pin: 'Reset Valet PIN',
  schedule_software_update: 'Schedule Update',
  cancel_software_update: 'Cancel Update',
  media_toggle_playback: 'Media Play/Pause',
  media_next_track: 'Next Track',
  media_prev_track: 'Previous Track',
  media_volume_up: 'Volume Up',
  media_volume_down: 'Volume Down',
  adjust_volume: 'Adjust Volume',
  navigation_request: 'Navigate',
  share: 'Share to Vehicle',
  trigger_homelink: 'Trigger HomeLink',
  set_bioweapon_mode: 'Bioweapon Defense',
  set_climate_keeper: 'Climate Keeper',
  set_cop_temp: 'Cabin Overheat Protection',
  dog_mode_on: 'Dog Mode ON',
  dog_mode_off: 'Dog Mode OFF',
  camp_mode_on: 'Camp Mode ON',
  camp_mode_off: 'Camp Mode OFF',
  set_scheduled_departure: 'Scheduled Departure',
  set_scheduled_charging: 'Scheduled Charging',
  set_preconditioning_max: 'Max Preconditioning',
  auto_conditioning_start: 'Start Preconditioning',
  auto_conditioning_stop: 'Stop Preconditioning',
  remote_seat_heater_request: 'Seat Heater',
  remote_seat_cooler_request: 'Seat Cooler',
  remote_steering_wheel_heater_request: 'Steering Wheel Heater',
  close_charge_port: 'Close Charge Port',
  open_charge_port: 'Open Charge Port',
  set_pin_to_drive: 'PIN to Drive',
};

/** Component `t` function type — lets module-level helpers resolve i18n keys. */
type TranslateFn = ReturnType<typeof useTranslation>['t'];

/** Curated English fallback (finally a Title-Cased version of the raw command). */
function commandFallbackLabel(cmd: string): string {
  return (
    COMMAND_LABELS[cmd] ??
    cmd
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
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

const pctLabel = (n: number, total: number): string =>
  `${total > 0 ? Math.round((n / total) * 100) : 0}%`;

// ─── Page ────────────────────────────────────────────────────────────────────

export default function CommandHistoryPage() {
  const { t } = useTranslation();
  usePageTitle(t('commandHistory.title', 'Command History'));

  // Vehicle selection: useSelectedVehicle reads ?vehicle_id from the URL
  // (deep-links from notifications), persists across pages via localStorage,
  // and falls back to the first vehicle. We mirror picker changes back to
  // the URL so /command-history?vehicle_id=N stays bookmarkable.
  const { vehicleId, vehicles, setVehicleId } = useSelectedVehicle();
  const activeVehicleId = vehicleId != null ? String(vehicleId) : undefined;
  const noVehicle = !activeVehicleId;

  // Data — keep the full query so PageContainer can drive a freshness chip and
  // each panel can react to loading/error independently.
  const commandsQuery = useCommandHistory(activeVehicleId);
  const { data: commands, isLoading, error, refetch } = commandsQuery;
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

  const { start, end, setRange } = useRangeState({
    persistKey: 'command-history.range',
    defaultPresetId: 'all',
  });

  // Stable identity for the RangePicker's controlled value so it isn't handed
  // a fresh object literal on every render.
  const rangeValue = useMemo(() => ({ start, end }), [start, end]);

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
  const handleVehicleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const n = Number(e.target.value);
    if (Number.isFinite(n) && n > 0) {
      setVehicleId(n);
      setUrl({ vehicle_id: e.target.value, page: null });
    }
  };

  // Range-scoped set — drives the analytics panels (chart, top commands,
  // status breakdown). Kept separate from `filtered` so status/search only
  // narrow the timeline list, never the surrounding analytics.
  const rangeFiltered = useMemo(() => {
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return allCommands.filter((c) => {
      if (!c.created_at) return false;
      const ts = new Date(c.created_at).getTime();
      return ts >= startMs && ts <= endMs;
    });
  }, [allCommands, start, end]);

  // Timeline set — range + status + search.
  const filtered = useMemo(() => {
    let result = rangeFiltered;
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
  }, [rangeFiltered, statusFilter, deferredSearchQuery, t]);

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

  // KPI stats — computed from the full history, not the filtered view.
  const stats = useMemo(() => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const total = allCommands.length;
    const total24h = allCommands.filter(
      (c) => now - new Date(c.created_at).getTime() < dayMs,
    ).length;
    const successCount = allCommands.filter((c) => c.status === 'success').length;
    const failedCount = total - successCount;
    const successRate = total > 0 ? Math.round((successCount / total) * 100) : 0;

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
    if (rangeFiltered.length === 0) return [];
    const buckets = new Map<
      string,
      { day: string; label: string; success: number; failed: number }
    >();
    for (const c of rangeFiltered) {
      const d = new Date(c.created_at);
      if (Number.isNaN(d.getTime())) continue;
      const day = d.toISOString().slice(0, 10);
      const bucket = buckets.get(day) ?? { day, label: day.slice(5), success: 0, failed: 0 };
      if (c.status === 'success') bucket.success += 1;
      else bucket.failed += 1;
      buckets.set(day, bucket);
    }
    return Array.from(buckets.values()).sort((a, b) => a.day.localeCompare(b.day));
  }, [rangeFiltered]);

  // Top commands — most-used commands in the range, for the breakdown rail.
  const topCommands = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of rangeFiltered) {
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
  }, [rangeFiltered]);
  const topCommandsMax = topCommands.length > 0 ? topCommands[0].count : 0;

  // Status breakdown — success / failed / other tallies in the range.
  const statusBreakdown = useMemo(() => {
    const total = rangeFiltered.length;
    const success = rangeFiltered.filter((c) => c.status === 'success').length;
    const failed = rangeFiltered.filter((c) => c.status === 'failed').length;
    const other = Math.max(0, total - success - failed);
    return { total, success, failed, other };
  }, [rangeFiltered]);

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

  return (
    <PageContainer
      title={t('commandHistory.title', 'Command History')}
      subtitle={t('commandHistory.subtitle', 'Audit log of all vehicle commands')}
      query={commandsQuery}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          {vehicles.length > 0 && (
            <ControlSelect
              options={vehicles.map((v) => ({
                value: String(v.id),
                label: v.display_name || t('common.vehicleFallback', 'Vehicle {{id}}', { id: v.id }),
              }))}
              value={activeVehicleId ?? ''}
              onChange={handleVehicleChange}
              aria-label={t('commandHistory.selectVehicle', 'Select vehicle')}
            />
          )}
          <RangePicker
            value={rangeValue}
            onChange={(r) => setRange(r)}
            align="end"
            triggerTestId="command-history-range"
          />
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
      {/* ── Section 1: KPI band ──────────────────────────────────────────── */}
      <FadeIn>
        <section
          aria-label={t('commandHistory.kpis', 'Command metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 3xl:grid-cols-6"
        >
          <MetricCard
            label={t('commandHistory.total', 'Total Commands')}
            value={stats.total}
            icon={<Terminal className="h-4 w-4" />}
            color="cyan"
          />
          <MetricCard
            label={t('commandHistory.total24h', 'Commands (24h)')}
            value={stats.total24h}
            icon={<Clock className="h-4 w-4" />}
            color="blue"
          />
          <MetricCard
            label={t('commandHistory.successRate', 'Success Rate')}
            value={`${stats.successRate}%`}
            icon={<TrendingUp className="h-4 w-4" />}
            color="green"
          />
          <MetricCard
            label={t('commandHistory.failed', 'Failed')}
            value={stats.failedCount}
            icon={<XCircle className="h-4 w-4" />}
            color="red"
          />
          <MetricCard
            label={t('commandHistory.mostUsed', 'Most Used')}
            value={stats.mostUsed ? formatCommandName(stats.mostUsed, t) : '—'}
            icon={<Award className="h-4 w-4" />}
            color="purple"
          />
          <MetricCard
            label={t('commandHistory.lastSent', 'Last Sent')}
            value={
              stats.lastCommand
                ? formatRelative(stats.lastCommand.created_at, { tz: 'UTC' })
                : '—'
            }
            icon={<History className="h-4 w-4" />}
            color="amber"
          />
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
              {t('commandHistory.dailyActivity', 'Daily Activity')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={240} />
            ) : error ? (
              <QueryError error={error} onRetry={() => refetch()} />
            ) : dailyActivity.length === 0 ? (
              <EmptyState /* no-action: transient — no command activity in the selected window */
                icon={<BarChart3 className="h-8 w-8" />}
                message={analyticsEmptyMsg}
              />
            ) : (
              <div className="h-56 sm:h-64 xl:h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyActivity}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="label" tick={axisTickSm} />
                    <YAxis tick={axisTickSm} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="success" name={t('commandHistory.success', 'Success')} stackId="a" fill={SUCCESS_COLOR} fillOpacity={0.85} />
                    <Bar dataKey="failed" name={t('commandHistory.failedLabel', 'Failed')} stackId="a" fill={FAILED_COLOR} fillOpacity={0.85} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </GlassPanel>

          {/* Top commands — most-used commands in the range. */}
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('commandHistory.topCommands', 'Top Commands')}
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
              <PanelTitle>{t('commandHistory.timelineTitle', 'Command Timeline')}</PanelTitle>
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
                <Timeline items={timelineItems} />
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
              {t('commandHistory.statusBreakdown', 'Status Breakdown')}
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
    </PageContainer>
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
