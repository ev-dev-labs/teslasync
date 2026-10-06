import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';

import { PageLayout, CardGrid } from '@/components/layout';
import { Badge, useSortToggle, type Column } from '@/components/ui';
import { AlertBanner } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { deriveDataState } from '@/api/dataState';
import {
  PressureSummary, PressureCurrentCard, PressureHistoryCard, PressureHistoryTable,
  readPressurePa, summarisePressure, chronologicalPressure, pressureChartRows,
  PRESSURE_THRESHOLDS_PA,
} from '../components/pressure-modernization';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useRangeState } from '@/hooks/useRangeState';
import { useUnits } from '@/hooks/useUnits';
import { usePressureFormat } from '@/hooks/usePressureFormat';
import { formatDateTime } from '@/lib/dateFormat';

import {
  usePressurePageLatest, usePressurePageHistory, type TirePressureReading,
} from '@/api/hooks/usePressurePage';
import { AITirePressureTrendReasoning } from '@/components/ai';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/* ------------------------------------------------------------------ */
/*  Types (snake_case from backend)                                    */
/* ------------------------------------------------------------------ */

export type { TirePressureReading } from '@/api/hooks/usePressurePage';

/* ------------------------------------------------------------------ */
/*  Constants & helpers                                                */
/* ------------------------------------------------------------------ */

/**
 * Check if a TPMS warning JSON string contains any true value.
 *
 * Exported (with the other pure helpers below) so the corner-status /
 * normalisation logic can be unit-tested in isolation without mounting the
 * whole page. The page's public surface is still the default export.
 */
export function hasTpmsWarning(val: string | null | undefined): boolean {
  if (!val) return false;
  try {
    const parsed = JSON.parse(val) as Record<string, boolean>;
    return Object.values(parsed).some(Boolean);
  } catch {
    // Fallback: treat non-empty non-JSON strings as truthy
    return val !== 'false' && val !== '';
  }
}

// Thresholds in Pascals (SI). Backend `signal_log` stores TpmsPressure
// values in Pa; units.ToSI converts the fixed-bar TPMS wire inputs to Pa per
// `internal/tesla/units/units.go`.
// 1 bar = 100_000 Pa, 1 psi ≈ 6894.757 Pa.
// Domain shown on the per-tyre threshold bars. A mounted tyre never reaches
// 0 Pa, so anchoring the track at zero would spend most of its width on
// states that cannot physically occur and compress the band that matters
// (2.0-4.0 bar) into a sliver. These sit just outside the critical
// thresholds so the reader always sees the edges they could drift toward.
const {
  normalMin: NORMAL_MIN_PA,
  normalMax: NORMAL_MAX_PA,
  softLow: SOFT_LOW_PA,
  softHigh: SOFT_HIGH_PA,
  domainMin: DOMAIN_MIN_PA,
  domainMax: DOMAIN_MAX_PA,
} = PRESSURE_THRESHOLDS_PA;

/**
 * @deprecated Compatibility export for the inherited helper tests only.
 * Production rendering reads canonical Pa without magnitude-based guessing.
 * The live fixed-bar ToSI producer supersedes this adapter's old source-unit
 * assumptions. Do not add call sites or use this as a wire contract.
 *
 * Ranges (typical passenger car tire pressures):
 *   - Pa     : 150_000–500_000   → return as-is
 *   - kPa    : 150–500           → multiply by 1_000
 *   - psi    : 20–60             → multiply by 6_894.757
 *   - bar    : 1.5–5             → multiply by 100_000
 *   - 0/null : missing reading   → return 0
 */
export function normaliseTpmsToPa(raw: number | null | undefined): number {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return 0;
  if (raw >= 50_000) return raw; // already Pa
  if (raw >= 100) return raw * 1_000; // kPa
  if (raw >= 10) return raw * 6_894.757; // psi
  return raw * 100_000; // bar (covers 0.5..10)
}

export const TIRE_POSITIONS = ['fl', 'fr', 'rl', 'rr'] as const;
export type TirePosition = (typeof TIRE_POSITIONS)[number];

// English fallbacks; the visible labels are resolved through i18n at the
// render boundary via `tireLabel(pos)` so translators can localise each
// corner without touching this map.
const TIRE_LABELS: Record<TirePosition, string> = {
  fl: 'Front left',
  fr: 'Front right',
  rl: 'Rear left',
  rr: 'Rear right',
};

export type PressureStatus = 'normal' | 'low' | 'high' | 'critical';

// English fallbacks for the four status buckets; resolved via `statusLabel`.
const STATUS_LABELS: Record<PressureStatus, string> = {
  normal: 'Normal',
  low: 'Low',
  high: 'High',
  critical: 'Critical',
};



export function getTirePressureValue(
  reading: TirePressureReading,
  pos: TirePosition,
): number {
  const map: Record<TirePosition, number | null | undefined> = {
    fl: reading.front_left,
    fr: reading.front_right,
    rl: reading.rear_left,
    rr: reading.rear_right,
  };
  return normaliseTpmsToPa(map[pos]);
}

export function pressureColor(pa: number): string {
  if (pa >= NORMAL_MIN_PA && pa <= NORMAL_MAX_PA) return '#10b981';
  if (pa >= SOFT_LOW_PA && pa <= SOFT_HIGH_PA) return '#f59e0b';
  return '#ef4444';
}

export function pressureStatus(pa: number): PressureStatus {
  if (pa < SOFT_LOW_PA) return 'critical';
  if (pa < NORMAL_MIN_PA) return 'low';
  if (pa > SOFT_HIGH_PA) return 'critical';
  if (pa > NORMAL_MAX_PA) return 'high';
  return 'normal';
}

export function statusVariant(
  status: PressureStatus,
): 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'normal':
      return 'success';
    case 'critical':
      return 'danger';
    default:
      return 'warning';
  }
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function TirePressurePage() {
  const { fmtNumber, precision: displayPrecision, locale: displayLocale } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('tirePressure.title', 'Tire pressure'));
  const { unitPrefs } = useUnits();
  const { pressureUnit, toPressureValue } = usePressureFormat();

  // i18n label resolvers — keep the English constant as the fallback so
  // untranslated locales still render a meaningful corner / status name.
  const tireLabel = useCallback(
    (pos: TirePosition) => t(`tirePressure.tire.${pos}`, TIRE_LABELS[pos]),
    [t],
  );
  const statusLabel = useCallback(
    (status: PressureStatus) =>
      t(`tirePressure.status.${status}`, STATUS_LABELS[status]),
    [t],
  );

  // Backend `front_left`/`front_right`/`rear_left`/`rear_right` arrive
  // in Pa (SI). `convertPressureFromSI` expects kPa, so divide by 1000
  // at the boundary.
  const pressureDisplayValue = useCallback(
    (pa: number) => toPressureValue(pa) ?? Number.NaN,
    [toPressureValue],
  );

  // Qualitative regions of the pressure domain, in display units. Edges and
  // colours are derived from the same pressureStatus()/pressureColor() helpers
  // the status Badge uses, so the coloured track can never drift out of sync
  // with the label sitting next to it.
  const pressureDomain = useMemo(
    () => ({
      min: pressureDisplayValue(DOMAIN_MIN_PA),
      max: pressureDisplayValue(DOMAIN_MAX_PA),
    }),
    [pressureDisplayValue],
  );

  const pressureBands = useMemo(() => {
    const edges = [
      DOMAIN_MIN_PA,
      SOFT_LOW_PA,
      NORMAL_MIN_PA,
      NORMAL_MAX_PA,
      SOFT_HIGH_PA,
      DOMAIN_MAX_PA,
    ];
    return edges.slice(0, -1).map((fromPa, i) => {
      const toPa = edges[i + 1];
      const midPa = (fromPa + toPa) / 2;
      return {
        from: pressureDisplayValue(fromPa),
        to: pressureDisplayValue(toPa),
        color: `${pressureColor(midPa)}8c`,
        label: statusLabel(pressureStatus(midPa)),
      };
    });
  }, [pressureDisplayValue, statusLabel]);

  // Header VehiclePicker is the source of truth.
  const { vehicleId: activeVehicleId } = useSelectedVehicle();
  const { start, end } = useRangeState({
    persistKey: 'tire-pressure.range',
  });

  /* ---- API queries ---- */

  const latestQuery = usePressurePageLatest(activeVehicleId);
  const {
    data: latest,
    isLoading: loadingLatest,
  } = latestQuery;

  const historyQuery = usePressurePageHistory(activeVehicleId, start, end);
  const {
    data: history,
    isLoading: loadingHistory,
  } = historyQuery;
  const latestState = deriveDataState(latestQuery, {
    provenance: 'cached',
    unavailable: latest == null,
    partial: latest != null && TIRE_POSITIONS.some(pos => readPressurePa(latest, pos) == null),
  });
  const historyState = deriveDataState(historyQuery, {
    provenance: 'historical',
    unavailable: !history?.length,
  });
  const dataSources = useMemo(
    () => [
      {
        id: 'latest-tire-pressure',
        label: t('dataSources.labels.liveTirePressure', 'Latest tire pressure'),
        query: latestQuery,
        enabled: activeVehicleId !== null,
      },
      {
        id: 'tire-pressure-history',
        label: t('dataSources.labels.tirePressureHistory', 'Tire pressure history'),
        query: historyQuery,
        enabled: activeVehicleId !== null,
      },
    ],
    [activeVehicleId, historyQuery, latestQuery, t],
  );

  /* ---- Derived data ---- */

  const hardWarning = hasTpmsWarning(latest?.tpms_hard_warnings);
  const softWarning = hasTpmsWarning(latest?.tpms_soft_warnings);
  const hasWarning = hardWarning || softWarning;

  const summaryStats = useMemo(() => summarisePressure(latest), [latest]);

  // Canonical chronological order (oldest first). The /tire-pressure endpoint
  // forwards rows in StateReader.Timeline order (ASC) but the contract doesn't
  // pin that, so we sort defensively here. This becomes the single source of
  // truth for both the chart (renders left=oldest, right=newest) and the
  // newest-first table derivation below.
  const historyAsc = useMemo(() => chronologicalPressure(history), [history]);
  const chartData = useMemo(
    () => pressureChartRows(historyAsc, toPressureValue),
    [historyAsc, toPressureValue],
  );

  // Newest entry in the selected range — used to populate "Last Updated"
  // because /tire-pressure/latest returns only field values (no timestamp).
  // This is the freshness of the visible window, not necessarily global
  // freshness; the label is range-bound by design.
  const lastUpdatedAt = useMemo<string | null>(() => {
    if (historyAsc.length === 0) return null;
    return historyAsc[historyAsc.length - 1].created_at ?? null;
  }, [historyAsc]);

  /* ---- Table sort: newest-first by default, all sortable columns wired ---- */

  // Accessor used by useSortToggle to extract a comparable value per
  // column key. Numeric tire columns sort by their canonical Pa value so
  // the Badge-wrapped renders sort by magnitude, not by Badge label text.
  const sortAccessor = useCallback(
    (row: TirePressureReading, key: string): number | string => {
      switch (key) {
        case 'created_at':
          return row.created_at ?? '';
        case 'fl':
        case 'fr':
        case 'rl':
        case 'rr':
          // Keep missing readings before measured positives, as in the
          // inherited sort. This comparator sentinel is never displayed.
          return readPressurePa(row, key) ?? 0;
        default:
          return '';
      }
    },
    [],
  );

  const { sortKey, sortDir, onSort, sortFn } = useSortToggle(
    'created_at',
    'desc',
  );

  const tableData = useMemo(
    () => sortFn(historyAsc, sortAccessor),
    [historyAsc, sortFn, sortAccessor],
  );

  /* ---- Table columns ---- */

  const historyColumns: Column<TirePressureReading>[] = useMemo(
    () => [
      {
        key: 'created_at',
        header: t('tirePressure.col.time', 'Time'),
        render: (row: TirePressureReading) => formatDateTime(row.created_at),
        sortable: true,
      },
      ...TIRE_POSITIONS.map(
        (pos): Column<TirePressureReading> => ({
          key: pos,
          align: 'right',
          filterValue: (row) => {
            return readPressurePa(row, pos);
          },
          filterValueLabel: (_value, row) => {
            const value = readPressurePa(row, pos);
            return value != null ? `${fmtNumber(pressureDisplayValue(value))} ${pressureUnit}` : '—';
          },
          header: `${tireLabel(pos)} (${pressureUnit})`,
          render: (row: TirePressureReading) => {
            const val = readPressurePa(row, pos);
            return (
              <Badge variant={val != null ? statusVariant(pressureStatus(val)) : 'neutral'} size="sm">
                {val != null ? fmtNumber(pressureDisplayValue(val)) : '—'}
              </Badge>
            );
          },
          sortable: true,
        }),
      ),
      {
        key: 'warnings',
        header: t('tirePressure.col.warnings', 'Warnings'),
        render: (row: TirePressureReading) => {
          if (hasTpmsWarning(row.tpms_hard_warnings)) {
            return (
              <Badge variant="danger" size="sm" dot>
                {t('tirePressure.warn.hardShort', 'Hard warning')}
              </Badge>
            );
          }
          if (hasTpmsWarning(row.tpms_soft_warnings)) {
            return (
              <Badge variant="warning" size="sm" dot>
                {t('tirePressure.warn.softShort', 'Soft warning')}
              </Badge>
            );
          }
          // The current Go mapping does not project TPMS flags. Their absence
          // is unknown, not affirmative evidence of an OK vehicle.
          if (row.tpms_hard_warnings == null || row.tpms_soft_warnings == null) {
            return <Badge variant="neutral" size="sm">—</Badge>;
          }
          return (
            <Badge variant="success" size="sm">
              {t('tirePressure.warn.ok', 'OK')}
            </Badge>
          );
        },
      },
    ],
    // pressureUnit rebuilds the render closures with the correct display unit
    // when the user flips their pressure preference; between changes the deps
    // are stable so the columns keep their identity.
    [t, tireLabel, pressureUnit, fmtNumber, pressureDisplayValue],
  );

  /* ---- Render ---- */

  return (
    <PageLayout
      title={t('tirePressure.title', 'Tire pressure')}
      subtitle={t(
        'tirePressure.subtitle',
        'Monitor tire pressure readings and history',
      )}
      query={[latestQuery, historyQuery]}
      dataSources={dataSources}
    >
      {/* AI opt-in narration — renders nothing when the feature is disabled. */}
      <AITirePressureTrendReasoning vehicleId={activeVehicleId ?? undefined} />

      {/* TPMS warning banner — surfaced when the latest reading flags a corner. */}
      {hasWarning && (
        <AlertBanner
          variant={hardWarning ? 'danger' : 'warning'}
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          title={
            hardWarning
              ? t('tirePressure.warn.hardTitle', 'Hard TPMS warning active')
              : t('tirePressure.warn.softTitle', 'Soft TPMS warning active')
          }
        >
          {hardWarning
            ? t(
                'tirePressure.warn.hardBody',
                'One or more tires need immediate attention.',
              )
            : t(
                'tirePressure.warn.softBody',
                'One or more tires are outside the recommended range.',
              )}
        </AlertBanner>
      )}

      {/* One allocated-width observer packs all four persistent groups.
          Content components consume placement INSIDE its provider. */}
      <FadeIn>
        <CardGrid
          label={t('tirePressure.readings', 'Current readings and trend')}
          items={[
            {
              id: 'tire-pressure-summary',
              size: 'full',
              content: <PressureSummary summary={summaryStats} lastUpdatedAt={lastUpdatedAt}
                units={unitPrefs} precision={displayPrecision} locale={displayLocale} latestLoading={loadingLatest && !latest}
                historyLoading={loadingHistory && !history}
                retained={Boolean(latestState.refreshError || historyState.refreshError
                  || (latestState.hasData && latestState.isRefreshBlocked)
                  || (historyState.hasData && historyState.isRefreshBlocked))} />,
            },
            {
              id: 'tire-pressure-current',
              size: 'third',
              content: <PressureCurrentCard source={latestState} loading={loadingLatest}
                label={tireLabel} status={pa => statusLabel(pressureStatus(pa))}
                unit={pressureUnit} precision={displayPrecision} format={fmtNumber}
                domain={pressureDomain} bands={pressureBands} convert={toPressureValue} />,
            },
            {
              id: 'tire-pressure-history',
              size: 'half',
              content: <PressureHistoryCard source={historyState} loading={loadingHistory}
                rows={chartData} label={tireLabel} format={fmtNumber} unit={pressureUnit} />,
            },
            {
              id: 'tire-pressure-table',
              size: 'full',
              content: <PressureHistoryTable source={historyState} loading={loadingHistory}
                rows={tableData} columns={historyColumns} sortKey={sortKey}
                sortDir={sortDir} onSort={onSort} />,
            },
          ]}
        />
      </FadeIn>
    </PageLayout>
  );
}
