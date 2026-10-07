import { useMemo, useCallback, useEffect, useRef, useDeferredValue } from 'react';
import { endpointLabel, type DateGroupedListGroup } from '@/components/data-display';
import { type MetricSwitcherMetric } from '@/components/charts';
import { type TableControls } from '@/components/forms';
import { useUrlBatch, useUrlEnum, useUrlString, useUrlNumber } from '@/hooks/useUrlState';
import { parseSearchQuery, matchesTokens, compareNumeric } from '@/lib/searchQuery';
import { apiUrl } from '@/api/client';
import { scopedPath } from '@/api/scope';
import { formatRelativeDayKey, formatDayKey } from '@/lib/dateFormat';
import type { Drive } from '@/types/driving';
import { convertTempFromSI, convertPowerFromSI } from '@/lib/unitConversion';
import {
  getEfficiency, gradeFromEfficiency, gradeFromNumeric,
  computePeriodStats, detectAnomalies, detectNotable, detectCommutes,
  groupByDate, dailyTrend, localDayKey,
  type TrendMetric, type PeriodStats,
} from '@/lib/drivesAggregation';
import { DRIVE_GRID_SORT_KEYS, type DriveGridFilters, type DriveGridFilterKey, type DriveGridSortKey } from '../components/DrivesEvidenceTable';
import { driveAverageSpeed, driveBattery } from '../components/driveGridMetrics';
import { DRIVE_VALUE_COLUMNS, compactDriveValueSelection, driveColumnValue, driveValueKey, parseDriveValueSelections, type DriveValueColumn } from '../components/driveGridValues';
import { COLLECTIONS, FSD_FILTERS, TREND_METRICS, type Collection, type FsdFilter } from '../components/drives-orchestrator/drivesListConstants';
import type { useDrivesListPageData } from './useDrivesListPageData';

export function useDrivesListPageFilters(data: ReturnType<typeof useDrivesListPageData>) {
  const {
    desktopEvidence, fsdDataAvailable, startDate, endDate, drives, tz,
    priorRange, fsdByDriveID, exportScope, t, toDistanceDisplay,
    toSpeedDisplay, unitPrefs, fmtNumber, distanceUnit, toEfficiencyDisplay,
    fmtInt, efficiencyUnit, costPerKwh, formatCurrency,
  } = data;

  /* URL-persisted UI state */
  const [sortBy] = useUrlEnum<DriveGridSortKey>(
    'sort', DRIVE_GRID_SORT_KEYS, 'date',
  );
  const [sortDirection] = useUrlEnum('sortdir', ['auto', 'asc', 'desc'] as const, 'auto');
  const effectiveSortDirection = sortDirection === 'auto'
    ? sortBy === 'efficiency' || sortBy === 'grade' || sortBy === 'route' || sortBy === 'start' || sortBy === 'destination' ? 'asc' : 'desc'
    : sortDirection;
  const [page, setPage] = useUrlNumber('page', 1);
  const [pageSize] = useUrlNumber('size', 50);
  const [search] = useUrlString('q', '');
  const [density, setDensity] = useUrlEnum('density', ['compact', 'comfortable'] as const, desktopEvidence ? 'compact' : 'comfortable');
  const [collection] = useUrlEnum<Collection>('coll', COLLECTIONS, 'all');
  const [fsdFilter] = useUrlEnum<FsdFilter>('fsd', FSD_FILTERS, 'all');
  const [trendMetric, setTrendMetric] = useUrlEnum<TrendMetric>('trend', TREND_METRICS, 'drives');
  const setUrlBatch = useUrlBatch();
  const [gridValues] = useUrlString('grid_values');
  const valueFilter = useMemo(() => parseDriveValueSelections(gridValues), [gridValues]);
  const hasValueFilters = valueFilter.invalid || Object.keys(valueFilter.selections).length > 0;
  const valuePredicates = useMemo(() => DRIVE_VALUE_COLUMNS.flatMap((column) => {
    const selection = valueFilter.selections[column];
    return selection == null ? [] : [{
      column,
      excluded: !Array.isArray(selection),
      values: new Set(Array.isArray(selection) ? selection : selection.excluded),
    }];
  }), [valueFilter.selections]);
  const [gridDistance] = useUrlString('grid_distance');
  const [gridDuration] = useUrlString('grid_duration');
  const [gridSpeed] = useUrlString('grid_speed');
  const [gridGrade] = useUrlString('grid_grade');
  const [gridBattery] = useUrlString('grid_battery');
  const [gridEnergy] = useUrlString('grid_energy');
  const [gridStart] = useUrlString('grid_start');
  const [gridDestination] = useUrlString('grid_destination');
  const [gridStartBattery] = useUrlString('grid_start_battery');
  const [gridBatteryUsed] = useUrlString('grid_battery_used');
  const [gridMaxSpeed] = useUrlString('grid_max_speed');
  const [gridAvgPower] = useUrlString('grid_avg_power');
  const [gridOutsideTemp] = useUrlString('grid_outside_temp');
  const [gridInsideTemp] = useUrlString('grid_inside_temp');
  const [gridRegen] = useUrlString('grid_regen');
  const [gridScore] = useUrlString('grid_score');
  const gridFilters = useMemo<DriveGridFilters>(() => ({
    distance: gridDistance, duration: gridDuration, speed: gridSpeed,
    grade: gridGrade, battery: gridBattery, energy: gridEnergy,
    start: gridStart, destination: gridDestination,
    startBattery: gridStartBattery, batteryUsed: gridBatteryUsed,
    maxSpeed: gridMaxSpeed, avgPower: gridAvgPower, outsideTemp: gridOutsideTemp,
    insideTemp: gridInsideTemp, regen: gridRegen, score: gridScore,
  }), [gridDistance, gridDuration, gridSpeed, gridGrade, gridBattery, gridEnergy, gridStart, gridDestination, gridStartBattery, gridBatteryUsed, gridMaxSpeed, gridAvgPower, gridOutsideTemp, gridInsideTemp, gridRegen, gridScore]);
  const changeGridFilter = useCallback((key: DriveGridFilterKey, value: string) => {
    const parameter = `grid_${key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`;
    setUrlBatch({ [parameter]: value || null, page: null });
  }, [setUrlBatch]);
  const clearValueFilter = useCallback((column: DriveValueColumn) => {
    const next = { ...valueFilter.selections };
    delete next[column];
    const updates: Record<string, string | null> = {
      grid_values: Object.keys(next).length ? JSON.stringify(next) : null,
      page: null,
    };
    if (column === 'date') { updates.q = null; updates.coll = null; }
    else if (column === 'fsd') updates.fsd = null;
    else if (column === 'efficiency' || column === 'grade') updates.grid_grade = null;
    else if (column in gridFilters) updates[`grid_${column.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`] = null;
    setUrlBatch(updates);
  }, [valueFilter.selections, gridFilters, setUrlBatch]);
  const sortGrid = useCallback((key: DriveGridSortKey) => {
    if (key === 'fsd' && !fsdDataAvailable) return;
    const direction = key === sortBy
      ? effectiveSortDirection === 'desc' ? 'asc' : 'desc'
      : key === 'efficiency' || key === 'grade' || key === 'route' || key === 'start' || key === 'destination' ? 'asc' : 'desc';
    setUrlBatch({ sort: key === 'date' ? null : key, sortdir: direction, page: null });
  }, [sortBy, effectiveSortDirection, fsdDataAvailable, setUrlBatch]);
  const previousRange = useRef(`${startDate}:${endDate}`);
  useEffect(() => {
    const currentRange = `${startDate}:${endDate}`;
    if (previousRange.current === currentRange) return;
    previousRange.current = currentRange;
    if (page !== 1) setUrlBatch({ page: null });
  }, [startDate, endDate, page, setUrlBatch]);

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
  const changeValueSelection = useCallback((column: DriveValueColumn, values: string[] | null) => {
    const next = { ...valueFilter.selections };
    if (values == null) delete next[column];
    else {
      const available = Array.from(new Set(dateFilteredDrives.map((drive) =>
        driveValueKey(driveColumnValue(drive, column, fsdByDriveID, anomalyDriveIds, fsdDataAvailable)),
      )));
      next[column] = compactDriveValueSelection(values, available);
    }
    setUrlBatch({ grid_values: Object.keys(next).length ? JSON.stringify(next) : null, page: null });
  }, [valueFilter.selections, dateFilteredDrives, fsdByDriveID, anomalyDriveIds, fsdDataAvailable, setUrlBatch]);
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

  const fsdFiltered = useMemo(() => {
    if (fsdFilter === 'all' || !fsdDataAvailable) return collectionFiltered;
    return collectionFiltered.filter((drive) => {
      const insight = fsdByDriveID.get(drive.id);
      if (fsdFilter === 'unknown') {
        return insight?.confidence === 'unknown';
      }
      if (fsdFilter === 'reported') {
        return insight != null
          && insight.confidence !== 'unknown'
          && insight.fsd_distance_m != null;
      }
      return insight?.confidence === fsdFilter;
    });
  }, [collectionFiltered, fsdByDriveID, fsdDataAvailable, fsdFilter]);

  /* ---- Search filter — supports `grade:X`, legacy `score:X`, `from:Mon`, `distance:>N`
 * plus bare substring (addresses + numbers). The structured
 * parser short-circuits when the query is empty, so the pre-
 * existing free-text behaviour stays unchanged for users who
 * type a single word. ---- */
  // defer the search query so the input stays
  // responsive while the heavy downstream chain re-renders at non-urgent priority.
  const deferredSearch = useDeferredValue(search);
  const isSearchPending = !Object.is(search, deferredSearch);
  const downloadDriveExport = useCallback((format: 'csv' | 'json') => {
    const link = document.createElement('a');
    link.href = apiUrl(scopedPath('/export/drives', { ...exportScope, filters: { format } }));
    link.download = `teslasync-drives.${format}`;
    link.click();
  }, [exportScope]);
  const tableControls: TableControls = {
    search: {
      value: search,
      onChange: (value) => setUrlBatch({ q: value || null, page: null }),
      placeholder: t('drives.searchPlaceholder', 'Search drives — try "grade:D", "Office", "29.1"'),
      historyScope: 'drives',
      pending: isSearchPending,
    },
    density: { value: density, onChange: (next) => { if (next !== 'table') setDensity(next); }, testId: 'drives-density' },
    exports: {
      onExportCsv: () => downloadDriveExport('csv'),
      onExportJson: () => downloadDriveExport('json'),
      selectedCount: 0,
      description: t('drives.exportScope', 'Exports include every drive in the selected vehicle and date range, without list filters or selection.'),
      testId: 'drives-export',
    },
  };
  const searchTokens = useMemo(
    () => parseSearchQuery(deferredSearch),
    [deferredSearch],
  );
  const filteredDrives = useMemo(() => {
    return fsdFiltered.filter((d) => {
      if (valueFilter.invalid) return false;
      for (const predicate of valuePredicates) {
        const key = driveValueKey(driveColumnValue(d, predicate.column, fsdByDriveID, anomalyDriveIds, fsdDataAvailable));
        if (predicate.values.has(key) === predicate.excluded) return false;
      }
      if (desktopEvidence) {
        for (const key of ['start', 'destination'] as const) {
          const label = endpointLabel(key === 'start'
            ? { address: d.startAddress, lat: d.startLat, lon: d.startLon }
            : { address: d.endAddress, lat: d.endLat, lon: d.endLon });
          if (gridFilters[key].trim() && !label?.toLocaleLowerCase().includes(gridFilters[key].trim().toLocaleLowerCase())) return false;
        }
        const speed = driveAverageSpeed(d);
        const battery = driveBattery(d);
        const thresholds: Array<[DriveGridFilterKey, number | null]> = [
          ['distance', toDistanceDisplay(d.distanceM)],
          ['duration', d.durationS / 60],
          ['speed', speed != null ? toSpeedDisplay(speed) : null],
          ['maxSpeed', d.maxSpeedMps != null ? toSpeedDisplay(d.maxSpeedMps) : null],
          ['avgPower', d.avgPowerW != null ? convertPowerFromSI(d.avgPowerW, unitPrefs.power) : null],
          ['outsideTemp', d.outsideTempAvgC != null ? convertTempFromSI(d.outsideTempAvgC, unitPrefs.temperature) : null],
          ['insideTemp', d.insideTempAvgC != null ? convertTempFromSI(d.insideTempAvgC, unitPrefs.temperature) : null],
          ['battery', battery.end],
          ['startBattery', battery.start],
          ['batteryUsed', battery.used],
          ['energy', d.energyUsedWh != null ? d.energyUsedWh / 1000 : null],
          ['regen', d.regenEnergyWh != null ? d.regenEnergyWh / 1000 : null],
          ['score', d.score],
        ];
        if (thresholds.some(([key, value]) => {
          const raw = gridFilters[key];
          const signed = key === 'outsideTemp' || key === 'insideTemp' || key === 'avgPower' || key === 'batteryUsed';
          return raw !== '' && (!Number.isFinite(Number(raw)) || (!signed && Number(raw) < 0) || value == null || value < Number(raw));
        })) return false;
        if (gridFilters.grade && gradeFromEfficiency(getEfficiency(d)).label !== gridFilters.grade) return false;
      }
      if (searchTokens.length === 0) return true;
      return matchesTokens(d, searchTokens, {
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
          grade: (drive, token) => {
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
      });
    });
  }, [fsdFiltered, searchTokens, toDistanceDisplay, toSpeedDisplay, tz, desktopEvidence, gridFilters, unitPrefs.power, unitPrefs.temperature,
    valueFilter.invalid, valuePredicates, fsdByDriveID, fsdDataAvailable, anomalyDriveIds, fmtNumber]);

  /* ---- Sort ---- */
  const sortedDrives = useMemo(() => {
    const direction = effectiveSortDirection === 'asc' ? 1 : -1;
    const compare = (left: number | null | undefined, right: number | null | undefined) => {
      if (left == null) return right == null ? 0 : 1;
      if (right == null) return -1;
      return (left - right) * direction;
    };
    return [...filteredDrives].sort((a, b) => {
      switch (sortBy) {
        case 'distance': return compare(a.distanceM, b.distanceM);
        case 'duration': return compare(a.durationS, b.durationS);
        case 'speed': return compare(driveAverageSpeed(a), driveAverageSpeed(b));
        case 'maxSpeed': return compare(a.maxSpeedMps, b.maxSpeedMps);
        case 'avgPower': return compare(a.avgPowerW, b.avgPowerW);
        case 'outsideTemp': return compare(a.outsideTempAvgC, b.outsideTempAvgC);
        case 'insideTemp': return compare(a.insideTempAvgC, b.insideTempAvgC);
        case 'regen': return compare(a.regenEnergyWh, b.regenEnergyWh);
        case 'score': return compare(a.score, b.score);
        case 'startBattery': return compare(driveBattery(a).start, driveBattery(b).start);
        case 'batteryUsed': return compare(driveBattery(a).used, driveBattery(b).used);
        case 'battery': return compare(driveBattery(a).end, driveBattery(b).end);
        case 'cost':
        case 'energy': return compare(a.energyUsedWh, b.energyUsedWh);
        case 'grade':
        case 'efficiency': return compare(getEfficiency(a), getEfficiency(b));
        case 'start':
        case 'destination':
        case 'route': {
          const route = (drive: Drive) => [
            sortBy !== 'destination' ? endpointLabel({ address: drive.startAddress, lat: drive.startLat, lon: drive.startLon }) : null,
            sortBy !== 'start' ? endpointLabel({ address: drive.endAddress, lat: drive.endLat, lon: drive.endLon }) : null,
          ].filter(Boolean).join(' → ');
          const left = route(a);
          const right = route(b);
          if (!left) return !right ? 0 : 1;
          if (!right) return -1;
          return left.localeCompare(right, undefined, { numeric: true }) * direction;
        }
        case 'fsd': {
          const left = fsdByDriveID.get(a.id);
          const right = fsdByDriveID.get(b.id);
          const shareDifference = compare(left?.fsd_share_pct, right?.fsd_share_pct);
          return shareDifference || compare(left?.fsd_distance_m, right?.fsd_distance_m);
        }
        default: return (a.startTs ?? '').localeCompare(b.startTs ?? '') * direction;
      }
    });
  }, [filteredDrives, fsdByDriveID, sortBy, effectiveSortDirection]);

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
    const raw: Array<{
      dateKey: string;
      labelDayKey: string;
      items: Drive[];
    }> = sortBy === 'date'
      ? groupByDate(paginatedDrives, (d) => localDayKey(d.startTs, tz))
        .map((group) => ({ ...group, labelDayKey: group.dateKey }))
      : paginatedDrives.flatMap((drive) => {
        const labelDayKey = localDayKey(drive.startTs, tz);
        if (!labelDayKey) return [];
        return [{
          // Non-date sorts must preserve global item order. One group per
          // drive avoids a same-day group pulling a lower-ranked item ahead
          // of higher-ranked drives from another day.
          dateKey: `${labelDayKey}--drive-${drive.id}`,
          labelDayKey,
          items: [drive],
        }];
      });
    return raw.map((g) => {
      const distM = g.items.reduce((s, d) => s + (d.distanceM ?? 0), 0);
      const distDisplay = fmtNumber(toDistanceDisplay(distM));
      const noun = g.items.length === 1
        ? t('bulk.noun.drive_one', 'drive')
        : t('bulk.noun.drive_other', 'drives');
      return {
        dateKey: g.dateKey,
        dateLabel: formatDayKey(g.labelDayKey, { style: 'long' }),
        // Compare the vehicle-local YMD key with "today" in that same zone.
        relativeLabel: formatRelativeDayKey(g.labelDayKey, { tz }),
        summary: `${g.items.length} ${noun} · ${distDisplay} ${distanceUnit}`,
        items: g.items,
      };
    });
  }, [paginatedDrives, sortBy, toDistanceDisplay, distanceUnit, t, tz, fmtNumber]);

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
    { key: 'drives',     label: t('drives.metric.drives', 'Drives'),         chart: 'bar',  color: '#0891b2', accent: 'cyan',
      formatValue: (v) => fmtInt(v),
      formatTick: (v) => fmtInt(v) },
    { key: 'distance',   label: t('drives.metric.distance', 'Distance'),     chart: 'bar',  color: '#10b981', accent: 'green',
      getValue: (p) => toDistanceDisplay(p.value),
      formatValue: (v) => `${fmtNumber(v)} ${distanceUnit}`,
      formatTick: (v) => fmtNumber(v) },
    { key: 'score',      label: t('drives.metric.grade', 'Efficiency grade'), chart: 'line', color: '#a855f7', accent: 'purple',
      formatValue: (v) => gradeFromNumeric(v).label,
      // Numeric ticks for the score axis — letter grades on the axis
      // would make every tick read "B" / "C" / "—", obscuring the trend.
      formatTick: (v) => fmtNumber(v) },
    { key: 'efficiency', label: t('drives.metric.efficiency', 'Efficiency'), chart: 'line', color: '#f59e0b', accent: 'amber',
      getValue: (p) => toEfficiencyDisplay(p.value),
      formatValue: (v) => `${fmtInt(v)} ${efficiencyUnit}`,
      formatTick: (v) => fmtInt(v) },
    { key: 'cost',       label: t('drives.metric.cost', 'Cost'),             chart: 'bar',  color: '#ef4444', accent: 'red',
      getValue: (p) => costPerKwh != null ? (p.value / 1_000) * costPerKwh : null,
      formatValue: (v) => formatCurrency(v),
      // Compact axis label so the Y-axis doesn't show "$0.0833" on each tick.
      formatTick: (v) => formatCurrency(v) },
  ], [t, toDistanceDisplay, toEfficiencyDisplay, distanceUnit, efficiencyUnit, costPerKwh, formatCurrency, fmtInt, fmtNumber]);

  /** X-axis tick formatter for the trend chart — render `2026-04-24` as
 * "Apr 24" using the vehicle's tz so the axis label matches the row
 * date headers below. */
  const formatChartXTick = useCallback(
    (key: string) => formatDayKey(key, { style: 'short' }),
    [],
  );

  return {
    sortBy, effectiveSortDirection, setPage, pageSize, search, density,
    collection, fsdFilter, trendMetric, setTrendMetric, setUrlBatch,
    valueFilter, hasValueFilters, gridFilters, changeGridFilter,
    clearValueFilter, sortGrid, dateFilteredDrives, currentStats, priorStats,
    anomalyDrives, anomalyDriveIds, changeValueSelection, notableDrives,
    commuteDrives, filteredDrives, sortedDrives, safePage, paginatedDrives,
    groupedDrives, trendSeries, trendMetricsConfig, formatChartXTick, tableControls,
  };
}
