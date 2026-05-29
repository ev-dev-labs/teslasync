import { useMemo, useState, useCallback, useEffect, useDeferredValue, memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Route, Gauge, TrendingUp,
  Zap, ArrowUpDown, ArrowDown, Download, Activity, DollarSign,
  Trash2, AlertTriangle, Star, Repeat, Tag, List as ListIcon,
} from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeaderSticky } from '@/components/layout/PageHeaderSticky';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Pagination } from '@/components/ui/Pagination';
import { SavedViewMenu } from '@/components/data-display/SavedViewMenu';
import {
  BulkActionsToolbar, type BulkAction, DataFreshnessAuto,
  KpiOverviewCard, MetricCard, DateGroupedList, type DateGroupedListGroup,
  HistoryListRow, ScoreBadge, BatteryDelta, RouteDisplay,
} from '@/components/data-display';
import { useSavedViewUrl } from '@/hooks/useSavedViewUrl';
import { MetricSwitcherChart, type MetricSwitcherMetric } from '@/components/charts';
import { InlineMetric } from '@/components/data-display/InlineMetric';
import { Skeleton } from '@/components/feedback/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { InlineCallout } from '@/components/feedback/InlineCallout';
import { RangePicker, VehicleSelect, PillFilterBar, type PillItem } from '@/components/forms';
import { SearchInput } from '@/components/forms/SearchInput';
import { FilterBar } from '@/components/forms/FilterBar';
import { ActiveFilterChips, type FilterChipDescriptor } from '@/components/forms/ActiveFilterChips';
import { useUrlBatch, useUrlEnum, useUrlString, useUrlNumber } from '@/hooks/useUrlState';
import { parseSearchQuery, matchesTokens, compareNumeric } from '@/lib/searchQuery';
import { FadeIn } from '@/components/motion/FadeIn';
import { StaggerContainer } from '@/components/motion/StaggerContainer';
import { StaggerItem } from '@/components/motion/StaggerItem';
import { useDrives, useBulkDeleteDrives } from '@/api/hooks/useDriving';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useTimezone } from '@/lib/timezone';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { PullToRefresh } from '@/components/mobile';
import { AINLDriveSearch } from '@/components/ai/AINLDriveSearch';
import { formatDateTime, formatRelativeDays, formatTime, formatDurationMinutes, formatDayKey } from '@/lib/dateFormat';
import { matchPresetId, getDatePreset } from '@/lib/datePresets';
import { fmtNumber, fmtInt, fmtCompact } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import type { Drive } from '@/types/driving';
import { convertDistanceFromSI, convertSpeedFromSI } from '@/lib/unitConversion';
import {
  getEfficiency, gradeFromEfficiency, gradeFromNumeric,
  computePeriodStats, priorPeriod, detectAnomalies, detectNotable, detectCommutes,
  groupByDate, dailyTrend, localDayKey,
  type TrendMetric, type PeriodStats,
} from '@/lib/drivesAggregation';

/* ------------------------------------------------------------------ */
/* DriveCard */
/* ------------------------------------------------------------------ */

interface DriveCardProps {
  drive: Drive;
  toDistanceDisplay: (v: number) => number;
  toSpeedDisplay: (v: number) => number;
  toEfficiencyDisplay: (v: number) => number;
  distanceUnit: string;
  speedUnit: string;
  efficiencyUnit: string;
  formatEnergyCost?: (kwh: number) => string;
  selected?: boolean;
  onToggleSelect?: (id: number, on: boolean) => void;
  /** IANA timezone for time-of-day rendering. Defaults to browser local. */
  tz?: string;
  /** When true, render an inline `⚠ Low efficiency` badge to mark this row
 * as the one called out in the page-level anomaly summary. */
  isAnomaly?: boolean;
}

function DriveCardImpl({
  drive, toDistanceDisplay, toSpeedDisplay, toEfficiencyDisplay,
  distanceUnit, speedUnit, efficiencyUnit, formatEnergyCost,
  selected, onToggleSelect, tz, isAnomaly,
}: DriveCardProps) {
  const { t } = useTranslation();
  const actualDistance = drive.distanceM;
  const isCompleted = drive.endTs != null;
  const hasData = actualDistance > 0 || drive.durationS > 0;
  const avgSpeed =
    drive.avgSpeedMps != null
      ? fmtInt(toSpeedDisplay(drive.avgSpeedMps))
      : drive.durationS > 0 && actualDistance > 0
        ? fmtInt(toSpeedDisplay(actualDistance / drive.durationS))
        : '—';
  const eff = getEfficiency(drive);
  const effConverted = eff ? toEfficiencyDisplay(eff) : null;
  const score = gradeFromEfficiency(eff);
  const hasBattery =
    drive.startBatteryPct !== null &&
    drive.endBatteryPct !== null &&
    !(drive.startBatteryPct === 0 && drive.endBatteryPct === 0 && isCompleted);

  const showCheckbox = typeof onToggleSelect === 'function';

  const checkbox = showCheckbox ? (
    <Checkbox
      checked={!!selected}
      onChange={(next) => onToggleSelect?.(drive.id, next)}
      aria-label={t('drives.selectDrive', 'Select drive on {{date}}', { date: formatDateTime(drive.startTs, { tz }) })}
    />
  ) : undefined;

  const primary = (
    <>
      {/* Time-of-day only — the date is shown in the date-group header above */}
      <span className="text-sm font-semibold text-[var(--text-primary)] tabular-nums">
        {formatTime(drive.startTs, { tz })}
      </span>
      <span className="text-[10px] text-[var(--text-muted)]">·</span>
      <span className="text-[11px] text-[var(--text-muted)] tabular-nums">
        {formatDurationMinutes((drive.durationS) / 60)}
      </span>
      {hasData ? (
        <Badge variant="info" size="sm">
          {fmtNumber(toDistanceDisplay(actualDistance))} {distanceUnit}
        </Badge>
      ) : isCompleted ? (
        <Badge variant="warning" size="sm">{t('drives.noTelemetry', 'No telemetry')}</Badge>
      ) : (
        <Badge variant="success" size="sm">{t('drives.inProgress', 'In progress')}</Badge>
      )}
      {drive.maxSpeedMps !== null && drive.maxSpeedMps > 58.1152 && (
        <Badge variant="danger" size="sm">{t('drives.highSpeed', 'High speed')}</Badge>
      )}
      {isAnomaly && (
        <Badge variant="danger" size="sm">
          <AlertTriangle className="h-3 w-3" aria-hidden />
          {t('drives.lowEfficiencyBadge', 'Low efficiency')}
        </Badge>
      )}
    </>
  );

  const route = (
    <RouteDisplay
      start={{ address: drive.startAddress, lat: drive.startLat, lon: drive.startLon }}
      end={{ address: drive.endAddress, lat: drive.endLat, lon: drive.endLon }}
    />
  );

  const metrics = (
    <>
      <InlineMetric icon={<Gauge />} value={`${t('drives.avg', 'Avg')} ${avgSpeed} ${speedUnit}`} />
      {drive.maxSpeedMps !== null && (
        <InlineMetric
          icon={<TrendingUp />}
          value={`${t('drives.max', 'Max')} ${fmtInt(toSpeedDisplay(drive.maxSpeedMps))} ${speedUnit}`}
        />
      )}
      {hasBattery && (
        <BatteryDelta
          startPct={drive.startBatteryPct}
          endPct={drive.endBatteryPct}
        />
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
    </>
  );

  return (
    <HistoryListRow
      checkbox={checkbox}
      leading={<ScoreBadge grade={score.label} ariaLabel={t('drives.scoreAria', 'Score {{grade}}', { grade: score.label })} />}
      primary={primary}
      route={route}
      metrics={metrics}
      href={`/drives/${drive.id}`}
      selected={selected}
    />
  );
}

/**
 * memo() with a custom equality so unchanged rows skip re-render when
 * the deferred filter value commits. `useSettings` returns fresh
 * function references on every parent render, so the default shallow
 * comparison would never short-circuit; here we only consider the
 * row-shaping inputs that actually affect the rendered output.
 *
 * .
 */
const DriveCard = memo(DriveCardImpl, (prev, next) =>
  prev.drive === next.drive &&
  prev.selected === next.selected &&
  prev.distanceUnit === next.distanceUnit &&
  prev.speedUnit === next.speedUnit &&
  prev.efficiencyUnit === next.efficiencyUnit &&
  prev.tz === next.tz &&
  prev.isAnomaly === next.isAnomaly &&
  prev.onToggleSelect === next.onToggleSelect, );

/* ------------------------------------------------------------------ */
/* DrivesListPage */
/* ------------------------------------------------------------------ */

const COLLECTIONS = ['all', 'anomalies', 'notable', 'commutes', 'tagged'] as const;
type Collection = typeof COLLECTIONS[number];
const TREND_METRICS = ['drives', 'distance', 'score', 'efficiency', 'cost'] as const;

export default function DrivesListPage() {
  const { t } = useTranslation();
  usePageTitle(t('drives.title', 'Drive History'));
  const savedView = useSavedViewUrl();

  /* Data hooks */
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const drivesQuery = useDrives(vehicleIdStr);
  const { data: drives, isLoading: isDrivesLoading, error: drivesError, refetch: refetchDrives } = drivesQuery;

  /* Active vehicle's IANA timezone — every "what day is this drive?"
 * decision on this page must use this rather than the browser's local
 * zone, otherwise late-night drives appear under the wrong day in the
 * grouped list, the chart shows ghost bars on the next UTC day, and
 * the period stats undercount/overcount drives near the boundary. */
  const tz = useTimezone('vehicle');

  /* Unit conversion */
  const { unitPrefs } = useUnits();
  const toDistanceDisplay = useCallback(
    (v: number) => convertDistanceFromSI(v, unitPrefs.distance),
    [unitPrefs.distance],
  );
  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const toSpeedDisplay = useCallback(
    (v: number) => convertSpeedFromSI(v, unitPrefs.speed),
    [unitPrefs.speed],
  );
  const toEfficiencyDisplay = useCallback(
    (whPerKm: number) => unitPrefs.distance === 'mi' ? whPerKm * 1.609344 : whPerKm,
    [unitPrefs.distance],
  );
  const { formatEnergyCost, costPerKwh, formatCurrency } = useFormatting();

  /* URL-persisted UI state */
  const [sortBy, setSortBy] = useUrlEnum<'date' | 'distance' | 'efficiency'>(
    'sort', ['date', 'distance', 'efficiency'] as const, 'date',
  );
  const [page, setPage] = useUrlNumber('page', 1);
  const [pageSize] = useUrlNumber('size', 50);
  const [search] = useUrlString('q', '');
  const defaultStart = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  }, []);
  const defaultEnd = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [startDate] = useUrlString('from', defaultStart);
  const [endDate] = useUrlString('to', defaultEnd);
  const [collection] = useUrlEnum<Collection>('coll', COLLECTIONS, 'all');
  const [trendMetric, setTrendMetric] = useUrlEnum<TrendMetric>('trend', TREND_METRICS, 'drives');
  const setUrlBatch = useUrlBatch();

  /* ---- Date filter — bucket each drive by its vehicle-tz day so the
 * filter result matches the date the user sees in the row's header. */
  const dateFilteredDrives = useMemo(() => {
    if (!drives) return [];
    return drives.filter((d) => {
      const day = localDayKey(d.startTs, tz);
      if (!day) return true;
      if (startDate && day < startDate) return false;
      if (endDate && day > endDate) return false;
      return true;
    });
  }, [drives, startDate, endDate, tz]);

  /* ---- Period stats (current + prior for delta comparison) ---- */
  const currentStats = useMemo<PeriodStats>(
    () => computePeriodStats(dateFilteredDrives, undefined, undefined, tz),
    [dateFilteredDrives, tz],
  );
  const priorRange = useMemo(() => priorPeriod(startDate, endDate), [startDate, endDate]);
  const priorStats = useMemo<PeriodStats | null>(
    () => priorRange && drives
      ? computePeriodStats(drives, priorRange.start, priorRange.end, tz)
      : null,
    [drives, priorRange, tz],
  );

  /* ---- Collection counts (computed BEFORE collection filter) ---- */
  const anomalyDrives = useMemo(
    () => detectAnomalies(dateFilteredDrives), [dateFilteredDrives],
  );
  /** Set of anomalous drive ids — used to render an inline `⚠ Low efficiency`
 * badge on the matching row so the page-level anomaly callout connects
 * to a specific drive instead of leaving the user to hunt for it. */
  const anomalyDriveIds = useMemo(
    () => new Set(anomalyDrives.map((d) => d.id)), [anomalyDrives],
  );
  const notableDrives = useMemo(
    () => detectNotable(dateFilteredDrives), [dateFilteredDrives],
  );
  const commuteDrives = useMemo(
    () => detectCommutes(dateFilteredDrives, 3), [dateFilteredDrives],
  );

  /* ---- Apply collection filter ---- */
  const collectionFiltered = useMemo(() => {
    switch (collection) {
      case 'anomalies': return anomalyDrives;
      case 'notable':   return notableDrives;
      case 'commutes':  return commuteDrives;
      case 'tagged':    return [];
      case 'all':
      default:          return dateFilteredDrives;
    }
  }, [collection, dateFilteredDrives, anomalyDrives, notableDrives, commuteDrives]);

  /* ---- Search filter — supports `score:X`, `from:Mon`, `distance:>N`
 * plus bare substring (addresses + numbers). The structured
 * parser short-circuits when the query is empty, so the pre-
 * existing free-text behaviour stays unchanged for users who
 * type a single word. ---- */
  // defer the search query so the input stays
  // responsive while the heavy downstream chain re-renders at non-urgent priority.
  const deferredSearch = useDeferredValue(search);
  const isSearchPending = !Object.is(search, deferredSearch);
  const searchTokens = useMemo(
    () => parseSearchQuery(deferredSearch),
    [deferredSearch],
  );
  const filteredDrives = useMemo(() => {
    if (searchTokens.length === 0) return collectionFiltered;
    return collectionFiltered.filter((d) =>
      matchesTokens(d, searchTokens, {
        text: (drive) => [
          drive.startAddress,
          drive.endAddress,
          // Surface the human-readable grade so a bare "B" still matches.
          gradeFromEfficiency(getEfficiency(drive)).label,
          // Display-unit distance so `"29.1"` matches what the row shows.
          fmtNumber(toDistanceDisplay(drive.distanceM ?? 0)),
        ],
        kv: {
          score: (drive, token) => {
            const grade = gradeFromEfficiency(getEfficiency(drive)).label.toLowerCase();
            return grade === token.value.trim().toLowerCase();
          },
          from: (drive, token) => {
            // Match by month name in the active vehicle tz so `from:Apr`
            // groups with the same row date headers.
            const day = localDayKey(drive.startTs, tz);
            if (!day) return false;
            const monthLabel = formatDayKey(day, { style: 'long' }).toLowerCase();
            return monthLabel.includes(token.value.trim().toLowerCase());
          },
          distance: (drive, token) => {
            const target = Number(token.value);
            if (!Number.isFinite(target)) return null;
            const display = toDistanceDisplay(drive.distanceM ?? 0);
            return compareNumeric(display, token.op, target);
          },
        },
      }),
    );
  }, [collectionFiltered, searchTokens, toDistanceDisplay, tz]);

  /* ---- Sort ---- */
  const sortedDrives = useMemo(() => {
    const sorted = [...filteredDrives];
    switch (sortBy) {
      case 'distance':   return sorted.sort((a, b) => b.distanceM - a.distanceM);
      case 'efficiency': return sorted.sort((a, b) => (getEfficiency(a) ?? 999) - (getEfficiency(b) ?? 999));
      default:           return sorted.sort((a, b) => (b.startTs ?? '').localeCompare(a.startTs ?? ''));
    }
  }, [filteredDrives, sortBy]);

  /* ---- Pagination ---- */
  const paginatedDrives = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedDrives.slice(start, start + pageSize);
  }, [sortedDrives, page, pageSize]);

  /* ---- Date-grouped view of the paginated list ---- */
  const groupedDrives = useMemo<DateGroupedListGroup<Drive>[]>(() => {
    // Use localDayKey w/ vehicle tz so a drive at 11pm vehicle-local
    // doesn't get grouped under the next UTC day. formatDayKey then
    // formats the YMD key directly without round-tripping through Date,
    // avoiding the off-by-one rendering at midnight boundaries.
    const raw = groupByDate(paginatedDrives, (d) => localDayKey(d.startTs, tz));
    return raw.map((g) => {
      const distM = g.items.reduce((s, d) => s + d.distanceM, 0);
      const distDisplay = fmtNumber(toDistanceDisplay(distM));
      const noun = g.items.length === 1
        ? t('bulk.noun.drive_one', 'drive')
        : t('bulk.noun.drive_other', 'drives');
      return {
        dateKey: g.dateKey,
        dateLabel: formatDayKey(g.dateKey, { style: 'long' }),
        // Always-relative label uses the YMD key (no Date arithmetic), so
        // "Today/Yesterday/Xd ago" agrees with the dateLabel above.
        relativeLabel: formatRelativeDays(`${g.dateKey}T12:00:00Z`, { tz: 'UTC' }),
        summary: `${g.items.length} ${noun} · ${distDisplay} ${distanceUnit}`,
        items: g.items,
      };
    });
  }, [paginatedDrives, toDistanceDisplay, distanceUnit, t, tz]);

  /* ---- Trend-chart series (one entry per available metric) ---- */
  const trendSeries = useMemo(() => ({
    drives:     dailyTrend(dateFilteredDrives, 'drives', tz),
    distance:   dailyTrend(dateFilteredDrives, 'distance', tz),
    score:      dailyTrend(dateFilteredDrives, 'score', tz),
    efficiency: dailyTrend(dateFilteredDrives, 'efficiency', tz),
    cost:       dailyTrend(dateFilteredDrives, 'cost', tz),
  } satisfies Record<TrendMetric, ReturnType<typeof dailyTrend>>),
  [dateFilteredDrives, tz]);

  const trendMetricsConfig: MetricSwitcherMetric<{ date: string; value: number }>[] = useMemo(() => [
    { key: 'drives',     label: t('drives.metric.drives', 'Drives'),         chart: 'bar',  color: '#00f0ff', accent: 'cyan',
      formatValue: (v) => fmtInt(v),
      formatTick: (v) => fmtInt(v) },
    { key: 'distance',   label: t('drives.metric.distance', 'Distance'),     chart: 'bar',  color: '#10b981', accent: 'green',
      getValue: (p) => toDistanceDisplay(p.value),
      formatValue: (v) => `${fmtNumber(v)} ${distanceUnit}`,
      formatTick: (v) => fmtNumber(v) },
    { key: 'score',      label: t('drives.metric.score', 'Score'),           chart: 'line', color: '#a855f7', accent: 'purple',
      formatValue: (v) => gradeFromNumeric(v).label,
      // Numeric ticks for the score axis — letter grades on the axis
      // would make every tick read "B" / "C" / "—", obscuring the trend.
      formatTick: (v) => fmtNumber(v, 1) },
    { key: 'efficiency', label: t('drives.metric.efficiency', 'Efficiency'), chart: 'line', color: '#f59e0b', accent: 'amber',
      getValue: (p) => toEfficiencyDisplay(p.value),
      formatValue: (v) => `${fmtInt(v)} ${efficiencyUnit}`,
      formatTick: (v) => fmtInt(v) },
    { key: 'cost',       label: t('drives.metric.cost', 'Cost'),             chart: 'bar',  color: '#ef4444', accent: 'red',
      getValue: (p) => p.value * costPerKwh,
      formatValue: (v) => formatCurrency(v, 2),
      // Compact axis label so the Y-axis doesn't show "$0.0833" on each tick.
      formatTick: (v) => formatCurrency(v, 2) },
  ], [t, toDistanceDisplay, toEfficiencyDisplay, distanceUnit, efficiencyUnit, costPerKwh, formatCurrency]);

  /** X-axis tick formatter for the trend chart — render `2026-04-24` as
 * "Apr 24" using the vehicle's tz so the axis label matches the row
 * date headers below. */
  const formatChartXTick = useCallback(
    (key: string) => formatDayKey(key, { style: 'short' }),
    [],
  );

  /* ---- Bulk selection ---- */
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set());
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

  /* ---- Period labels for the comparison header ---- */
  // Friendly format that always shows years on both ends so a Dec→Jan
  // range is unambiguous: "Apr 12, 2026 – May 12, 2026". When the active
  // range matches a known preset (Last 7d / Last 30d / MTD / YTD / All
  // time / etc.), prepend the localised preset name so the user gets the
  // semantic label up-front: "Last 30 days · Apr 12, 2026 – May 12, 2026".
  const datePresetId = useMemo(() => matchPresetId(startDate, endDate), [startDate, endDate]);
  const datePreset = datePresetId ? getDatePreset(datePresetId) : undefined;
  const datePresetLabel = datePreset ? t(datePreset.i18nKey, datePreset.fallback) : null;
  const formattedRange = `${formatDayKey(startDate, { style: 'long' })} – ${formatDayKey(endDate, { style: 'long' })}`;
  const periodLabel = datePresetLabel
    ? `${datePresetLabel} · ${formattedRange}`
    : formattedRange;
  // Comparison label rules:
  // - If the prior period has data, show "vs <range>" so the user knows
  // the deltas on each metric tile compare against that window.
  // - If the prior period is empty, render an explicit "No drives in
  // prior period: …" message instead of silently hiding the slot —
  // better to communicate "no baseline" than to leave the user
  // wondering why there's no comparison.
  // Prior range never gets a preset name (the prior window isn't user
  // selected) — full date range with years on both ends keeps it clear.
  const priorHasData = priorStats != null && priorStats.count > 0;
  let priorLabel: string | undefined;
  if (priorHasData && priorRange) {
    priorLabel = t('drives.priorPeriod', 'prior period: {{start}} – {{end}}', {
      start: formatDayKey(priorRange.start, { style: 'long' }),
      end: formatDayKey(priorRange.end, { style: 'long' }),
    });
  } else if (priorRange) {
    priorLabel = t('drives.noPriorData', 'No drives in prior period: {{start}} – {{end}}', {
      start: formatDayKey(priorRange.start, { style: 'long' }),
      end: formatDayKey(priorRange.end, { style: 'long' }),
    });
  } else {
    priorLabel = undefined;
  }

  const avgGrade = gradeFromNumeric(currentStats.avgGradeNumeric);

  /* ---- Headline grids ---- */
  const distMi = toDistanceDisplay(currentStats.totalDistanceM);
  const priorDistMi = priorStats ? toDistanceDisplay(priorStats.totalDistanceM) : null;
  const driveTimeMin = currentStats.totalDurationS / 60;
  const priorDriveTimeMin = priorStats ? priorStats.totalDurationS / 60 : null;
  const avgEffDisp = currentStats.avgEfficiencyWhKm != null
    ? toEfficiencyDisplay(currentStats.avgEfficiencyWhKm)
    : null;
  const priorEffDisp = priorStats?.avgEfficiencyWhKm != null
    ? toEfficiencyDisplay(priorStats.avgEfficiencyWhKm)
    : null;
  const totalCost = currentStats.totalEnergyKwh * costPerKwh;
  const priorTotalCost = priorStats ? priorStats.totalEnergyKwh * costPerKwh : null;

  /* ---- Secondary stats line ---- */
  const secondaryLine = currentStats.count > 0 ? (
    <span>
      {t('drives.topSpeed', 'Top speed')} {fmtInt(toSpeedDisplay(currentStats.topSpeedMps))} {speedUnit}
      {' · '}
      {t('drives.longest', 'Longest')} {fmtNumber(toDistanceDisplay(currentStats.longest?.distanceM ?? 0))} {distanceUnit}
      {' · '}
      {t('drives.avgTrip', 'Avg trip')} {fmtNumber(currentStats.count > 0 ? toDistanceDisplay(currentStats.totalDistanceM / currentStats.count) : 0)} {distanceUnit}
      {' · '}
      {formatDurationMinutes(currentStats.count > 0 ? currentStats.totalDurationS / 60 / currentStats.count : 0)} {t('drives.avgDur', 'avg dur')}
    </span>
  ) : null;

  /* ---- Anomaly callout ---- */
  const anomalyFooter = anomalyDrives.length > 0 && collection !== 'anomalies' ? (
    <InlineCallout
      variant="warning"
      icon={<AlertTriangle className="h-3.5 w-3.5" />}
      action={{
        label: t('drives.viewAnomalies', 'View anomalies'),
        onClick: () => setUrlBatch({ coll: 'anomalies', page: null }),
      }}
    >
      {t('drives.anomalyCount', '{{count}} {{noun}} in this range', {
        count: anomalyDrives.length,
        noun: anomalyDrives.length === 1
          ? t('drives.anomaly_one', 'anomaly')
          : t('drives.anomaly_other', 'anomalies'),
      })}
    </InlineCallout>
  ) : null;

  /* ---- Collections pill items ---- */
  const collectionPills: PillItem[] = useMemo(() => [
    { key: 'all',       label: t('drives.coll.all', 'All'),             count: dateFilteredDrives.length, accent: 'cyan',   icon: <ListIcon className="h-3 w-3" /> },
    { key: 'anomalies', label: t('drives.coll.anomalies', 'Anomalies'), count: anomalyDrives.length,       accent: 'red',    icon: <AlertTriangle className="h-3 w-3" /> },
    { key: 'notable',   label: t('drives.coll.notable', 'Notable'),     count: notableDrives.length,       accent: 'purple', icon: <Star className="h-3 w-3" /> },
    { key: 'commutes',  label: t('drives.coll.commutes', 'Commutes'),   count: commuteDrives.length,       accent: 'green',  icon: <Repeat className="h-3 w-3" /> },
    { key: 'tagged',    label: t('drives.coll.tagged', 'Tagged'),       count: 0,                          accent: 'amber',  icon: <Tag className="h-3 w-3" />, disabled: true },
  ], [t, dateFilteredDrives.length, anomalyDrives.length, notableDrives.length, commuteDrives.length]);

  /* ---- Compact summary for the sticky bar ---- */
  const collectionLabel = collectionPills.find(p => p.key === collection)?.label ?? 'All';
  const stickySummary = (
    <>
      <span className="text-[var(--text-secondary)] truncate">
        {t('drives.title', 'Drive History')}
      </span>
      <span className="opacity-50">·</span>
      <span className="truncate">{periodLabel}</span>
      <span className="opacity-50">·</span>
      <span className="text-[var(--text-primary)] font-medium">{collectionLabel}</span>
      <span className="opacity-50">·</span>
      <span>{fmtCompact(filteredDrives.length)} {t('drives.results', 'results')}</span>
      {avgGrade.label !== '—' && (
        <>
          <span className="opacity-50">·</span>
          <span>{t('drives.avgScore', 'avg')}{' '}
            <span style={{ color: avgGrade.color }} className="font-semibold">{avgGrade.label}</span>
          </span>
        </>
      )}
    </>
  );

  /* ---- Defensive: no vehicle ---- */
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
        <div className="flex flex-wrap items-center justify-end gap-3">
          <VehicleSelect />
          <RangePicker
            value={{ start: startDate, end: endDate }}
            onChange={(r) => {
              setUrlBatch({ from: r.start, to: r.end, page: null });
            }}
            align="end"
            triggerTestId="drives-range-picker"
          />
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
      <PullToRefresh onRefresh={async () => { await refetchDrives(); }}>
        {/* Sticky bar that appears once the overview scrolls out */}
        <PageHeaderSticky
          targetId="drives-overview"
          ariaLabel={t('drives.stickyBar.aria', 'Drive history summary')}
          testId="drives-sticky-summary"
        >
          {stickySummary}
        </PageHeaderSticky>

        {/* Opt-in natural-language drive search.
            Hidden when ai_mode='off' or the nl-drive-search-replay toggle
            is off — the typed SearchInput + FilterBar below remain the
            canonical baseline. */}
        <FadeIn>
          <AINLDriveSearch />
        </FadeIn>

        {/* Search + active filter chips */}
        <FadeIn>
          <FilterBar>
            <div className="relative w-full sm:w-96">
              <SearchInput
                value={search}
                onChange={(v) => { setUrlBatch({ q: v || null, page: null }); }}
                placeholder={t('drives.searchPlaceholder', 'Search drives — try "score:D", "Office", "29.1"')}
                className="w-full"
                historyScope="drives"
              />
              {isSearchPending && (
                <span
                  role="status"
                  aria-live="polite"
                  aria-label={t('filter.pending', 'Filtering…')}
                  className="pointer-events-none absolute right-9 top-1/2 -translate-y-1/2 inline-block h-3 w-3 rounded-full border-2 border-cyan-400/40 border-t-cyan-400 animate-spin"
                />
              )}
            </div>
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
                      onRemove: () => { setUrlBatch({ q: null, page: null }); },
                    } satisfies FilterChipDescriptor
                  : null,
                // Date range chips intentionally omitted — the RangePicker
                // trigger above already shows the active range and offers
                // preset reset, so showing chips here would duplicate the
                // affordance.
                collection !== 'all'
                  ? {
                      key: 'coll',
                      label: t('drives.filterLabel.collection', 'View'),
                      value: collectionLabel,
                      onRemove: () => { setUrlBatch({ coll: null, page: null }); },
                    } satisfies FilterChipDescriptor
                  : null,
              ].filter(Boolean) as FilterChipDescriptor[]) as readonly FilterChipDescriptor[]
            }
            onClearAll={() => {
              // Only clear filters that are visible as chips. Date range is
              // owned by the RangePicker, so leave it alone here — clearing
              // an invisible filter would be a WYSIWYG violation.
              setUrlBatch({ q: null, coll: null, page: null });
            }}
          />
        </FadeIn>

        {/* Overview KPI card */}
        <FadeIn>
          {currentStats.count > 0 ? (
            <KpiOverviewCard
              id="drives-overview"
              testId="drives-overview"
              header={{
                title: t('drives.overview', 'Overview'),
                currentLabel: periodLabel,
                comparisonLabel: priorLabel,
              }}
              kpis={
                <>
                  <MetricCard
                    label={t('drives.totalDrives', 'Drives')}
                    value={fmtCompact(currentStats.count)}
                    color="cyan"
                    delta={priorHasData ? {
                      metric: 'trip_count',
                      previous: priorStats!.count,
                      current: currentStats.count,
                      display: 'percent',
                    } : undefined}
                  />
                  <MetricCard
                    label={`${t('drives.distance', 'Distance')} (${distanceUnit})`}
                    value={fmtCompact(distMi, 10000)}
                    color="green"
                    delta={priorHasData ? {
                      metric: 'distance',
                      previous: priorDistMi,
                      current: distMi,
                      display: 'percent',
                    } : undefined}
                  />
                  <MetricCard
                    label={t('drives.driveTime', 'Drive time')}
                    value={formatDurationMinutes(driveTimeMin)}
                    color="blue"
                    delta={priorHasData ? {
                      metric: { direction: 'neutral' },
                      previous: priorDriveTimeMin,
                      current: driveTimeMin,
                      display: 'percent',
                    } : undefined}
                  />
                  <MetricCard
                    label={t('drives.avgScore', 'Avg score')}
                    value={avgGrade.label}
                    color="purple"
                    delta={priorHasData && priorStats!.avgGradeNumeric != null && currentStats.avgGradeNumeric != null ? {
                      metric: 'drive_score',
                      previous: priorStats!.avgGradeNumeric,
                      current: currentStats.avgGradeNumeric,
                      display: 'percent',
                    } : undefined}
                  />
                  <MetricCard
                    label={`${t('drives.efficiency', 'Efficiency')} (${efficiencyUnit})`}
                    value={avgEffDisp != null ? fmtInt(avgEffDisp) : '—'}
                    color="amber"
                    delta={priorHasData && avgEffDisp != null && priorEffDisp != null ? {
                      metric: 'efficiency',
                      previous: priorEffDisp,
                      current: avgEffDisp,
                      display: 'percent',
                    } : undefined}
                  />
                  <MetricCard
                    label={t('drives.cost', 'Cost')}
                    value={formatEnergyCost(currentStats.totalEnergyKwh)}
                    color="red"
                    delta={priorHasData ? {
                      metric: 'cost',
                      previous: priorTotalCost,
                      current: totalCost,
                      display: 'percent',
                    } : undefined}
                  />
                </>
              }
              secondary={secondaryLine}
              footer={anomalyFooter}
            />
          ) : (
            <GlassPanel className="p-6">
              <EmptyState
                /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                message={t('drives.noStatsRange', 'No drives in this range')}
              />
            </GlassPanel>
          )}
        </FadeIn>

        {/* Drives over time — metric-switcher chart */}
        {currentStats.count > 0 && (
          <FadeIn>
            <MetricSwitcherChart
              title={t('drives.overTime', 'Drives over time')}
              ariaLabel={t('drives.overTime.aria', 'Drives over time chart with metric switcher')}
              series={trendSeries}
              metrics={trendMetricsConfig}
              activeMetric={trendMetric}
              onMetricChange={(k) => setTrendMetric(k as TrendMetric)}
              formatXTick={formatChartXTick}
              emptyMessage={t('drives.overTime.empty', 'No data for this metric in the selected range')}
              testId="drives-trend-chart"
            />
          </FadeIn>
        )}

        {/* Collections pill row */}
        <FadeIn>
          <PillFilterBar
            items={collectionPills}
            activeKey={collection}
            onChange={(k) => setUrlBatch({ coll: k === 'all' ? null : k, page: null })}
            ariaLabel={t('drives.collections.aria', 'Filter drives by collection')}
            testId="drives-collections"
          />
        </FadeIn>

        {/* List controls — sort + export */}
        {sortedDrives.length > 0 ? (
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-3" data-tour="drives-list">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <Route className="h-4 w-4 text-cyan-400" />
              {t('drives.allDrives', 'All Drives')}
              <span className="text-xs font-normal text-[var(--text-muted)]">
                ({fmtCompact(sortedDrives.length)})
              </span>
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
                  aria-label={t('drives.sortByAria', 'Sort by {{field}}', {
                    field: s === 'date'
                      ? t('drives.sortRecent', 'Recent')
                      : s === 'distance'
                        ? t('drives.sortDistance', 'Distance')
                        : t('drives.sortEfficiency', 'Efficiency'),
                  })}
                  aria-pressed={sortBy === s}
                >
                  <span className="inline-flex items-center gap-1">
                    {s === 'date'
                      ? t('drives.sortRecent', 'Recent')
                      : s === 'distance'
                        ? t('drives.sortDistance', 'Distance')
                        : t('drives.sortEfficiency', 'Efficiency')}
                    {sortBy === s && (
                      <ArrowDown className="h-3 w-3 opacity-80" aria-hidden />
                    )}
                  </span>
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
            <StaggerContainer>
              <DateGroupedList
                groups={groupedDrives}
                itemKey={(d) => d.id}
                renderItem={(d) => (
                  <StaggerItem>
                    <DriveCard
                      drive={d}
                      toDistanceDisplay={toDistanceDisplay}
                      toSpeedDisplay={toSpeedDisplay}
                      toEfficiencyDisplay={toEfficiencyDisplay}
                      distanceUnit={distanceUnit}
                      speedUnit={speedUnit}
                      efficiencyUnit={efficiencyUnit}
                      formatEnergyCost={formatEnergyCost}
                      tz={tz}
                      isAnomaly={anomalyDriveIds.has(d.id)}
                      selected={bulkSelected.has(d.id)}
                      onToggleSelect={toggleDriveSelected}
                    />
                  </StaggerItem>
                )}
              />
            </StaggerContainer>
            <Pagination
              page={page}
              pageSize={pageSize}
              total={sortedDrives.length}
              onPageChange={setPage}
              onPageSizeChange={(s) => { setUrlBatch({ size: String(s), page: null }); }}
            />
          </>
        ) : (
          <EmptyState
            icon={<Route className="h-8 w-8" />}
            title={
              collection !== 'all'
                ? t('drives.emptyForCollection', 'No drives in this view')
                : t('drives.emptyTitle', 'No drives recorded yet')
            }
            message={
              collection !== 'all'
                ? t('drives.emptyForCollection.msg', 'Try switching to a different collection or clearing your filters.')
                : t('drives.emptyMessage', 'Drive data will appear here once your vehicle records trips.')
            }
            action={{
              label: t('drives.empty.cta', 'Reset filters'),
              onClick: () => {
                setUrlBatch({ q: null, from: null, to: null, coll: null, sort: null, page: null });
              },
            }}
          />
        )}
      </PullToRefresh>
    </PageContainer>
  );
}
