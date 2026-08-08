import { useMemo, useState, useCallback, useEffect, useDeferredValue } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Route, Gauge, TrendingUp, Clock, Sparkles,
  ArrowUpDown, ArrowDown, Download, Activity,
  Trash2, AlertTriangle, Star, Repeat, Tag, List as ListIcon,
} from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeaderSticky } from '@/components/layout/PageHeaderSticky';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { PanelTitle, SectionTitle, Text } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { Pagination } from '@/components/ui/Pagination';
import { SavedViewMenu } from '@/components/data-display/SavedViewMenu';
import {
  BulkActionsToolbar, type BulkAction, DataFreshnessAuto,
  KpiOverviewCard, MetricCard, DateGroupedList, type DateGroupedListGroup,
} from '@/components/data-display';
import { useSavedViewUrl } from '@/hooks/useSavedViewUrl';
import { MetricSwitcherChart, type MetricSwitcherMetric } from '@/components/charts';
import { Skeleton } from '@/components/feedback/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { InlineCallout } from '@/components/feedback/InlineCallout';
import { RangePicker, VehicleSelect, PillFilterBar, type PillItem } from '@/components/forms';
import { SearchInput } from '@/components/forms/SearchInput';
import { FilterBar } from '@/components/forms/FilterBar';
import { ActiveFilterChips, type FilterChipDescriptor } from '@/components/forms/ActiveFilterChips';
import { useUrlBatch, useUrlEnum, useUrlString, useUrlNumber } from '@/hooks/useUrlState';
import { useRangeState } from '@/hooks/useRangeState';
import { parseSearchQuery, matchesTokens, compareNumeric } from '@/lib/searchQuery';
import { FadeIn } from '@/components/motion/FadeIn';
import { StaggerContainer } from '@/components/motion/StaggerContainer';
import { StaggerItem } from '@/components/motion/StaggerItem';
import { useDrives, useBulkDeleteDrives } from '@/api/hooks/useDriving';
import { apiUrl } from '@/api/client';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useTimezone } from '@/lib/timezone';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { PullToRefresh } from '@/components/mobile';
import { AINLDriveSearch } from '@/components/ai/AINLDriveSearch';
import { formatRelativeDays, formatDurationMinutes, formatDayKey } from '@/lib/dateFormat';
import { matchPresetId, getDatePreset } from '@/lib/datePresets';
import { fmtNumber, fmtInt, fmtCompact } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import type { Drive } from '@/types/driving';
import { convertDistanceFromSI, convertSpeedFromSI } from '@/lib/unitConversion';
import {
  getEfficiency, gradeFromEfficiency, gradeFromNumeric,
  computePeriodStats, priorPeriod, detectAnomalies, detectNotable, detectCommutes,
  groupByDate, dailyTrend, localDayKey, shiftDayKey,
  type TrendMetric, type PeriodStats,
} from '@/lib/drivesAggregation';
import { DriveCard } from '../components/DriveCard';


/* ------------------------------------------------------------------ */
/* DrivesListPage */
/* ------------------------------------------------------------------ */

const COLLECTIONS = ['all', 'anomalies', 'notable', 'commutes', 'tagged'] as const;
type Collection = typeof COLLECTIONS[number];
const TREND_METRICS = ['drives', 'distance', 'score', 'efficiency', 'cost'] as const;

/** Rows fetched per request. The API rejects anything above 1,000. */
const DRIVES_FETCH_LIMIT = 1000;

export default function DrivesListPage() {
  const { t } = useTranslation();
  usePageTitle(t('drives.title', 'Drive History'));
  const savedView = useSavedViewUrl();

  /* Data hooks */
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  /* Selected range. Read before the data hook because it scopes the request:
   * the API applies a 50-row default page, so filtering client-side alone
   * capped this page at the 50 newest drives regardless of the chosen range
   * or page size. */
  const {
    start: startDate,
    end: endDate,
    setRangeWithUrlUpdates,
  } = useRangeState({
    persistKey: 'drives.list.range',
    defaultPresetId: '30d',
  });
  const priorRange = useMemo(() => priorPeriod(startDate, endDate), [startDate, endDate]);

  /* Fetch window. It has to reach back over the prior period as well, because
   * the delta comparison below is computed from drives that fall *before* the
   * selected range. Both ends are padded by a day: the API filters on UTC
   * while this page buckets drives by the vehicle's local day, so an exact
   * window would drop rows the tz-aware filter should keep. */
  const fetchWindow = useMemo(() => ({
    start: shiftDayKey(priorRange?.start ?? startDate, -1) ?? undefined,
    end: shiftDayKey(endDate, 1) ?? undefined,
    limit: DRIVES_FETCH_LIMIT,
  }), [priorRange, startDate, endDate]);

  const drivesQuery = useDrives(vehicleIdStr, fetchWindow);
  const { data: drives, isLoading: isDrivesLoading, error: drivesError, refetch: refetchDrives } = drivesQuery;

  /* A full page back means the range almost certainly holds more drives than
   * one request can carry. Say so rather than silently showing a subset. */
  const truncated = (drives?.length ?? 0) >= DRIVES_FETCH_LIMIT;

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
      case 'distance':   return sorted.sort((a, b) => (b.distanceM ?? 0) - (a.distanceM ?? 0));
      case 'efficiency': return sorted.sort((a, b) => (getEfficiency(a) ?? 999) - (getEfficiency(b) ?? 999));
      default:           return sorted.sort((a, b) => (b.startTs ?? '').localeCompare(a.startTs ?? ''));
    }
  }, [filteredDrives, sortBy]);

  /* ---- Pagination ---- */
  // Clamp the URL-provided page into the valid range. A stale `?page=N`
  // (left over after a filter, collection switch, or a bulk delete shrinks
  // the result set) must not strand the user on an out-of-range slice that
  // renders the "no drives" empty state while results still exist on an
  // earlier page.
  const pageCount = Math.max(1, Math.ceil(sortedDrives.length / pageSize));
  const safePage = Math.min(Math.max(1, Math.floor(page)), pageCount);
  const paginatedDrives = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sortedDrives.slice(start, start + pageSize);
  }, [sortedDrives, safePage, pageSize]);

  /* ---- Date-grouped view of the paginated list ---- */
  const groupedDrives = useMemo<DateGroupedListGroup<Drive>[]>(() => {
    // Use localDayKey w/ vehicle tz so a drive at 11pm vehicle-local
    // doesn't get grouped under the next UTC day. formatDayKey then
    // formats the YMD key directly without round-tripping through Date,
    // avoiding the off-by-one rendering at midnight boundaries.
    const raw = groupByDate(paginatedDrives, (d) => localDayKey(d.startTs, tz));
    return raw.map((g) => {
      const distM = g.items.reduce((s, d) => s + (d.distanceM ?? 0), 0);
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

  /* ---- Highlights rows — "fold-down" period stats (top speed, longest,
 * avg trip, avg duration) surfaced beside the trend chart. Real period
 * data, formatted at the display boundary via the unit converters. ---- */
  const highlightRows = currentStats.count > 0 ? [
    {
      key: 'topSpeed',
      icon: <TrendingUp className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />,
      label: t('drives.topSpeed', 'Top speed'),
      value: `${fmtInt(toSpeedDisplay(currentStats.topSpeedMps))} ${speedUnit}`,
    },
    {
      key: 'longest',
      icon: <Route className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />,
      label: t('drives.longest', 'Longest'),
      value: `${fmtNumber(toDistanceDisplay(currentStats.longest?.distanceM ?? 0))} ${distanceUnit}`,
    },
    {
      key: 'avgTrip',
      icon: <Gauge className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />,
      label: t('drives.avgTrip', 'Avg trip'),
      value: `${fmtNumber(toDistanceDisplay(currentStats.totalDistanceM / currentStats.count))} ${distanceUnit}`,
    },
    {
      key: 'avgDuration',
      icon: <Clock className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />,
      label: t('drives.avgDuration', 'Avg duration'),
      value: formatDurationMinutes(currentStats.totalDurationS / 60 / currentStats.count),
    },
  ] : [];

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
      <Text as="span" color="secondary" className="truncate">
        {t('drives.title', 'Drive History')}
      </Text>
      <span className="opacity-50">·</span>
      <span className="truncate">{periodLabel}</span>
      <span className="opacity-50">·</span>
      <Text as="span" color="primary" weight="medium">{collectionLabel}</Text>
      <span className="opacity-50">·</span>
      <span>{fmtCompact(filteredDrives.length)} {t('drives.results', 'results')}</span>
      {avgGrade.label !== '—' && (
        <>
          <span className="opacity-50">·</span>
          <span>{t('drives.avgScore', 'avg')}{' '}
            <Text as="span" weight="semibold" style={{ color: avgGrade.color }}>{avgGrade.label}</Text>
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
              setRangeWithUrlUpdates(r, { page: null });
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
        <div className="space-y-4 sm:space-y-6">
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
          {isDrivesLoading ? (
            <GlassPanel id="drives-overview" className="p-4 sm:p-5">
              <Skeleton className="h-32" />
            </GlassPanel>
          ) : currentStats.count > 0 ? (
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
            />
          ) : (
            <GlassPanel id="drives-overview" className="p-6">
              <EmptyState
                /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                message={t('drives.noStatsRange', 'No drives in this range')}
              />
            </GlassPanel>
          )}
        </FadeIn>

        {/* Trends + highlights — full-width bento: a hero metric-switcher
            chart beside a period-highlights panel. Both fill wider screens
            with more columns (xl → 3 cols, 3xl → 4). Each section owns its
            loading / empty state independently. */}
        <FadeIn delay={0.1}>
          <section
            aria-label={t('drives.analysis', 'Trends and highlights')}
            className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5 3xl:grid-cols-4"
          >
            <div className="xl:col-span-2 3xl:col-span-3">
              {isDrivesLoading ? (
                <GlassPanel className="p-4 sm:p-5">
                  <PanelTitle className="mb-3 flex items-center gap-2">
                    <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                    {t('drives.overTime', 'Drives over time')}
                  </PanelTitle>
                  <Skeleton className="h-56 sm:h-64" />
                </GlassPanel>
              ) : (
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
              )}
            </div>

            <GlassPanel className="space-y-4 p-4 sm:p-5 xl:col-span-1">
              <PanelTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('drives.highlights', 'Highlights')}
              </PanelTitle>
              {isDrivesLoading ? (
                <Skeleton className="h-40" />
              ) : currentStats.count === 0 ? (
                <EmptyState
                  /* no-action: transient empty state — no drives in the selected range to summarise */
                  message={t('drives.noHighlights', 'No highlights in this range')}
                />
              ) : (
                <div className="space-y-4">
                  <dl className="space-y-3">
                    {highlightRows.map((row) => (
                      <div key={row.key} className="flex items-center justify-between gap-3">
                        <Text as="dt" size="sm" color="secondary" className="flex min-w-0 items-center gap-2">
                          {row.icon}
                          <span className="truncate">{row.label}</span>
                        </Text>
                        <Text as="dd" size="sm" weight="semibold" color="primary" className="shrink-0 tabular-nums">
                          {row.value}
                        </Text>
                      </div>
                    ))}
                  </dl>
                  {anomalyFooter}
                </div>
              )}
            </GlassPanel>
          </section>
        </FadeIn>

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

        {/* Detail band — full-width drive list */}
        <section
          aria-label={t('drives.list', 'Drive list')}
          className="space-y-3"
          data-tour="drives-list"
        >
          <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
            <SectionTitle className="flex items-center gap-2">
              <Route className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('drives.allDrives', 'All Drives')}
              <Text as="span" size="xs" weight="regular" color="muted">
                ({fmtCompact(sortedDrives.length)})
              </Text>
            </SectionTitle>
            {sortedDrives.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <ArrowUpDown className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
                {(['date', 'distance', 'efficiency'] as const).map((s) => (
                  <Button
                    key={s}
                    variant="ghost"
                    size="sm"
                    onClick={() => setSortBy(s)}
                    className={cn(
                      sortBy === s
                        ? 'bg-cyan-500/10 text-cyan-300'
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
                <span className="mx-1 h-4 w-px bg-[var(--surface-2)]" aria-hidden="true" />
                <a
                  href={apiUrl(`/export/drives?format=csv${startDate ? `&start=${startDate}` : ''}${endDate ? `&end=${endDate}` : ''}${vehicleId ? `&vehicle_id=${vehicleId}` : ''}`)}
                  download="teslasync-drives.csv"
                >
                  <Button variant="secondary" size="sm" icon={<Download className="h-3.5 w-3.5" />}>CSV</Button>
                </a>
                <a
                  href={apiUrl(`/export/drives?format=json${startDate ? `&start=${startDate}` : ''}${endDate ? `&end=${endDate}` : ''}${vehicleId ? `&vehicle_id=${vehicleId}` : ''}`)}
                  download="teslasync-drives.json"
                >
                  <Button variant="secondary" size="sm" icon={<Download className="h-3.5 w-3.5" />}>JSON</Button>
                </a>
              </div>
            )}
          </div>

        {/* Drive list */}
        {truncated && (
          <InlineCallout variant="warning" icon={<AlertTriangle className="h-4 w-4" />}>
            {t(
              'drives.truncated',
              'Showing the {{limit}} most recent drives in this range — the range holds more than one request can return. Narrow the dates, or use the CSV/JSON export for the full set.',
              { limit: DRIVES_FETCH_LIMIT },
            )}
          </InlineCallout>
        )}
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
              page={safePage}
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
        </section>
        </div>
      </PullToRefresh>
    </PageContainer>
  );
}
