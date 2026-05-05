import { useMemo, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Route, Clock, Gauge, Battery, ChevronRight, TrendingUp,
  Zap, ArrowUpDown, MapPin, Download, Activity, DollarSign, Trash2,
} from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Pagination } from '@/components/ui/Pagination';
import { SavedViewMenu } from '@/components/data-display/SavedViewMenu';
import { BulkActionsToolbar, type BulkAction } from '@/components/data-display';
import { DataFreshnessAuto } from '@/components/data-display';
import { TimeStamp } from '@/components/data-display';
import { useSavedViewUrl } from '@/hooks/useSavedViewUrl';
import {
  ChartContainer, ChartTooltip,
  AreaChart, Area, BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AREA_DEFAULTS, areaGradient,
} from '@/components/charts';
import { RadialGauge } from '@/components/charts/RadialGauge';
import { AnimatedNumber } from '@/components/data-display/AnimatedNumber';
import { InlineMetric } from '@/components/data-display/InlineMetric';
import { MetricBar } from '@/components/data-display/MetricBar';
import { Skeleton } from '@/components/feedback/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { DateRangeFilter } from '@/components/forms/DateRangeFilter';
import { SearchInput } from '@/components/forms/SearchInput';
import { FilterBar } from '@/components/forms/FilterBar';
import { ActiveFilterChips, type FilterChipDescriptor } from '@/components/forms/ActiveFilterChips';
import { useFilteredList } from '@/hooks/useFilteredList';
import { useUrlBatch, useUrlEnum, useUrlString, useUrlNumber } from '@/hooks/useUrlState';
import { FadeIn } from '@/components/motion/FadeIn';
import { StaggerContainer } from '@/components/motion/StaggerContainer';
import { StaggerItem } from '@/components/motion/StaggerItem';
import { useDrives, useDrivingStats, useBulkDeleteDrives } from '@/api/hooks/useDriving';
import { useSettings } from '@/hooks/useSettings';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { formatDateTime, formatDateShort, formatDurationMinutes } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import type { Drive } from '@/types/driving';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function getEfficiency(drive: Drive): number | null {
  const batteryUsed = (drive.startBatteryPct ?? 0) - (drive.endBatteryPct ?? 0);
  if (drive.distanceMi > 0 && batteryUsed > 0) return (batteryUsed * 0.75 * 1000) / drive.distanceMi;
  return null;
}

function getEfficiencyScore(eff: number | null): { label: string; color: string } {
  if (!eff) return { label: '—', color: '#6b7280' };
  if (eff < 130) return { label: 'A+', color: '#10b981' };
  if (eff < 160) return { label: 'A', color: '#10b981' };
  if (eff < 190) return { label: 'B', color: '#00f0ff' };
  if (eff < 220) return { label: 'C', color: '#f59e0b' };
  return { label: 'D', color: '#ef4444' };
}

/* ------------------------------------------------------------------ */
/*  DriveCard                                                         */
/* ------------------------------------------------------------------ */

interface DriveCardProps {
  drive: Drive;
  convertDistance: (v: number) => number;
  convertSpeed: (v: number) => number;
  convertEfficiency: (v: number) => number;
  distanceUnit: string;
  speedUnit: string;
  efficiencyUnit: string;
  formatEnergyCost?: (kwh: number) => string;
  selected?: boolean;
  onToggleSelect?: (id: number, on: boolean) => void;
}

function DriveCard({
  drive, convertDistance, convertSpeed, convertEfficiency,
  distanceUnit, speedUnit, efficiencyUnit, formatEnergyCost,
  selected, onToggleSelect,
}: DriveCardProps) {
  const { t } = useTranslation();
  const actualDistance = drive.distanceMi;
  const isCompleted = drive.endTs != null;
  const hasData = actualDistance > 0 || drive.durationMin > 0;
  const avgSpeed =
    drive.avgSpeedMph != null
      ? fmtInt(convertSpeed(drive.avgSpeedMph))
      : drive.durationMin > 0 && actualDistance > 0
        ? fmtInt(convertSpeed(actualDistance / (drive.durationMin / 60)))
        : '—';
  const eff = getEfficiency(drive);
  const effConverted = eff ? convertEfficiency(eff) : null;
  const score = getEfficiencyScore(eff);
  const hasBattery =
    drive.startBatteryPct !== null &&
    drive.endBatteryPct !== null &&
    !(drive.startBatteryPct === 0 && drive.endBatteryPct === 0 && isCompleted);

  const showCheckbox = typeof onToggleSelect === 'function';

  return (
    <div className="flex items-stretch gap-2">
      {showCheckbox && (
        <label className="flex items-center pl-2">
          <input
            type="checkbox"
            className="h-4 w-4 cursor-pointer rounded border-[var(--border-strong)] bg-white/[0.04] text-cyan-500 focus:ring-2 focus:ring-cyan-500"
            checked={!!selected}
            onChange={e => onToggleSelect?.(drive.id, e.target.checked)}
            aria-label={t('drives.selectDrive', 'Select drive on {{date}}', { date: formatDateTime(drive.startTs) })}
          />
        </label>
      )}
      <Link to={`/drives/${drive.id}`} className="flex-1 min-w-0">
      <GlassPanel hover glow="cyan" className="p-4 transition-all duration-normal group cursor-pointer">
        <div className="flex items-center gap-4">
          {/* Efficiency score badge */}
          <div className="flex flex-col items-center shrink-0 w-12">
            <span className="text-lg font-bold" style={{ color: score.color }}>{score.label}</span>
            <span className="text-[9px] text-[var(--text-muted)] uppercase">{t('drives.score', 'score')}</span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <TimeStamp value={drive.startTs} className="text-sm font-semibold text-[var(--text-primary)]" />
              {hasData ? (
                <Badge variant="info" size="sm">
                  {fmtNumber(convertDistance(actualDistance))} {distanceUnit}
                </Badge>
              ) : isCompleted ? (
                <Badge variant="warning" size="sm">{t('drives.noTelemetry', 'No telemetry')}</Badge>
              ) : (
                <Badge variant="success" size="sm">{t('drives.inProgress', 'In progress')}</Badge>
              )}
              {drive.maxSpeedMph !== null && drive.maxSpeedMph > 130 && (
                <Badge variant="danger" size="sm">{t('drives.highSpeed', 'High speed')}</Badge>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
              <InlineMetric icon={<Clock />} value={formatDurationMinutes(drive.durationMin)} />
              <InlineMetric icon={<Gauge />} value={`${t('drives.avg', 'Avg')} ${avgSpeed} ${speedUnit}`} />
              {drive.maxSpeedMph !== null && (
                <InlineMetric
                  icon={<TrendingUp />}
                  value={`${t('drives.max', 'Max')} ${fmtInt(convertSpeed(drive.maxSpeedMph))} ${speedUnit}`}
                />
              )}
              {hasBattery && (
                <span className="flex items-center gap-1">
                  <Battery className="h-3 w-3" />
                  <span className="text-green-400">{drive.startBatteryPct}%</span>
                  {' → '}
                  <span className={cn(drive.endBatteryPct! < 20 ? 'text-red-400' : 'text-amber-400')}>
                    {drive.endBatteryPct}%
                  </span>
                </span>
              )}
              {effConverted && (
                <span className="flex items-center gap-1" style={{ color: score.color }}>
                  <Zap className="h-3 w-3" /> {fmtInt(effConverted)} {efficiencyUnit}
                </span>
              )}
              {formatEnergyCost && hasBattery && drive.startBatteryPct != null && drive.endBatteryPct != null && drive.startBatteryPct > drive.endBatteryPct && (
                <span className="flex items-center gap-1 text-emerald-400/70">
                  <DollarSign className="h-3 w-3" />
                  ~{formatEnergyCost((drive.startBatteryPct - drive.endBatteryPct) * 0.75)}
                </span>
              )}
            </div>

            {(drive.startAddress || drive.endAddress) && (
              <div className="mt-1 text-[10px] text-[var(--text-secondary)] flex items-center gap-1 truncate">
                <MapPin className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{drive.startAddress || '?'} → {drive.endAddress || '?'}</span>
              </div>
            )}
          </div>

          <ChevronRight className="h-4 w-4 text-gray-700 group-hover:text-cyan-400 transition-colors" />
        </div>
      </GlassPanel>
    </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  DrivesListPage                                                    */
/* ------------------------------------------------------------------ */

export default function DrivesListPage() {
  const { t } = useTranslation();
  usePageTitle(t('drives.title', 'Drive History'));
  const savedView = useSavedViewUrl();

  /* Data hooks — Phase 40 / Prompt 16: header VehiclePicker is the source of truth */
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const drivesQuery = useDrives(vehicleIdStr);
  const { data: drives, isLoading: isDrivesLoading, error: drivesError } = drivesQuery;
  const { data: stats } = useDrivingStats(vehicleIdStr);

  /* Unit conversion */
  const {
    convertDistance, convertSpeed, convertEfficiency,
    distanceUnit, speedUnit, efficiencyUnit,
    formatEnergyCost,
  } = useSettings();

  /* Local UI state — Phase 40 / Prompt 33: filters/sort live in the URL so
     a date-range + sort view can be shared, bookmarked, or restored on reload. */
  const [sortBy, setSortBy] = useUrlEnum<'date' | 'distance' | 'efficiency'>(
    'sort',
    ['date', 'distance', 'efficiency'] as const,
    'date',
  );
  const [page, setPage] = useUrlNumber('page', 1);
  const [pageSize, setPageSize] = useUrlNumber('size', 50);
  const [search, setSearch] = useUrlString('q', '');
  const defaultStart = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 365);
    return d.toISOString().split('T')[0];
  }, []);
  const defaultEnd = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [startDate, setStartDate] = useUrlString('from', defaultStart);
  const [endDate, setEndDate] = useUrlString('to', defaultEnd);
  const setRangeBatch = useUrlBatch();

  /* ---- Client-side date filter ---- */
  const dateFilteredDrives = useMemo(() => {
    if (!drives) return [];
    return drives.filter((d) => {
      const driveDate = d.startTs?.split('T')[0];
      if (!driveDate) return true;
      if (startDate && driveDate < startDate) return false;
      if (endDate && driveDate > endDate) return false;
      return true;
    });
  }, [drives, startDate, endDate]);

  /* ---- Search filter (start/end address) ---- */
  const driveSearchFields = useMemo(
    () => ['startAddress', 'endAddress'] as const satisfies ReadonlyArray<keyof Drive>,
    [],
  );
  const filteredDrives = useFilteredList(dateFilteredDrives, search, driveSearchFields);

  /* ---- Sort ---- */
  const sortedDrives = useMemo(() => {
    const sorted = [...filteredDrives];
    switch (sortBy) {
      case 'distance': return sorted.sort((a, b) => b.distanceMi - a.distanceMi);
      case 'efficiency': return sorted.sort((a, b) => (getEfficiency(a) ?? 999) - (getEfficiency(b) ?? 999));
      default: return sorted;
    }
  }, [filteredDrives, sortBy]);

  /* ---- Pagination ---- */
  const paginatedDrives = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedDrives.slice(start, start + pageSize);
  }, [sortedDrives, page, pageSize]);

  /* ---- Bulk selection (Phase-40 / Prompt 51) ---- */
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set());
  // Reset selection whenever the visible result set changes — we never want
  // to retain a "ghost" id from a previous filter combination.
  useEffect(() => {
    setBulkSelected(prev => {
      if (prev.size === 0) return prev;
      const visible = new Set(filteredDrives.map(d => d.id));
      const next = new Set<number>();
      prev.forEach(id => { if (visible.has(id)) next.add(id); });
      return next.size === prev.size ? prev : next;
    });
  }, [filteredDrives]);
  const toggleDriveSelected = useCallback((id: number, on: boolean) => {
    setBulkSelected(prev => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  }, []);
  const clearBulk = useCallback(() => setBulkSelected(new Set()), []);
  const bulkDeleteDrivesMut = useBulkDeleteDrives();
  const bulkDriveActions = useMemo<BulkAction[]>(() => [
    {
      id: 'delete',
      label: t('bulk.actions.delete', 'Delete'),
      icon: <Trash2 className="h-3.5 w-3.5" />,
      variant: 'danger',
      confirm: {
        title: t('bulk.deleteConfirmTitle', 'Delete {{count}} {{noun}}?', {
          count: bulkSelected.size,
          noun: bulkSelected.size === 1
            ? t('bulk.noun.drive_one', 'drive')
            : t('bulk.noun.drive_other', 'drives'),
        }),
        description: t('bulk.deleteConfirmDescription', 'This cannot be undone.'),
        confirmLabel: t('common.delete', 'Delete'),
      },
      onClick: async (ids) => {
        await bulkDeleteDrivesMut.mutateAsync(ids.map(Number));
        clearBulk();
      },
    },
  ], [t, bulkSelected.size, bulkDeleteDrivesMut, clearBulk]);

  /* ---- Computed metrics from filtered drives ---- */
  const computedStats = useMemo(() => {
    if (filteredDrives.length === 0) return null;
    const effs = filteredDrives.map((d) => getEfficiency(d)).filter((e): e is number => e !== null);
    const bestEff = effs.length > 0 ? Math.min(...effs) : 0;
    const longest = filteredDrives.reduce((best, d) => (d.distanceMi > best.distanceMi ? d : best), filteredDrives[0]);
    const totalDist = filteredDrives.reduce((s, d) => s + d.distanceMi, 0);
    const totalDur = filteredDrives.reduce((s, d) => s + d.durationMin, 0);
    return { bestEff, longest, totalDist, totalDur, count: filteredDrives.length };
  }, [filteredDrives]);

  /* ---- Distance distribution histogram ---- */
  const distDist = useMemo(() => {
    if (filteredDrives.length === 0) return [];
    const buckets = [
      { range: '0–5', min: 0, max: 5, count: 0 },
      { range: '5–15', min: 5, max: 15, count: 0 },
      { range: '15–30', min: 15, max: 30, count: 0 },
      { range: '30–60', min: 30, max: 60, count: 0 },
      { range: '60–100', min: 60, max: 100, count: 0 },
      { range: '100+', min: 100, max: Infinity, count: 0 },
    ];
    filteredDrives.forEach((d) => {
      const b = buckets.find((bk) => d.distanceMi >= bk.min && d.distanceMi < bk.max);
      if (b) b.count++;
    });
    return buckets.map((b) => ({ range: `${b.range} ${distanceUnit}`, count: b.count }));
  }, [filteredDrives, distanceUnit]);

  /* ---- Speed vs Efficiency scatter ---- */
  const scatterData = useMemo(() => {
    if (filteredDrives.length === 0) return [];
    return filteredDrives
      .filter((d) => d.maxSpeedMph && d.durationMin > 0)
      .map((d) => {
        const avgSpd = d.durationMin > 0 ? d.distanceMi / (d.durationMin / 60) : 0;
        const eff = getEfficiency(d);
        return eff ? { speed: Math.round(avgSpd), efficiency: Math.round(eff) } : null;
      })
      .filter(Boolean) as { speed: number; efficiency: number }[];
  }, [filteredDrives]);

  /* ---- Distance trend (last 20 drives) ---- */
  const distanceTrend = useMemo(() => {
    if (filteredDrives.length === 0) return [];
    return filteredDrives.slice(0, 20).reverse().map((d) => ({
      date: formatDateShort(d.startTs),
      distance: parseFloat(fmtNumber(d.distanceMi ?? 0, 1)),
    }));
  }, [filteredDrives]);

  // Defensive guard: when no vehicle is selected (fresh install or
  // revoked Tesla token), bail out before rendering the data
  // scaffolding. The global <OnboardingGate> normally redirects, but
  // this catches the brief window before the redirect takes effect.
  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('drives.title', 'Drive History')} />;
  }

  return (
    <PageContainer
      title={t('drives.title', 'Drive History')}
      subtitle={t('drives.subtitle', 'Trip scoring, efficiency analysis, distance patterns, and performance data')}
      error={drivesError as Error | null}
      copyLink
      actions={
        <div className="flex items-center gap-3">
          <DataFreshnessAuto query={drivesQuery} />
          <div data-tour="drives-saved-views">
            <SavedViewMenu
              route="/drives"
              currentQuery={savedView.currentQuery}
              onApply={savedView.apply}
            />
          </div>
        </div>
      }
    >
      {/* Date range + search filter */}
      <FadeIn>
        <FilterBar>
          <SearchInput
            value={search}
            onChange={(v) => { setSearch(v); setPage(1); }}
            placeholder={t('drives.searchPlaceholder', 'Search by start or end address…')}
            className="w-full sm:w-72"
            historyScope="drives"
          />
          <DateRangeFilter
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            onRangeChange={(r) => setRangeBatch({ from: r.start, to: r.end })}
            onApply={() => setPage(1)}
          />
        </FilterBar>
        <ActiveFilterChips
          className="mt-3"
          filters={
            ([
              search
                ? {
                    key: 'q',
                    label: t('drives.filterLabel.search', 'Search'),
                    value: search,
                    onRemove: () => { setSearch(''); setPage(1); },
                  } satisfies FilterChipDescriptor
                : null,
              startDate && startDate !== defaultStart
                ? {
                    key: 'from',
                    label: t('drives.filterLabel.from', 'From'),
                    value: startDate,
                    onRemove: () => { setStartDate(defaultStart); setPage(1); },
                  } satisfies FilterChipDescriptor
                : null,
              endDate && endDate !== defaultEnd
                ? {
                    key: 'to',
                    label: t('drives.filterLabel.to', 'To'),
                    value: endDate,
                    onRemove: () => { setEndDate(defaultEnd); setPage(1); },
                  } satisfies FilterChipDescriptor
                : null,
            ].filter(Boolean) as FilterChipDescriptor[]) as readonly FilterChipDescriptor[]
          }
          onClearAll={() => {
            setSearch('');
            setRangeBatch({ from: defaultStart, to: defaultEnd });
            setPage(1);
          }}
        />
      </FadeIn>

      {/* Hero gauges */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-6">
          {stats ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 sm:gap-6 items-center">
              <RadialGauge
                value={stats.totalDrives}
                max={Math.max(stats.totalDrives, 100)}
                label={t('drives.totalDrives', 'Total Drives')}
                color="#00f0ff"
              />
              <RadialGauge
                value={Math.round(convertDistance(stats.totalDistanceKm))}
                max={Math.max(convertDistance(stats.totalDistanceKm), 1000)}
                label={`${t('drives.total', 'Total')} ${distanceUnit}`}
                color="#10b981"
              />
              <RadialGauge
                value={Math.round(convertEfficiency(stats.avgEfficiencyWhKm))}
                max={300}
                label={`${t('drives.avg', 'Avg')} ${efficiencyUnit}`}
                color={stats.avgEfficiencyWhKm < 180 ? '#10b981' : '#f59e0b'}
              />
              {computedStats && (
                <RadialGauge
                  value={Math.round(convertEfficiency(computedStats.bestEff))}
                  max={300}
                  label={`${t('drives.best', 'Best')} ${efficiencyUnit}`}
                  color="#a855f7"
                />
              )}
              <div className="flex flex-col items-center text-center">
                <p className="text-2xl font-bold text-[var(--text-primary)]">
                  <AnimatedNumber value={Math.round(convertSpeed(stats.topSpeedKmh))} />
                </p>
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-1">
                  {t('drives.topSpeed', 'Top Speed')}
                </p>
                <p className="text-[10px] text-[var(--text-muted)]">{speedUnit}</p>
              </div>
            </div>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('drives.noStats', 'No driving statistics available yet')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* Quick metrics strip */}
      {computedStats && (
        <FadeIn>
          <GlassPanel className="p-3 sm:p-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
              <div>
                <MetricBar
                  label={t('drives.totalDriveTime', 'Total Drive Time')}
                  value={computedStats.totalDur}
                  max={Math.max(computedStats.totalDur, 600)}
                  color="#00f0ff"
                />
                <p className="text-[10px] text-[var(--text-muted)] mt-1">{formatDurationMinutes(computedStats.totalDur)}</p>
              </div>
              <div>
                <MetricBar
                  label={t('drives.avgTripDistance', 'Avg Trip Distance')}
                  value={computedStats.totalDist / computedStats.count}
                  max={100}
                  color="#10b981"
                />
                <p className="text-[10px] text-[var(--text-muted)] mt-1">
                  {fmtNumber(convertDistance(computedStats.totalDist / computedStats.count))} {distanceUnit}
                </p>
              </div>
              <div>
                <MetricBar
                  label={t('drives.longestDrive', 'Longest Drive')}
                  value={computedStats.longest.distanceMi}
                  max={Math.max(computedStats.longest.distanceMi, 200)}
                  color="#a855f7"
                />
                <p className="text-[10px] text-[var(--text-muted)] mt-1">
                  {fmtNumber(convertDistance(computedStats.longest.distanceMi))} {distanceUnit}
                </p>
              </div>
              <div>
                <MetricBar
                  label={t('drives.avgDuration', 'Avg Duration')}
                  value={computedStats.totalDur / computedStats.count}
                  max={120}
                  color="#f59e0b"
                />
                <p className="text-[10px] text-[var(--text-muted)] mt-1">
                  {formatDurationMinutes(computedStats.totalDur / computedStats.count)}
                </p>
              </div>
            </div>
          </GlassPanel>
        </FadeIn>
      )}

      {/* Charts row — area + bar */}
      {filteredDrives.length > 3 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <FadeIn>
            <ChartContainer title={t('drives.recentDrives', 'Recent Drives')} height={220}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={distanceTrend}>
                  {areaGradient('drivesDistGrad', '#00f0ff')}
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    {...AREA_DEFAULTS}
                    dataKey="distance"
                    name={`${t('drives.distance', 'Distance')} (${distanceUnit})`}
                    stroke="#00f0ff"
                    fill="url(#drivesDistGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartContainer>
          </FadeIn>

          <FadeIn>
            <ChartContainer title={t('drives.distanceDistribution', 'Trip Distance Distribution')} height={220}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={distDist}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis dataKey="range" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="count" name={t('drives.drives', 'Drives')} fill="#10b981" fillOpacity={0.6} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          </FadeIn>
        </div>
      )}

      {/* Speed vs Efficiency scatter */}
      {scatterData.length > 5 && (
        <FadeIn>
          <ChartContainer
            title={t('drives.speedVsEfficiency', 'Speed vs Efficiency')}
            subtitle={`${t('drives.lower', 'Lower')} ${efficiencyUnit} = ${t('drives.better', 'better')}`}
            height={240}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis
                  dataKey="speed"
                  name={t('drives.avgSpeed', 'Avg Speed')}
                  unit={` ${speedUnit}`}
                  tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                />
                <YAxis
                  dataKey="efficiency"
                  name={t('drives.efficiency', 'Efficiency')}
                  unit={` ${efficiencyUnit}`}
                  tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                />
                <Tooltip content={<ChartTooltip />} />
                <Scatter data={scatterData} fill="#f59e0b" fillOpacity={0.6} />
              </ScatterChart>
            </ResponsiveContainer>
          </ChartContainer>
        </FadeIn>
      )}

      {/* Sort controls + export */}
      <FadeIn>
        {sortedDrives.length > 0 ? (
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-3" data-tour="drives-list">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <Route className="h-4 w-4 text-cyan-400" />
              {t('drives.allDrives', 'All Drives')}
            </h3>
            <div className="flex items-center gap-2">
              <ArrowUpDown className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              {(['date', 'distance', 'efficiency'] as const).map((s) => (
                <Button
                  key={s}
                  variant="ghost"
                  size="sm"
                  onClick={() => setSortBy(s)}
                  className={cn(
                    sortBy === s
                      ? 'bg-cyan-500/10 text-cyan-400'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
                  )}
                >
                  {s === 'date'
                    ? t('drives.sortRecent', 'Recent')
                    : s === 'distance'
                      ? t('drives.sortDistance', 'Distance')
                      : t('drives.sortEfficiency', 'Efficiency')}
                </Button>
              ))}
              <span className="mx-1 h-4 w-px bg-[var(--surface-2)]" />
              <a
                href={`/api/v1/export/drives?format=csv${startDate ? `&start=${startDate}` : ''}${endDate ? `&end=${endDate}` : ''}${vehicleId ? `&vehicle_id=${vehicleId}` : ''}`}
                download="teslasync-drives.csv"
              >
                <Button variant="secondary" size="sm" icon={<Download className="h-3.5 w-3.5" />}>CSV</Button>
              </a>
              <a
                href={`/api/v1/export/drives?format=json${startDate ? `&start=${startDate}` : ''}${endDate ? `&end=${endDate}` : ''}${vehicleId ? `&vehicle_id=${vehicleId}` : ''}`}
                download="teslasync-drives.json"
              >
                <Button variant="secondary" size="sm" icon={<Download className="h-3.5 w-3.5" />}>JSON</Button>
              </a>
            </div>
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Activity className="h-8 w-8 opacity-20" />}
            message={t('common.noData', 'No data available')}
            className="py-8"
          />
        )}
      </FadeIn>

      {/* Drive list */}
      {isDrivesLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : paginatedDrives.length > 0 ? (
        <>
          <BulkActionsToolbar
            selectedIds={Array.from(bulkSelected)}
            total={filteredDrives.length}
            onClear={clearBulk}
            actions={bulkDriveActions}
            itemNoun={{
              one: t('bulk.noun.drive_one', 'drive'),
              other: t('bulk.noun.drive_other', 'drives'),
            }}
          />
          <StaggerContainer className="space-y-3">
            {paginatedDrives.map((d) => (
              <StaggerItem key={d.id}>
                <DriveCard
                  drive={d}
                  convertDistance={convertDistance}
                  convertSpeed={convertSpeed}
                  convertEfficiency={convertEfficiency}
                  distanceUnit={distanceUnit}
                  speedUnit={speedUnit}
                  efficiencyUnit={efficiencyUnit}
                  formatEnergyCost={formatEnergyCost}
                  selected={bulkSelected.has(d.id)}
                  onToggleSelect={toggleDriveSelected}
                />
              </StaggerItem>
            ))}
          </StaggerContainer>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={sortedDrives.length}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          />
        </>
      ) : (
        <EmptyState
          icon={<Route className="h-8 w-8" />}
          title={t('drives.emptyTitle', 'No drives recorded yet')}
          message={t('drives.emptyMessage', 'Drive data will appear here once your vehicle records trips.')}
          action={{
            label: t('drives.empty.cta', 'Reset filters'),
            onClick: () => {
              setSearch('');
              setStartDate(defaultStart);
              setEndDate(defaultEnd);
              setSortBy('date');
              setPage(1);
            },
          }}
        />
      )}
    </PageContainer>
  );
}
