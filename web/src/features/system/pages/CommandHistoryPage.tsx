/**
 * CommandHistoryPage — audit log of all vehicle commands with filters and timeline.
 *
 * Shows stats (total, success rate, most-used, last sent), a filter bar
 * (vehicle selector, status toggle, command search), and a paginated
 * timeline of command executions.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { PageContainer, Grid } from '@/components/layout';
import {
  GlassPanel, Input as ControlInput, Select as ControlSelect, TabNav, Pagination,
} from '@/components/ui';
import { StatCard, Timeline } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { FadeIn, StaggerContainer } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useUrlEnum, useUrlNumber, useUrlString } from '@/hooks/useUrlState';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useCommandHistory, type CommandLogEntry } from '@/api/hooks/useCommands';
import { formatDateTime, formatRelative } from '@/lib/dateFormat';
import {
  History, CheckCircle, XCircle, Terminal, Clock, TrendingUp,
  Award, Search, Gamepad2,
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

function formatCommandName(cmd: string): string {
  return (
    COMMAND_LABELS[cmd] ??
    cmd
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

const PAGE_SIZE = 25;

const STATUS_FILTERS = ['all', 'success', 'failed'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

// ─── Page ────────────────────────────────────────────────────────────────────

export default function CommandHistoryPage() {
  const { t } = useTranslation();
  usePageTitle(t('commandHistory.title', 'Command History'));

  // Vehicle selection
  const { data: vehicles } = useVehicles();
  const vehicleList = vehicles ?? [];
  const [selectedVehicleId, setSelectedVehicleId] = useUrlString('vehicle_id', '');
  const activeVehicleId =
    selectedVehicleId || (vehicleList.length > 0 ? String(vehicleList[0].id) : undefined);

  // Data
  const { data: commands, isLoading, error } = useCommandHistory(activeVehicleId);
  const allCommands = commands ?? [];

  // Filters
  const [statusFilter, setStatusFilter] = useUrlEnum<StatusFilter>('status', STATUS_FILTERS, 'all');
  const [searchQuery, setSearchQuery] = useUrlString('q', '');
  const [page, setPage] = useUrlNumber('page', 1);

  // Reset page when filters change
  const handleStatusChange = (key: string) => {
    setStatusFilter(key as StatusFilter);
    setPage(1);
  };
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setPage(1);
  };
  const handleVehicleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedVehicleId(e.target.value);
    setPage(1);
  };

  // Filtered commands
  const filtered = useMemo(() => {
    let result = allCommands;
    if (statusFilter !== 'all') {
      result = result.filter((c) => c.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (c) =>
          c.command.toLowerCase().includes(q) ||
          formatCommandName(c.command).toLowerCase().includes(q),
      );
    }
    return result;
  }, [allCommands, statusFilter, searchQuery]);

  // Pagination
  const paginatedCommands = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );

  // Stats (from full history, not filtered)
  const stats = useMemo(() => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const last24h = allCommands.filter(
      (c) => now - new Date(c.created_at).getTime() < dayMs,
    );
    const successCount = allCommands.filter((c) => c.status === 'success').length;
    const successRate =
      allCommands.length > 0
        ? Math.round((successCount / allCommands.length) * 100)
        : 0;

    // Most used command
    const cmdCounts: Record<string, number> = {};
    for (const c of allCommands) {
      cmdCounts[c.command] = (cmdCounts[c.command] ?? 0) + 1;
    }
    const mostUsed =
      Object.keys(cmdCounts).length > 0
        ? Object.entries(cmdCounts).sort((a, b) => b[1] - a[1])[0][0]
        : null;

    const lastCommand = allCommands.length > 0 ? allCommands[0] : null;

    return {
      total24h: last24h.length,
      successRate,
      mostUsed,
      lastCommand,
    };
  }, [allCommands]);

  // Timeline data
  const timelineItems = useMemo(
    () =>
      paginatedCommands.map((cmd) => ({
        icon:
          cmd.status === 'success' ? (
            <CheckCircle className="h-3.5 w-3.5" />
          ) : (
            <XCircle className="h-3.5 w-3.5" />
          ),
        title: formatCommandName(cmd.command),
        subtitle: buildSubtitle(cmd),
        time: formatRelative(cmd.created_at, { tz: 'UTC' }),
        color: cmd.status === 'success' ? '#22c55e' : '#ef4444',
      })),
    [paginatedCommands],
  );

  const statusTabs = [
    { key: 'all', label: t('commandHistory.filterAll', 'All'), icon: <Terminal className="h-3.5 w-3.5" /> },
    { key: 'success', label: t('commandHistory.filterSuccess', 'Success'), icon: <CheckCircle className="h-3.5 w-3.5" /> },
    { key: 'failed', label: t('commandHistory.filterFailed', 'Failed'), icon: <XCircle className="h-3.5 w-3.5" /> },
  ];

  return (
    <PageContainer
      title={t('commandHistory.title', 'Command History')}
      subtitle={t('commandHistory.subtitle', 'Audit log of all vehicle commands')}
      loading={isLoading}
      error={error ?? undefined}
      actions={
        <Link
          to="/commands"
          className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <Gamepad2 className="h-3.5 w-3.5" />
          {t('commandHistory.backToCommands', 'Commands')}
        </Link>
      }
    >
      {/* ── Section 1: Stats ────────────────────────────────────────────── */}
      <FadeIn>
        <Grid cols={{ default: 2, md: 4 }} gap={3}>
          <StatCard
            label={t('commandHistory.total24h', 'Commands (24h)')}
            value={stats.total24h}
            icon={<Terminal className="h-4 w-4" />}
          />
          <StatCard
            label={t('commandHistory.successRate', 'Success Rate')}
            value={`${stats.successRate}%`}
            icon={<TrendingUp className="h-4 w-4" />}
          />
          <StatCard
            label={t('commandHistory.mostUsed', 'Most Used')}
            value={stats.mostUsed ? formatCommandName(stats.mostUsed) : '—'}
            icon={<Award className="h-4 w-4" />}
          />
          <StatCard
            label={t('commandHistory.lastSent', 'Last Sent')}
            value={
              stats.lastCommand
                ? formatRelative(stats.lastCommand.created_at, { tz: 'UTC' })
                : '—'
            }
            icon={<Clock className="h-4 w-4" />}
          />
        </Grid>
      </FadeIn>

      {/* ── Section 2: Filters ──────────────────────────────────────────── */}
      <FadeIn delay={0.05}>
        <GlassPanel className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              {/* Vehicle selector */}
              {vehicleList.length > 1 && (
                <ControlSelect
                  options={vehicleList.map((v) => ({
                    value: String(v.id),
                    label: v.display_name || `Vehicle ${v.id}`,
                  }))}
                  value={activeVehicleId ?? ''}
                  onChange={handleVehicleChange}
                  aria-label={t('commandHistory.selectVehicle', 'Select vehicle')}
                  className="min-w-[140px] rounded-lg border-0 bg-white/[0.04] px-3 py-1.5 text-xs text-[var(--text-secondary)] ring-1 ring-white/[0.08] dark:bg-white/[0.04]"
                />
              )}

              {/* Status filter */}
              <TabNav tabs={statusTabs} active={statusFilter} onChange={handleStatusChange} />
            </div>

            {/* Search */}
            <div className="sm:w-56">
              <ControlInput
                type="text"
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder={t('commandHistory.searchPlaceholder', 'Search commands…')}
                aria-label={t('commandHistory.searchCommands', 'Search commands')}
                icon={<Search className="h-3.5 w-3.5 text-[var(--text-muted)]" />}
                className="h-auto w-full rounded-lg border-0 bg-white/[0.04] py-1.5 pl-8 pr-3 text-xs text-[var(--text-secondary)] ring-1 ring-white/[0.08] placeholder:text-[var(--text-muted)] dark:bg-white/[0.04]"
              />
            </div>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* ── Section 3: Command Timeline ─────────────────────────────────── */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <History className="h-4 w-4 text-[var(--text-secondary)]" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              {t('commandHistory.timelineTitle', 'Command Timeline')}
            </h2>
            <span className="ml-auto text-xs text-[var(--text-muted)]">
              {t('commandHistory.showing', '{{count}} commands', {
                count: filtered.length,
              })}
            </span>
          </div>

          {filtered.length > 0 ? (
            <StaggerContainer>
              <Timeline items={timelineItems} />
            </StaggerContainer>
          ) : (
            <EmptyState
              icon={<History className="h-5 w-5" />}
              message={
                searchQuery || statusFilter !== 'all'
                  ? t('commandHistory.noFilterResults', 'No commands match the current filters')
                  : t('commandHistory.noCommands', 'No commands have been sent yet')
              }
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Section 4: Pagination ───────────────────────────────────────── */}
      {filtered.length > PAGE_SIZE && (
        <FadeIn delay={0.15}>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={filtered.length}
            onPageChange={setPage}
          />
        </FadeIn>
      )}
    </PageContainer>
  );
}

// ─── Subtitle builder ────────────────────────────────────────────────────────

function buildSubtitle(cmd: CommandLogEntry): string {
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
    parts.push(`Error: ${cmd.error}`);
  }

  if (parts.length === 0) {
    parts.push(formatDateTime(cmd.created_at, { tz: 'UTC' }));
  }

  return parts.join(' · ');
}
