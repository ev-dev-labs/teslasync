import { useMemo, useState, useCallback, useEffect, useDeferredValue } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Zap, AlertTriangle, Star, Plug, Sun, Tag, List as ListIcon,
  Trash2, Battery, Home, Bolt,
  Activity, Bell, Car, MapPin, Route, Wrench,
} from 'lucide-react';
import { PageContainer } from '@/components/layout';
import { PageHeaderSticky } from '@/components/layout/PageHeaderSticky';
import { Badge, GlassPanel, Pagination, SectionTitle, Text } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { StaggerContainer } from '@/components/motion/StaggerContainer';
import { StaggerItem } from '@/components/motion/StaggerItem';
import { DataStateNotice, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { EmptyStateGuidanceDetails } from '@/components/feedback/ActionableEmptyState';
import { EmptyState } from '@/components/feedback/EmptyState';
import { EmptyStateThreshold } from '@/components/feedback/EmptyStateThreshold';
import { InlineCallout } from '@/components/feedback/InlineCallout';
import { Skeleton } from '@/components/feedback/Skeleton';
import { RangePicker, VehicleSelect, PillFilterBar, type PillItem } from '@/components/forms';
import { SearchInput } from '@/components/forms/SearchInput';
import { FilterBar } from '@/components/forms/FilterBar';
import { ActiveFilterChips, type FilterChipDescriptor } from '@/components/forms/ActiveFilterChips';
import { DensityToggle, type Density } from '@/components/forms/DensityToggle';
import { SortControl, type SortDirection } from '@/components/forms/SortControl';
import { ListExportMenu } from '@/components/forms/ListExportMenu';
import {
  SavedViewMenu,
  KpiOverviewCard, MetricCard, DateGroupedList, type DateGroupedListGroup,
  BulkActionsToolbar, DataFreshnessAuto, OperationalBrief, type BulkAction,
  EntityPreviewDrawer, type OperationalAttention,
} from '@/components/data-display';
import { MetricSwitcherChart, type MetricSwitcherMetric } from '@/components/charts';
import { useSavedViewUrl } from '@/hooks/useSavedViewUrl';
import { useUrlBatch, useUrlBoolean, useUrlEnum, useUrlNumber, useUrlString } from '@/hooks/useUrlState';
import { useRangeState } from '@/hooks/useRangeState';
import { parseSearchQuery, matchesTokens, compareNumeric, parseDurationToken, matchesYmdPrefix } from '@/lib/searchQuery';
import { useChargingSessionsPaginated, useChargingOptimizer, useBulkDeleteCharging } from '@/api/hooks/useCharging';
import { useVehicleState } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useTimezone } from '@/lib/timezone';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { PullToRefresh } from '@/components/mobile';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { formatDateTime, formatDayKey, formatDurationMinutes, formatRelativeDays } from '@/lib/dateFormat';
import { matchPresetId, getDatePreset } from '@/lib/datePresets';
import { fmtNumber, fmtInt, fmtCompact } from '@/lib/numberFormat';
import { buildContextHref } from '@/lib/contextNavigation';
import type { ChargingSession } from '@/api/types';
import type { OperationalNarrative } from '@/types/operationalNarrative';
import { ChargingSessionCard } from '../components/ChargingSessionCard';
import {
  computeChargingPeriodStats, priorPeriod, detectChargingAnomalies,
  detectNotableSessions, dailyChargingTrend, getChargerCategory,
  durationMinutes, avgPowerW, localDayKey,
  type ChargingTrendMetric, type ChargingPeriodStats, type ChargingAnomaly,
} from '@/lib/chargingAggregation';
import {
  AcDcStatsPanel,
  BatteryLevelChart,
  ChargeRatePanel,
  ChargerSpecsPanel,
  OptimizerSection,
  computeAcDcBreakdown,
  computeStartLevelDist,
  computeChargeRateStats,
  computeChargerSpecs,
} from '../components/charging-list';

/* ----------------------------------------------------------------*/
/*  URL allowlists */
/* ----------------------------------------------------------------*/

const COLLECTIONS = ['all', 'home', 'supercharger', 'dc', 'free', 'anomalies', 'notable', 'tagged'] as const;
type Collection = typeof COLLECTIONS[number];
const TREND_METRICS = ['sessions', 'energy', 'cost', 'power'] as const;
const SORT_FIELDS = ['date', 'energy', 'cost', 'duration', 'power'] as const;
type SortField = typeof SORT_FIELDS[number];
const DENSITY_VALUES = ['compact', 'comfortable'] as const;

/* ----------------------------------------------------------------*/
/*  Thresholds for conditional sections */
/* ----------------------------------------------------------------*/
const THRESHOLD_OPTIMIZER = 10;
const THRESHOLD_SPECS = 5;
const THRESHOLD_BATTERY_DIST = 5;
const THRESHOLD_AC_DC = 1;

export default function ChargingListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  usePageTitle(t('charging.list.title', 'Charging Sessions'));
  const savedView = useSavedViewUrl();

  /* ── Data ─────────────────────────────────────────────────────── */
  const { vehicleId } = useSelectedVehicle();
  const tz = useTimezone('vehicle');
  const { unitPrefs, formatEnergy } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const toDistanceDisplay = useCallback(
    (meters: number) => convertDistanceFromSI(meters, unitPrefs.distance),
    [unitPrefs.distance],
  );
  const { formatCurrency, currencySymbol } = useFormatting();

  /* ── URL state ───────────────────────────────────────────────── */
  const {
    start: startDate,
    end: endDate,
    setRangeWithUrlUpdates,
  } = useRangeState({
    persistKey: 'charging.list.range',
  });
  const [search] = useUrlString('q', '');
  const [collection] = useUrlEnum<Collection>('coll', COLLECTIONS, 'all');
  const [trendMetric, setTrendMetric] = useUrlEnum<ChargingTrendMetric>('trend', TREND_METRICS, 'sessions');
  const [sortBy, setSortBy] = useUrlEnum<SortField>('sort', SORT_FIELDS, 'date');
  const [sortDesc, setSortDesc] = useUrlBoolean('sort_desc', true);
  const [density, setDensity] = useUrlEnum<Density>('density', DENSITY_VALUES, 'comfortable');
  const [page, setPage] = useUrlNumber('page', 1);
  const [pageSize] = useUrlNumber('size', 50);
  const setUrlBatch = useUrlBatch();

  /* ── Source query ────────────────────────────────────────────── */
  const chargingQuery = useChargingSessionsPaginated(vehicleId, {
    limit: 500,                 // Page-side pagination — fetch a wide window so client filters work
    offset: 0,
    start: startDate,
    end: endDate,
  });
  const { data: sessions, isLoading, error, refetch } = chargingQuery;
  /* Retained sessions survive a failed background refresh: only an initial
   * failure (nothing cached) is allowed to replace the list with an error. */
  const chargingState = useDataState(chargingQuery);
  const vehicleStateQuery = useVehicleState(vehicleId ?? 0);
  const liveState = vehicleStateQuery.data?.state;
  const [previewSession, setPreviewSession] = useState<ChargingSession | null>(null);
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : null;
  const { data: optimizer } = useChargingOptimizer(vehicleIdStr);

  /* ── Date filter (vehicle-tz day buckets) ────────────────────── */
  const dateFilteredSessions = useMemo(() => {
    if (!sessions) return [];
    return sessions.filter((s) => {
      const day = localDayKey(s.started_at, tz);
      if (!day) return true;
      if (startDate && day < startDate) return false;
      if (endDate && day > endDate) return false;
      return true;
    });
  }, [sessions, startDate, endDate, tz]);

  /* ── Period stats (current + prior comparison) ───────────────── */
  const currentStats = useMemo<ChargingPeriodStats>(
    () => computeChargingPeriodStats(dateFilteredSessions, undefined, undefined, tz),
    [dateFilteredSessions, tz],
  );
  const priorRange = useMemo(() => priorPeriod(startDate, endDate), [startDate, endDate]);
  const priorStats = useMemo<ChargingPeriodStats | null>(
    () => priorRange && sessions
      ? computeChargingPeriodStats(sessions, priorRange.start, priorRange.end, tz)
      : null,
    [sessions, priorRange, tz],
  );

  /* ── Collection counts (computed BEFORE filter) ──────────────── */
  const anomalies = useMemo(
    () => detectChargingAnomalies(dateFilteredSessions, undefined, currencySymbol),
    [dateFilteredSessions, currencySymbol],
  );
  const anomalyById = useMemo(() => {
    const m = new Map<number, ChargingAnomaly>();
    for (const a of anomalies) m.set(a.session.id, a);
    return m;
  }, [anomalies]);
  const notable = useMemo(() => detectNotableSessions(dateFilteredSessions), [dateFilteredSessions]);
  const homeSessions = useMemo(
    () => dateFilteredSessions.filter((s) => getChargerCategory(s.charger_type) === 'home'),
    [dateFilteredSessions],
  );
  const scSessions = useMemo(
    () => dateFilteredSessions.filter((s) => getChargerCategory(s.charger_type) === 'supercharger'),
    [dateFilteredSessions],
  );
  const dcSessions = useMemo(
    () => dateFilteredSessions.filter((s) => getChargerCategory(s.charger_type) === 'dc'),
    [dateFilteredSessions],
  );
  const freeSessions = useMemo(
    () => dateFilteredSessions.filter((s) => s.cost_decimal == null || s.cost_decimal === 0),
    [dateFilteredSessions],
  );

  /* ── Apply collection filter ─────────────────────────────────── */
  const collectionFiltered = useMemo(() => {
    switch (collection) {
      case 'home':         return homeSessions;
      case 'supercharger': return scSessions;
      case 'dc':           return dcSessions;
      case 'free':         return freeSessions;
      case 'anomalies':    return anomalies.map((a) => a.session);
      case 'notable':      return notable;
      case 'tagged':       return [];
      case 'all':
      default:             return dateFilteredSessions;
    }
  }, [collection, dateFilteredSessions, homeSessions, scSessions, dcSessions, freeSessions, anomalies, notable]);

  /* ── Search filter (with structured kv tokens) ───────────────── */
  const deferredSearch = useDeferredValue(search);
  const isSearchPending = !Object.is(search, deferredSearch);
  const searchTokens = useMemo(() => parseSearchQuery(deferredSearch), [deferredSearch]);
  const filteredSessions = useMemo(() => {
    if (searchTokens.length === 0) return collectionFiltered;
    return collectionFiltered.filter((s) =>
      matchesTokens(s, searchTokens, {
        text: (sess) => [
          sess.start_place,
          sess.charger_type,
          fmtNumber(sess.total_energy_added_wh / 1000),
          sess.cost_decimal != null ? fmtNumber(sess.cost_decimal) : null,
        ],
        kv: {
          // charger:home | charger:supercharger | charger:dc
          charger: (sess, token) => {
            const want = token.value.trim().toLowerCase();
            const got = getChargerCategory(sess.charger_type);
            if (want === 'sc') return got === 'supercharger';
            return got === want;
          },
          // cost:>5 | cost:=0 | cost:<10
          cost: (sess, token) => {
            const target = Number(token.value);
            if (!Number.isFinite(target)) return null;
            return compareNumeric(sess.cost_decimal ?? 0, token.op, target);
          },
          // kwh:>20
          kwh: (sess, token) => {
            const target = Number(token.value);
            if (!Number.isFinite(target)) return null;
            return compareNumeric(sess.total_energy_added_wh / 1000, token.op, target);
          },
          // power:>50 (peak power in kW)
          power: (sess, token) => {
            const target = Number(token.value);
            if (!Number.isFinite(target)) return null;
            const peak = (sess.peak_power_w ?? 0) / 1000;
            return compareNumeric(peak, token.op, target);
          },
          // dur:>1h | dur:30m | dur:>2d
          dur: (sess, token) => {
            const target = parseDurationToken(token.value);
            if (target == null) return null;
            return compareNumeric(durationMinutes(sess), token.op, target);
          },
          // in:2025 | in:2025-04 | in:2025-04-15
          in: (sess, token) => {
            const day = localDayKey(sess.started_at, tz);
            return matchesYmdPrefix(day, token.value.trim());
          },
          // at:Home (substring against start_place)
          at: (sess, token) => {
            const want = token.value.trim().toLowerCase();
            const place = (sess.start_place ?? '').toLowerCase();
            return place.includes(want);
          },
          // free (bare keyword treated as kv `free:` with empty value)
          free: (sess) => sess.cost_decimal == null || sess.cost_decimal === 0,
        },
      }),
    );
  }, [collectionFiltered, searchTokens, tz]);

  /* ── Sort ────────────────────────────────────────────────────── */
  const sortedSessions = useMemo(() => {
    const arr = [...filteredSessions];
    const cmp = (a: ChargingSession, b: ChargingSession): number => {
      switch (sortBy) {
        case 'energy':   return a.total_energy_added_wh - b.total_energy_added_wh;
        case 'cost':     return (a.cost_decimal ?? 0) - (b.cost_decimal ?? 0);
        case 'duration': return durationMinutes(a) - durationMinutes(b);
        case 'power':    return avgPowerW(a) - avgPowerW(b);
        case 'date':
        default:         return (a.started_at ?? '').localeCompare(b.started_at ?? '');
      }
    };
    arr.sort(cmp);
    if (sortDesc) arr.reverse();
    return arr;
  }, [filteredSessions, sortBy, sortDesc]);

  /* ── Pagination ──────────────────────────────────────────────── */
  const paginatedSessions = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedSessions.slice(start, start + pageSize);
  }, [sortedSessions, page, pageSize]);

  /* ── Date-grouped view of the paginated list ─────────────────── */
  const groupedSessions = useMemo<DateGroupedListGroup<ChargingSession>[]>(() => {
    const buckets = new Map<string, ChargingSession[]>();
    for (const s of paginatedSessions) {
      const key = localDayKey(s.started_at, tz);
      if (!key) continue;
      const list = buckets.get(key) ?? [];
      list.push(s);
      buckets.set(key, list);
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => (sortDesc ? b.localeCompare(a) : a.localeCompare(b)))
      .map(([dateKey, items]) => {
        const totalEnergy = items.reduce((acc, s) => acc + s.total_energy_added_wh, 0) / 1000;
        const noun = items.length === 1
          ? t('bulk.noun.session_one', 'session')
          : t('bulk.noun.session_other', 'sessions');
        return {
          dateKey,
          dateLabel: formatDayKey(dateKey, { style: 'long' }),
          relativeLabel: formatRelativeDays(`${dateKey}T12:00:00Z`, { tz: 'UTC' }),
          summary: `${items.length} ${noun} · ${fmtNumber(totalEnergy)} kWh`,
          items,
        };
      });
  }, [paginatedSessions, t, tz, sortDesc]);

  /* ── Trend chart series ──────────────────────────────────────── */
  const trendSeries = useMemo(() => ({
    sessions: dailyChargingTrend(dateFilteredSessions, 'sessions', tz),
    energy:   dailyChargingTrend(dateFilteredSessions, 'energy', tz),
    cost:     dailyChargingTrend(dateFilteredSessions, 'cost', tz),
    power:    dailyChargingTrend(dateFilteredSessions, 'power', tz),
  } satisfies Record<ChargingTrendMetric, ReturnType<typeof dailyChargingTrend>>), [dateFilteredSessions, tz]);

  const trendMetricsConfig: MetricSwitcherMetric<{ date: string; value: number }>[] = useMemo(() => [
    { key: 'sessions', label: t('charging.metric.sessions', 'Sessions'), chart: 'bar', color: '#10b981', accent: 'green',
      formatValue: (v) => fmtInt(v), formatTick: (v) => fmtInt(v) },
    { key: 'energy', label: t('charging.metric.energy', 'Energy'), chart: 'bar', color: '#06b6d4', accent: 'cyan',
      formatValue: (v) => `${fmtNumber(v)} kWh`, formatTick: (v) => fmtNumber(v) },
    { key: 'cost', label: t('charging.metric.cost', 'Cost'), chart: 'bar', color: '#ef4444', accent: 'red',
      formatValue: (v) => formatCurrency(v), formatTick: (v) => formatCurrency(v, 0) },
    { key: 'power', label: t('charging.metric.power', 'Avg power'), chart: 'line', color: '#a855f7', accent: 'purple',
      formatValue: (v) => `${fmtNumber(v)} kW`, formatTick: (v) => fmtNumber(v, 0) },
  ], [t, formatCurrency]);

  const formatChartXTick = useCallback(
    (key: string) => formatDayKey(key, { style: 'short' }),
    [],
  );

  /* ── Bulk selection ──────────────────────────────────────────── */
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set());
  useEffect(() => {
    setBulkSelected(prev => {
      if (prev.size === 0) return prev;
      const visible = new Set(filteredSessions.map(s => s.id));
      const next = new Set<number>();
      prev.forEach(id => { if (visible.has(id)) next.add(id); });
      return next.size === prev.size ? prev : next;
    });
  }, [filteredSessions]);
  const toggleSessionSelected = useCallback((id: number, on: boolean) => {
    setBulkSelected(prev => {
      const n = new Set(prev);
      if (on) n.add(id); else n.delete(id);
      return n;
    });
  }, []);
  const clearBulk = useCallback(() => setBulkSelected(new Set()), []);
  const bulkDeleteMut = useBulkDeleteCharging();
  const bulkActions = useMemo<BulkAction[]>(() => [
    {
      id: 'delete',
      label: t('bulk.actions.delete', 'Delete'),
      icon: <Trash2 className="h-3.5 w-3.5" />,
      variant: 'danger',
      confirm: {
        title: t('bulk.deleteConfirmTitle', 'Delete {{count}} {{noun}}?', {
          count: bulkSelected.size,
          noun: bulkSelected.size === 1
            ? t('bulk.noun.session_one', 'session')
            : t('bulk.noun.session_other', 'sessions'),
        }),
        description: t('bulk.deleteConfirmDescription', 'This cannot be undone.'),
        confirmLabel: t('common.delete', 'Delete'),
      },
      onClick: async (ids) => {
        await bulkDeleteMut.mutateAsync(ids.map(Number));
        clearBulk();
      },
    },
  ], [t, bulkSelected.size, bulkDeleteMut, clearBulk]);

  /* ── Export ──────────────────────────────────────────────────── */
  const exportRows = useCallback((scope: 'visible' | 'selected'): ChargingSession[] => {
    if (scope === 'selected') return sortedSessions.filter((s) => bulkSelected.has(s.id));
    return sortedSessions;
  }, [sortedSessions, bulkSelected]);
  const triggerDownload = useCallback((content: string, mime: string, ext: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `teslasync-charging-${startDate}-to-${endDate}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [startDate, endDate]);
  const handleExportCsv = useCallback((scope: 'visible' | 'selected') => {
    const rows = exportRows(scope);
    const header = ['id', 'started_at', 'ended_at', 'charger_type', 'kwh', 'cost', 'duration_min', 'avg_kw', 'peak_kw', 'start_place'];
    const lines = [header.join(',')];
    for (const s of rows) {
      const fields: (string | number)[] = [
        s.id,
        s.started_at,
        s.ended_at ?? '',
        s.charger_type ?? '',
        (s.total_energy_added_wh / 1000).toFixed(3),
        s.cost_decimal ?? '',
        durationMinutes(s).toFixed(1),
        (avgPowerW(s) / 1000).toFixed(2),
        ((s.peak_power_w ?? 0) / 1000).toFixed(2),
        (s.start_place ?? '').replace(/"/g, '""'),
      ];
      lines.push(fields.map((v) => {
        const str = String(v);
        return /[,"\n]/.test(str) ? `"${str}"` : str;
      }).join(','));
    }
    triggerDownload(lines.join('\n'), 'text/csv', 'csv');
  }, [exportRows, triggerDownload]);
  const handleExportJson = useCallback((scope: 'visible' | 'selected') => {
    const rows = exportRows(scope);
    triggerDownload(JSON.stringify(rows, null, 2), 'application/json', 'json');
  }, [exportRows, triggerDownload]);

  /* ── Period labels ───────────────────────────────────────────── */
  const datePresetId = useMemo(() => matchPresetId(startDate, endDate), [startDate, endDate]);
  const datePreset = datePresetId ? getDatePreset(datePresetId) : undefined;
  const datePresetLabel = datePreset ? t(datePreset.i18nKey, datePreset.fallback) : null;
  const formattedRange = `${formatDayKey(startDate, { style: 'long' })} – ${formatDayKey(endDate, { style: 'long' })}`;
  const periodLabel = datePresetLabel ? `${datePresetLabel} · ${formattedRange}` : formattedRange;
  const priorHasData = priorStats != null && priorStats.count > 0;
  const priorLabel: string | undefined = priorHasData && priorRange
    ? t('charging.priorPeriod', 'prior period: {{start}} – {{end}}', {
        start: formatDayKey(priorRange.start, { style: 'long' }),
        end: formatDayKey(priorRange.end, { style: 'long' }),
      })
    : priorRange
      ? t('charging.noPriorData', 'No charging in prior period: {{start}} – {{end}}', {
          start: formatDayKey(priorRange.start, { style: 'long' }),
          end: formatDayKey(priorRange.end, { style: 'long' }),
        })
      : undefined;

  /* ── Anomaly callout ─────────────────────────────────────────── */
  const anomalyFooter = anomalies.length > 0 && collection !== 'anomalies' ? (
    <InlineCallout
      variant="warning"
      icon={<AlertTriangle className="h-3.5 w-3.5" />}
      action={{
        label: t('charging.viewAnomalies', 'View anomalies'),
        onClick: () => setUrlBatch({ coll: 'anomalies', page: null }),
      }}
    >
      {t('charging.anomalyCount', '{{count}} {{noun}} in this range', {
        count: anomalies.length,
        noun: anomalies.length === 1
          ? t('charging.anomaly_one', 'anomaly')
          : t('charging.anomaly_other', 'anomalies'),
      })}
    </InlineCallout>
  ) : null;

  /* ── Secondary line ──────────────────────────────────────────── */
  const secondaryLine = currentStats.count > 0 ? (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>
        {t('charging.byType', '{{home}} home · {{sc}} SC · {{dc}} DC', {
          home: currentStats.byCategory.home,
          sc: currentStats.byCategory.supercharger,
          dc: currentStats.byCategory.dc,
        })}
      </span>
      <span className="opacity-50">·</span>
      <span>{t('charging.freeCount', '{{count}} free', { count: currentStats.freeCount })}</span>
      {currentStats.batteryFriendlyScore != null && (
        <>
          <span className="opacity-50">·</span>
          <span>
            {t('charging.batteryScore', 'Battery score')}{' '}
            <Text as="span" weight="semibold" style={{ color: currentStats.batteryFriendlyGrade.color }}>
              {currentStats.batteryFriendlyGrade.label}
            </Text>
          </span>
        </>
      )}
      {currentStats.mostCommonStartHour != null && (
        <>
          <span className="opacity-50">·</span>
          <span>
            {t('charging.mostCommon', 'Most common start: {{hour}}', {
              hour: formatHour(currentStats.mostCommonStartHour),
            })}
          </span>
        </>
      )}
    </span>
  ) : null;

  /* ── Collection pills ────────────────────────────────────────── */
  const collectionPills: PillItem[] = useMemo(() => [
    { key: 'all',          label: t('charging.coll.all', 'All'),                count: dateFilteredSessions.length, accent: 'cyan',   icon: <ListIcon className="h-3 w-3" /> },
    { key: 'home',         label: t('charging.coll.home', 'Home'),              count: homeSessions.length,         accent: 'green',  icon: <Home className="h-3 w-3" /> },
    { key: 'supercharger', label: t('charging.coll.supercharger', 'Supercharger'), count: scSessions.length,        accent: 'red',    icon: <Bolt className="h-3 w-3" /> },
    { key: 'dc',           label: t('charging.coll.dc', 'DC Fast'),             count: dcSessions.length,           accent: 'amber',  icon: <Zap className="h-3 w-3" /> },
    { key: 'free',         label: t('charging.coll.free', 'Free'),              count: freeSessions.length,         accent: 'green',  icon: <Sun className="h-3 w-3" /> },
    { key: 'anomalies',    label: t('charging.coll.anomalies', 'Anomalies'),    count: anomalies.length,            accent: 'red',    icon: <AlertTriangle className="h-3 w-3" /> },
    { key: 'notable',      label: t('charging.coll.notable', 'Notable'),        count: notable.length,              accent: 'purple', icon: <Star className="h-3 w-3" /> },
    { key: 'tagged',       label: t('charging.coll.tagged', 'Tagged'),          count: 0,                           accent: 'blue',   icon: <Tag className="h-3 w-3" />, disabled: true },
  ], [t, dateFilteredSessions.length, homeSessions.length, scSessions.length, dcSessions.length, freeSessions.length, anomalies.length, notable.length]);

  const collectionLabel = collectionPills.find((p) => p.key === collection)?.label ?? 'All';

  /* ── Sticky summary ──────────────────────────────────────────── */
  const stickySummary = (
    <>
      <Text as="span" color="secondary" className="truncate">
        {t('charging.list.title', 'Charging Sessions')}
      </Text>
      <span className="opacity-50">·</span>
      <span className="truncate">{periodLabel}</span>
      <span className="opacity-50">·</span>
      <Text as="span" color="primary" weight="medium">{collectionLabel}</Text>
      <span className="opacity-50">·</span>
      <span>{fmtCompact(filteredSessions.length)} {t('charging.results', 'results')}</span>
      {currentStats.batteryFriendlyGrade.label !== '—' && (
        <>
          <span className="opacity-50">·</span>
          <span>{t('charging.avgScore', 'avg')}{' '}
            <Text as="span" weight="semibold" style={{ color: currentStats.batteryFriendlyGrade.color }}>
              {currentStats.batteryFriendlyGrade.label}
            </Text>
          </span>
        </>
      )}
    </>
  );

  /* ── Sort options ────────────────────────────────────────────── */
  const sortOptions = useMemo(() => [
    { value: 'date' as const,     label: t('charging.sort.date', 'Date') },
    { value: 'energy' as const,   label: t('charging.sort.energy', 'Energy') },
    { value: 'cost' as const,     label: t('charging.sort.cost', 'Cost') },
    { value: 'duration' as const, label: t('charging.sort.duration', 'Duration') },
    { value: 'power' as const,    label: t('charging.sort.power', 'Power') },
  ], [t]);

  /* ── Conditional sections ─ pre-computed inputs ──────────────── */
  const acDcBreakdown = useMemo(() => sessions ? computeAcDcBreakdown(sessions) : null, [sessions]);
  const startLevelDist = useMemo(() => sessions ? computeStartLevelDist(sessions) : [], [sessions]);
  const chargeRateStats = useMemo(() => sessions ? computeChargeRateStats(sessions) : null, [sessions]);
  const chargerSpecs = useMemo(() => sessions ? computeChargerSpecs(sessions) : null, [sessions]);
  const interruptionAnomalies = anomalies.filter(
    (anomaly) => anomaly.kind === 'telemetry_gap' || anomaly.kind === 'bad_power',
  );
  const reliabilityAnomalies = anomalies.filter(
    (anomaly) =>
      anomaly.kind === 'telemetry_gap'
      || anomaly.kind === 'bad_power'
      || anomaly.kind === 'trickle',
  );
  const reliabilityIssueSessions = new Set(
    reliabilityAnomalies.map((anomaly) => anomaly.session.id),
  ).size;
  const reliabilityPct = currentStats.count > 0
    ? Math.max(0, Math.round(
        ((currentStats.count - reliabilityIssueSessions) / currentStats.count) * 100,
      ))
    : null;
  const blendedCostPerKwh = currentStats.totalEnergyWh > 0
    ? currentStats.totalCost / (currentStats.totalEnergyWh / 1000)
    : null;
  const isChargingNow = liveState?.is_charging === true;
  const departureBatteryPct = liveState?.battery_level;
  const timeToTarget = isChargingNow && (liveState?.time_to_full_charge ?? 0) > 0
    ? formatDurationMinutes((liveState?.time_to_full_charge ?? 0) * 60)
    : null;
  const chargingAttention: OperationalAttention[] = [
    ...(liveState && !isChargingNow && liveState.battery_level < 20
      ? [{
          key: 'departure-readiness',
          title: t(
            'operations.charging.departureAttentionTitle',
            'Departure charge is below 20%',
          ),
          description: t(
            'operations.charging.departureAttentionDescription',
            'Charge before the next departure or confirm that the planned route is within the available range.',
          ),
          tone: 'danger' as const,
        }]
      : []),
    ...anomalies.slice(0, 4).map((anomaly): OperationalAttention => ({
        key: `charging-${anomaly.session.id}-${anomaly.kind}`,
        title: anomaly.message,
        description: t(
          'operations.charging.anomalyDescription',
          'Review the session evidence and charger conditions before the pattern repeats.',
        ),
        tone: anomaly.kind === 'telemetry_gap' || anomaly.kind === 'bad_power'
          ? 'danger'
          : 'warning',
      })),
    ...(currentStats.count === 0
      ? [{
          key: 'charging-empty',
          title: t('operations.charging.noDataTitle', 'No charging activity in this window'),
          description: t(
            'operations.charging.noDataDescription',
            'Choose a wider analysis window or complete a charging session.',
          ),
          tone: 'info' as const,
        }]
      : []),
  ];
  const narrativeEvidence: OperationalNarrative['evidence'] = (
    anomalies.length > 0 ? anomalies.map((anomaly) => anomaly.session) : dateFilteredSessions
  )
    .slice(0, 5)
    .map((session) => {
      const anomaly = anomalyById.get(session.id);
      return {
        id: `charging-session-${session.id}`,
        summary:
          anomaly?.message
          ?? t(
            'operations.charging.narrative.sessionSummary',
            '{{date}}: {{energy}} added at {{place}}.',
            {
              date: session.started_at,
              energy: formatEnergy(session.total_energy_added_wh ?? 0),
              place:
                session.start_place
                ?? t('operations.charging.narrative.unknownPlace', 'an unrecorded location'),
            },
          ),
        observedAt: session.started_at,
        provenance: {
          source: t('operations.charging.sessionsSource', 'Charging sessions'),
          recordId: String(session.id),
          method: anomaly
            ? t(
                'operations.charging.narrative.anomalyMethod',
                'Session matched a deterministic telemetry, power, duration, or cost exception rule.',
              )
            : t(
                'operations.charging.narrative.sessionMethod',
                'Direct charging-session energy, time, and location record.',
              ),
        },
      };
    });
  const narrative: OperationalNarrative = {
    whatChanged: t(
      'operations.charging.narrative.whatChanged',
      '{{sessions}} sessions delivered {{energy}} in the selected window; {{exceptions}} require review.',
      {
        sessions: currentStats.count,
        energy: formatEnergy(currentStats.totalEnergyWh),
        exceptions: anomalies.length,
      },
    ),
    whyItMatters: t(
      'operations.charging.narrative.impact',
      'Current charge posture and repeated session exceptions affect departure readiness, cost visibility, and charger confidence.',
    ),
    confidence: {
      label:
        currentStats.count > 0 && !vehicleStateQuery.isError
          ? 'high'
          : currentStats.count > 0 || liveState != null
            ? 'medium'
            : 'low',
      score: null,
      basis: [
        t(
          'operations.charging.narrative.sessionBasis',
          '{{count}} sessions were evaluated in the active period.',
          { count: currentStats.count },
        ),
        vehicleStateQuery.isError
          ? t(
              'operations.charging.narrative.liveLimitedBasis',
              'Live charging and battery state could not be resolved.',
            )
          : t(
              'operations.charging.narrative.liveBasis',
              'Current charging and battery state comes from the live vehicle-state record.',
            ),
      ],
    },
    likelyCause: null,
    recommendedResponse:
      chargingAttention[0]?.description
      ?? t(
        'operations.charging.narrative.monitorResponse',
        'No immediate response is indicated; continue monitoring departure readiness and session exceptions.',
      ),
    limitations: [
      t(
        'operations.charging.efficiencyNotMeasuredDetail',
        'Independent wall-input and battery-retained energy are not present in the session contract; delivery rate is shown below instead.',
      ),
      t(
        'operations.charging.narrative.reliabilityLimitation',
        'The clear-session ratio is an exception heuristic, not a charger-uptime service level.',
      ),
      ...(vehicleStateQuery.isError
        ? [
            t(
              'operations.charging.narrative.liveLimitation',
              'Departure readiness is incomplete while live vehicle state is unavailable.',
            ),
          ]
        : []),
      t(
        'operations.charging.narrative.causeLimitation',
        'Session patterns do not establish whether the vehicle, charger, site, or network caused an exception.',
      ),
    ],
    evidence: narrativeEvidence,
    provenance: [
      {
        source: t('operations.charging.liveStateSource', 'Live vehicle state'),
        method: t(
          'operations.charging.narrative.liveMethod',
          'Provides current battery level, charging state, and estimated time to target.',
        ),
      },
      {
        source: t('operations.charging.sessionsSource', 'Charging sessions'),
        method: t(
          'operations.charging.narrative.historyMethod',
          'Evaluates recorded sessions for energy, cost, duration, power, and telemetry exceptions.',
        ),
      },
    ],
  };

  /* ── Defensive: no vehicle ──────────────────────────────────── */
  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('charging.list.title', 'Charging Sessions')} />;
  }

  const previewFrom = localDayKey(previewSession?.started_at, tz);
  const previewTo = localDayKey(
    previewSession?.ended_at ?? previewSession?.started_at,
    tz,
  ) ?? previewFrom;

  return (
    <PageContainer
      title={t('charging.list.title', 'Charging Sessions')}
      subtitle={t(
        'charging.list.subtitle',
        'Live readiness, cost exposure, charger behavior, and charging history',
      )}
      copyLink
      query={[chargingQuery, vehicleStateQuery]}
      contextActions={
        <>
          <VehicleSelect />
          <RangePicker
            value={{ start: startDate, end: endDate }}
            onChange={(r) => {
              setRangeWithUrlUpdates(r, { page: null });
            }}
            align="end"
            triggerTestId="charging-list-range"
          />
        </>
      }
      overflowActions={
        <SavedViewMenu
          route="/charging"
          currentQuery={savedView.currentQuery}
          onApply={savedView.apply}
        />
      }
    >
      <PullToRefresh onRefresh={async () => { await refetch(); }}>
        <PageHeaderSticky
          targetId="charging-overview"
          ariaLabel={t('charging.stickyBar.aria', 'Charging summary')}
          testId="charging-sticky-summary"
        >
          {stickySummary}
        </PageHeaderSticky>

        {chargingState.status === 'initialFailure' ? (
          <QueryError error={error as Error} onRetry={refetch} />
        ) : (
          <StaleRefreshWarning
            state={chargingState}
            label={t('charging.list.title', 'Charging Sessions')}
          />
        )}
        {vehicleStateQuery.isError && (
          <DataStateNotice
            state="partial"
            title={t(
              'operations.charging.liveStateUnavailableTitle',
              'Live charging and departure state are unavailable',
            )}
          >
            {t(
              'operations.charging.liveStateUnavailableDescription',
              'Charging history and cost analysis remain available, but current battery and charging posture could not be resolved.',
            )}
          </DataStateNotice>
        )}

        <OperationalBrief
          testId="charging-operational-brief"
          eyebrow={t('operations.charging.eyebrow', 'Charging posture')}
          title={t('operations.charging.title', 'Cost, reliability, and battery-friendly behavior')}
          description={t(
            'operations.charging.description',
            'Current charging state, departure readiness, cost exposure, and charger behavior are paired with the selected session history.',
          )}
          statusLabel={
            isChargingNow
              ? t('operations.charging.statusCharging', 'Charging now')
              : currentStats.count === 0
              ? t('operations.status.awaitingData', 'Awaiting data')
              : anomalies.length > 0 || vehicleStateQuery.isError
                ? t('operations.status.review', 'Review recommended')
                : t('operations.status.onTrack', 'On track')
          }
          statusTone={
            isChargingNow
              ? 'info'
              : currentStats.count === 0
              ? 'neutral'
              : anomalies.length > 0 || vehicleStateQuery.isError
                ? 'warning'
                : 'success'
          }
          narrative={narrative}
          scope={<Badge variant="neutral" size="sm">{periodLabel}</Badge>}
          freshness={
            <div className="flex flex-wrap items-center gap-2">
              <DataFreshnessAuto
                query={vehicleStateQuery}
                source={t('operations.charging.liveStateSource', 'Live vehicle state')}
              />
              <DataFreshnessAuto
                query={chargingQuery}
                source={t('operations.charging.sessionsSource', 'Charging sessions')}
              />
            </div>
          }
          metricColumns={3}
          metrics={[
            {
              key: 'posture',
              label: t('operations.charging.currentPosture', 'Current posture'),
              value: vehicleStateQuery.isLoading
                ? t('operations.charging.checkingLiveState', 'Checking')
                : vehicleStateQuery.isError || !liveState
                  ? t('common.unavailable', 'Unavailable')
                  : isChargingNow
                    ? t('operations.charging.chargingNow', 'Charging')
                    : t('operations.charging.notCharging', 'Not charging'),
              detail: vehicleStateQuery.isError
                ? t(
                    'operations.charging.currentPostureUnavailable',
                    'Live state could not be resolved; session history remains available.',
                  )
                : isChargingNow
                  ? t(
                      'operations.charging.currentPostureCharging',
                      'Battery is at {{battery}}%{{eta}}.',
                      {
                        battery: fmtInt(departureBatteryPct ?? 0),
                        eta: timeToTarget
                          ? t(
                              'operations.charging.currentPostureEta',
                              ' with {{duration}} to target',
                              { duration: timeToTarget },
                            )
                          : '',
                      },
                    )
                  : liveState
                    ? t(
                        'operations.charging.currentPostureIdle',
                        'Latest battery state is {{battery}}%; the vehicle is not drawing charge.',
                        { battery: fmtInt(departureBatteryPct ?? 0) },
                      )
                    : t(
                        'operations.charging.currentPostureMissing',
                        'Live state has not arrived; session history remains available.',
                      ),
              tone: vehicleStateQuery.isLoading || vehicleStateQuery.isError || !liveState
                ? 'neutral'
                : isChargingNow
                  ? 'info'
                  : 'success',
            },
            {
              key: 'departure',
              label: t('operations.charging.departureReadiness', 'Departure readiness'),
              value: liveState ? `${fmtInt(departureBatteryPct ?? 0)}%` : '—',
              detail: !liveState
                ? t(
                    'operations.charging.departureUnavailable',
                    'Current battery state is required to assess near-term departure readiness.',
                  )
                : timeToTarget
                  ? t(
                      'operations.charging.departureEta',
                      'Estimated {{duration}} to the configured charge target.',
                      { duration: timeToTarget },
                    )
                  : (departureBatteryPct ?? 0) >= 40
                    ? t(
                        'operations.charging.departureReady',
                        'Battery state supports near-term departure; confirm route range before leaving.',
                      )
                    : t(
                        'operations.charging.departureLow',
                        'Additional charging is recommended before the next departure.',
                      ),
              tone: !liveState
                ? 'neutral'
                : (departureBatteryPct ?? 0) < 20
                  ? 'danger'
                  : (departureBatteryPct ?? 0) < 40
                    ? 'warning'
                    : 'success',
            },
            {
              key: 'cost',
              label: t('operations.charging.costExposure', 'Cost exposure'),
              value: formatCurrency(currentStats.totalCost),
              detail: blendedCostPerKwh != null
                ? t(
                    'operations.charging.costExposureDetail',
                    '{{rate}}/kWh blended across recorded charging energy.',
                    { rate: formatCurrency(blendedCostPerKwh) },
                  )
                : t(
                    'operations.charging.costExposureUnavailable',
                    'A blended rate requires both recorded energy and cost.',
                  ),
              tone: 'neutral',
            },
            {
              key: 'efficiency',
              label: t('operations.charging.efficiency', 'Charging efficiency'),
              value: t('operations.charging.efficiencyNotMeasured', 'Not measured'),
              detail: t(
                'operations.charging.efficiencyNotMeasuredDetail',
                'Independent wall-input and battery-retained energy are not present in the session contract; delivery rate is shown below instead.',
              ),
              tone: 'neutral',
            },
            {
              key: 'interruptions',
              label: t('operations.charging.interruptions', 'Potential interruptions'),
              value: interruptionAnomalies.length,
              detail: t(
                'operations.charging.interruptionsDetail',
                'Sessions with a telemetry gap or sustained unexpectedly low DC power.',
              ),
              tone: interruptionAnomalies.length > 0 ? 'danger' : 'success',
            },
            {
              key: 'reliability',
              label: t('operations.charging.reliability', 'Charger reliability'),
              value: reliabilityPct == null
                ? '—'
                : t(
                    'operations.charging.reliabilityValue',
                    '{{value}}% clear',
                    { value: fmtInt(reliabilityPct) },
                  ),
              detail: t(
                'operations.charging.reliabilityDetail',
                'Share of sessions without telemetry gaps, sustained low power, or prolonged trickle behavior; not a charger-uptime SLA.',
              ),
              tone: reliabilityPct == null
                ? 'neutral'
                : reliabilityPct >= 95
                  ? 'success'
                  : reliabilityPct >= 80
                    ? 'warning'
                    : 'danger',
            },
          ]}
          attention={chargingAttention}
          provenance={t(
            'operations.charging.provenance',
            'Derived from live vehicle state, charging-session telemetry, configured cost data, and vehicle-local day boundaries.',
          )}
        />

        {/* Search + active filter chips */}
        <FadeIn>
          <section aria-label={t('charging.section.filters', 'Search and filters')}>
          <FilterBar>
            <div className="relative w-full sm:w-[28rem]">
              <SearchInput
                value={search}
                onChange={(v) => { setUrlBatch({ q: v || null, page: null }); }}
                placeholder={t('charging.searchPlaceholder', 'Search charging — try "charger:home", "cost:>5", "kwh:>20", "Costco"')}
                className="w-full"
                historyScope="charging"
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
                search ? {
                  key: 'q',
                  label: t('charging.filterLabel.search', 'Search'),
                  value: search,
                  onRemove: () => { setUrlBatch({ q: null, page: null }); },
                } satisfies FilterChipDescriptor : null,
                collection !== 'all' ? {
                  key: 'coll',
                  label: t('charging.filterLabel.collection', 'View'),
                  value: collectionLabel,
                  onRemove: () => { setUrlBatch({ coll: null, page: null }); },
                } satisfies FilterChipDescriptor : null,
              ].filter(Boolean) as FilterChipDescriptor[]) as readonly FilterChipDescriptor[]
            }
            onClearAll={() => {
              setUrlBatch({ q: null, coll: null, page: null });
            }}
          />
          </section>
        </FadeIn>

        {/* Overview KPI card */}
        <FadeIn>
          <section aria-label={t('charging.section.overview', 'Overview')}>
          {currentStats.count > 0 ? (
            <KpiOverviewCard
              id="charging-overview"
              testId="charging-overview"
              header={{
                title: t('charging.overview', 'Overview'),
                currentLabel: periodLabel,
                comparisonLabel: priorLabel,
              }}
              kpis={
                <>
                  <MetricCard
                    label={t('charging.totalSessions', 'Sessions')}
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
                    label={t('charging.totalEnergy', 'Energy (kWh)')}
                    value={fmtCompact(currentStats.totalEnergyWh / 1000, 10000)}
                    color="green"
                    delta={priorHasData ? {
                      metric: 'energy_consumed',
                      previous: priorStats!.totalEnergyWh / 1000,
                      current: currentStats.totalEnergyWh / 1000,
                      display: 'percent',
                    } : undefined}
                  />
                  <MetricCard
                    label={t('charging.totalCost', 'Cost')}
                    value={formatCurrency(currentStats.totalCost)}
                    color="red"
                    delta={priorHasData ? {
                      metric: 'cost',
                      previous: priorStats!.totalCost,
                      current: currentStats.totalCost,
                      display: 'percent',
                    } : undefined}
                  />
                  <MetricCard
                    label={t('charging.avgRate', 'Avg rate (kW)')}
                    value={currentStats.avgRateKw != null ? fmtNumber(currentStats.avgRateKw) : '—'}
                    color="purple"
                    delta={priorHasData && currentStats.avgRateKw != null && priorStats!.avgRateKw != null ? {
                      metric: { direction: 'neutral' },
                      previous: priorStats!.avgRateKw,
                      current: currentStats.avgRateKw,
                      display: 'percent',
                    } : undefined}
                  />
                  <MetricCard
                    label={t('charging.avgDuration', 'Avg duration')}
                    value={currentStats.avgDurationMin != null ? formatDurationMinutes(currentStats.avgDurationMin) : '—'}
                    color="blue"
                    delta={priorHasData && currentStats.avgDurationMin != null && priorStats!.avgDurationMin != null ? {
                      metric: { direction: 'neutral' },
                      previous: priorStats!.avgDurationMin,
                      current: currentStats.avgDurationMin,
                      display: 'percent',
                    } : undefined}
                  />
                  <MetricCard
                    label={t('charging.avgPower', 'Avg power (kW)')}
                    value={currentStats.avgPowerW != null ? fmtNumber(currentStats.avgPowerW / 1000) : '—'}
                    color="amber"
                    delta={priorHasData && currentStats.avgPowerW != null && priorStats!.avgPowerW != null ? {
                      metric: { direction: 'neutral' },
                      previous: priorStats!.avgPowerW / 1000,
                      current: currentStats.avgPowerW / 1000,
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
                message={t('charging.noStatsRange', 'No charging sessions in this range')}
              />
            </GlassPanel>
          )}
          </section>
        </FadeIn>

        {/* Trend chart */}
        {currentStats.count > 0 && (
          <FadeIn>
            <section aria-label={t('charging.section.trend', 'Charging over time')}>
            <MetricSwitcherChart
              title={t('charging.overTime', 'Charging over time')}
              ariaLabel={t('charging.overTime.aria', 'Charging over time chart with metric switcher')}
              series={trendSeries}
              metrics={trendMetricsConfig}
              activeMetric={trendMetric}
              onMetricChange={(k) => setTrendMetric(k as ChargingTrendMetric)}
              formatXTick={formatChartXTick}
              emptyMessage={t('charging.overTime.empty', 'No data for this metric in the selected range')}
              testId="charging-trend-chart"
            />
            </section>
          </FadeIn>
        )}

        {/* Collections */}
        <FadeIn>
          <section aria-label={t('charging.section.collections', 'Collections')}>
          <PillFilterBar
            items={collectionPills}
            activeKey={collection}
            onChange={(k) => setUrlBatch({ coll: k === 'all' ? null : k, page: null })}
            ariaLabel={t('charging.collections.aria', 'Filter charging sessions by collection')}
            testId="charging-collections"
          />
          </section>
        </FadeIn>

        {/* Charging insights — analytical bento that reflows into columns on wide screens */}
        {sessions && (
          <FadeIn delay={0.15}>
            <section
              aria-label={t('charging.section.insights', 'Charging insights')}
              className="space-y-4 xl:space-y-5"
            >
              <SectionTitle>{t('charging.insights.title', 'Charging Insights')}</SectionTitle>

              {sessions.length === 0 && (
                <GlassPanel className="p-6">
                  {/* no-action: recovery uses the vehicle, period, and collection filters above. */}
                  <EmptyState
                    icon={<Plug className="h-8 w-8" aria-hidden="true" />}
                    message={t(
                      'charging.insights.emptyMessage',
                      'Charging insights need completed sessions in the selected range.',
                    )}
                    description={t(
                      'charging.insights.emptyDescription',
                      'Battery-start patterns, charger comparisons, and scheduling guidance appear as session history accumulates.',
                    )}
                    className="py-8"
                  />
                </GlassPanel>
              )}

              <div className="grid grid-cols-1 gap-4 xl:gap-5 2xl:grid-cols-6">
                {/* AC vs DC — wide table, spans the majority of the row on wide screens */}
                {acDcBreakdown && (acDcBreakdown.ac.count + acDcBreakdown.dc.count >= THRESHOLD_AC_DC) ? (
                  <div className="min-w-0 2xl:col-span-4">
                    <AcDcStatsPanel breakdown={acDcBreakdown} />
                  </div>
                ) : null}

                {/* Battery start-level distribution — needs ≥ 5 sessions to be meaningful */}
                {startLevelDist.length > 0 && sessions.length >= THRESHOLD_BATTERY_DIST ? (
                  <div className="min-w-0 2xl:col-span-2">
                    <BatteryLevelChart data={startLevelDist} />
                  </div>
                ) : sessions.length > 0 && sessions.length < THRESHOLD_BATTERY_DIST ? (
                  <div className="min-w-0 2xl:col-span-2">
                    <EmptyStateThreshold
                      currentCount={sessions.length}
                      threshold={THRESHOLD_BATTERY_DIST}
                      itemNoun={t('charging.itemNoun', 'sessions')}
                      sectionLabel={t('charging.section.batteryDist', 'Battery start-level distribution')}
                      description={t('charging.section.batteryDistDesc', 'See where you typically start charging.')}
                    />
                  </div>
                ) : null}

                {/* Delivery rate is measurable from session energy and elapsed time. */}
                {chargeRateStats ? (
                  <div className="min-w-0 2xl:col-span-6">
                    <ChargeRatePanel stats={chargeRateStats} />
                  </div>
                ) : null}

                {/* Charger specs — needs ≥ 5 to compare */}
                {chargerSpecs && sessions.length >= THRESHOLD_SPECS ? (
                  <div className="min-w-0 2xl:col-span-6">
                    <ChargerSpecsPanel specs={chargerSpecs} />
                  </div>
                ) : sessions.length > 0 && sessions.length < THRESHOLD_SPECS ? (
                  <div className="min-w-0 2xl:col-span-6">
                    <EmptyStateThreshold
                      currentCount={sessions.length}
                      threshold={THRESHOLD_SPECS}
                      itemNoun={t('charging.itemNoun', 'sessions')}
                      sectionLabel={t('charging.section.specs', 'Charger specs breakdown')}
                    />
                  </div>
                ) : null}
              </div>

              {/* Optimizer + heatmap — full-width band (has its own internal grid) */}
              {optimizer && sessions.length >= THRESHOLD_OPTIMIZER ? (
                <OptimizerSection optimizer={optimizer} />
              ) : sessions.length > 0 && sessions.length < THRESHOLD_OPTIMIZER ? (
                <EmptyStateThreshold
                  currentCount={sessions.length}
                  threshold={THRESHOLD_OPTIMIZER}
                  itemNoun={t('charging.itemNoun', 'sessions')}
                  sectionLabel={t('charging.section.optimizer', 'Cost optimizer & heatmap')}
                  description={t('charging.section.optimizerDesc', 'Smart scheduling recommendations require pattern recognition.')}
                />
              ) : null}
            </section>
          </FadeIn>
        )}

        {/* Session list — full-width detail band */}
        <FadeIn delay={0.2}>
          <section
            aria-label={t('charging.section.sessions', 'All charging sessions')}
            className="space-y-3"
            data-tour="charging-list"
          >
            {sortedSessions.length > 0 && (
              <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
                <SectionTitle className="flex items-center gap-2">
                  <Plug className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                  {t('charging.allSessions', 'All sessions')}
                  <Text as="span" size="xs" weight="regular" color="muted">
                    ({fmtCompact(sortedSessions.length)})
                  </Text>
                </SectionTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <SortControl<SortField>
                    field={sortBy}
                    direction={sortDesc ? 'desc' : 'asc'}
                    options={sortOptions}
                    onFieldChange={setSortBy}
                    onDirectionChange={(d: SortDirection) => setSortDesc(d === 'desc')}
                    testId="charging-sort"
                  />
                  <span className="mx-1 h-4 w-px bg-[var(--surface-2)]" aria-hidden="true" />
                  <DensityToggle
                    value={density}
                    onChange={setDensity}
                    options={['compact', 'comfortable']}
                    testId="charging-density"
                  />
                  <span className="mx-1 h-4 w-px bg-[var(--surface-2)]" aria-hidden="true" />
                  <ListExportMenu
                    onExportCsv={handleExportCsv}
                    onExportJson={handleExportJson}
                    selectedCount={bulkSelected.size}
                    visibleCount={sortedSessions.length}
                    testId="charging-export"
                  />
                </div>
              </div>
            )}

            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-20" />)}
              </div>
            ) : paginatedSessions.length > 0 ? (
              <>
                <BulkActionsToolbar
                  selectedIds={Array.from(bulkSelected)}
                  total={filteredSessions.length}
                  onClear={clearBulk}
                  actions={bulkActions}
                  itemNoun={{
                    one: t('bulk.noun.session_one', 'session'),
                    other: t('bulk.noun.session_other', 'sessions'),
                  }}
                />
                <StaggerContainer>
                  <DateGroupedList
                    groups={groupedSessions}
                    itemKey={(s) => s.id}
                    renderItem={(s) => (
                      <StaggerItem>
                        <ChargingSessionCard
                          session={s}
                          toDistanceDisplay={toDistanceDisplay}
                          distanceUnit={distanceUnit}
                          selected={bulkSelected.has(s.id)}
                          onToggleSelect={toggleSessionSelected}
                          anomaly={anomalyById.get(s.id)}
                          density={density === 'compact' ? 'compact' : 'comfortable'}
                          onPreview={setPreviewSession}
                        />
                      </StaggerItem>
                    )}
                  />
                </StaggerContainer>
                <Pagination
                  page={page}
                  pageSize={pageSize}
                  total={sortedSessions.length}
                  onPageChange={setPage}
                  onPageSizeChange={(s) => { setUrlBatch({ size: String(s), page: null }); }}
                />
              </>
            ) : !isLoading && (
              <>
                <EmptyState
                  icon={<Battery className="h-8 w-8" />}
                  title={
                    collection !== 'all'
                      ? t('charging.emptyForCollection', 'No charging sessions in this view')
                      : t('charging.emptyTitle', 'No charging sessions yet')
                  }
                  message={
                    collection !== 'all'
                      ? t('charging.emptyForCollection.msg', 'Try switching to a different collection or clearing your filters.')
                      : t('charging.emptyMessage', 'Charging data will appear here once your vehicle records sessions.')
                  }
                  action={{
                    label: t('charging.empty.cta', 'Reset filters'),
                    onClick: () => {
                      setUrlBatch({ q: null, from: null, to: null, coll: null, sort: null, page: null });
                    },
                  }}
                />
                {/* HELP-02 — governed prerequisite + likely cause. Only for
                    the unfiltered view; the filtered branch above already
                    tells the user to clear filters. */}
                {collection === 'all' && (
                  <EmptyStateGuidanceDetails guidanceId="charging.list" className="mx-auto" />
                )}
              </>
            )}
          </section>
        </FadeIn>

        <EntityPreviewDrawer
          open={previewSession !== null}
          onClose={() => setPreviewSession(null)}
          eyebrow={t('charging.preview.eyebrow', 'Charging session')}
          title={
            previewSession?.start_place
            ?? t('charging.preview.title', 'Session #{{id}}', {
              id: previewSession?.id ?? '',
            })
          }
          description={
            previewSession
              ? t('charging.preview.description', 'Started {{time}}', {
                  time: formatDateTime(previewSession.started_at, { tz }),
                })
              : undefined
          }
          statusLabel={
            previewSession?.live
              ? t('charging.preview.active', 'Active')
              : t('charging.preview.completed', 'Completed')
          }
          statusTone={previewSession?.live ? 'info' : 'success'}
          fields={
            previewSession
              ? [
                  {
                    key: 'duration',
                    label: t('charging.duration', 'Duration'),
                    value: durationMinutes(previewSession) > 0
                      ? formatDurationMinutes(durationMinutes(previewSession))
                      : '—',
                  },
                  {
                    key: 'energy',
                    label: t('operations.charging.deliveredEnergy', 'Delivered energy'),
                    value: `${fmtNumber(previewSession.total_energy_added_wh / 1000)} kWh`,
                  },
                  {
                    key: 'battery',
                    label: t('charging.batteryChange', 'Battery change'),
                    value: `${fmtNumber(previewSession.start_soc_pct)}% → ${
                      previewSession.end_soc_pct != null
                        ? `${fmtNumber(previewSession.end_soc_pct)}%`
                        : '—'
                    }`,
                  },
                  {
                    key: 'cost',
                    label: t('charging.totalCost', 'Cost'),
                    value: previewSession.cost_decimal != null
                      ? formatCurrency(previewSession.cost_decimal)
                      : '—',
                  },
                  {
                    key: 'peak-power',
                    label: t('charging.preview.peakPower', 'Peak power'),
                    value: previewSession.peak_power_w != null
                      ? `${fmtNumber(previewSession.peak_power_w / 1000)} kW`
                      : '—',
                  },
                  {
                    key: 'charger',
                    label: t('charging.preview.charger', 'Charger'),
                    value: previewSession.charger_type
                      ?? t('charging.chargerTypes.unknown', 'Unknown'),
                  },
                ]
              : []
          }
          primaryAction={
            previewSession
              ? {
                  label: t('charging.preview.openDetails', 'Open session details'),
                  onClick: () => navigate(`/charging/${previewSession.id}`),
                }
              : undefined
          }
          relatedActions={
            previewSession
              ? [
                  {
                    key: 'vehicle',
                    label: t('entityContext.vehicle', 'Vehicle'),
                    to: `/vehicles/${previewSession.vehicle_id}`,
                    icon: <Car className="h-4 w-4" aria-hidden="true" />,
                  },
                  {
                    key: 'drives',
                    label: t('entityContext.drives', 'Drive history'),
                    to: buildContextHref('/drives', {
                      from: previewFrom,
                      to: previewTo,
                    }),
                    icon: <Route className="h-4 w-4" aria-hidden="true" />,
                  },
                  ...(previewSession.start_place
                    ? [{
                        key: 'location',
                        label: t('entityContext.location', 'Charge location'),
                        to: buildContextHref('/locations', {
                          q: previewSession.start_place,
                          from: previewFrom,
                          to: previewTo,
                        }),
                        icon: <MapPin className="h-4 w-4" aria-hidden="true" />,
                      }]
                    : []),
                  {
                    key: 'alerts',
                    label: t('entityContext.alerts', 'Alerts'),
                    to: buildContextHref('/notifications/alerts', {
                      from: previewFrom,
                      to: previewTo,
                    }),
                    icon: <Bell className="h-4 w-4" aria-hidden="true" />,
                  },
                  {
                    key: 'service',
                    label: t('entityContext.service', 'Service history'),
                    to: '/maintenance',
                    icon: <Wrench className="h-4 w-4" aria-hidden="true" />,
                  },
                  {
                    key: 'telemetry',
                    label: t('entityContext.telemetry', 'Telemetry evidence'),
                    to: buildContextHref('/signals', {
                      from: previewFrom,
                      to: previewTo,
                      signals: ['ACChargingPower', 'DCChargingPower', 'BatteryLevel'],
                    }),
                    icon: <Activity className="h-4 w-4" aria-hidden="true" />,
                  },
                ]
              : []
          }
        />
      </PullToRefresh>
    </PageContainer>
  );
}

export function formatHour(h: number): string {
  if (h === 0) return '12 AM';
  if (h === 12) return '12 PM';
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
}
