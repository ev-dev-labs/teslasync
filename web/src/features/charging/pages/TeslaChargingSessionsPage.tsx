import { useState, useMemo, useCallback, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  DollarSign, RefreshCw, MapPin,
  Building2, Info, Download, AlertCircle, Plug,
} from 'lucide-react';
import { PageLayout, LayoutCard } from '@/components/layout';
import {
  Badge,
  GlassPanel,
  Button,
  Select,
  DataTable,
  Text,
  Code,
  Icon,
  type Column, IconButton } from '@/components/ui';
import {
  type StatMetric,
  MetricBar,
  DataProvenanceBadge,
  OperationalBrief,
  type OperationalAttention,
} from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import {
  ChartContainer, ChartTooltip, chartGrid, axisTickSm,
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CHART_COLORS,
} from '@/components/charts';
import {
  ChartSkeleton,
  EmptyState,
  ListSkeleton,
  QueryError,
  TableSkeleton,
  StaleRefreshWarning,
  DataStateNotice,
  SectionErrorBoundary,
} from '@/components/feedback';

import {
  useTeslaChargingSessions,
  useRefreshTeslaChargingSessions,
  type TeslaChargingSession,
} from '@/api/hooks/useCharging';
import { usePageTitle } from '@/hooks/usePageTitle';
import {
  ALL_VEHICLES_VIN,
  useVehicleVinFilter,
} from '@/hooks/useVehicleVinFilter';
import { useRangeState } from '@/hooks/useRangeState';
import { useUnits } from '@/hooks/useUnits';
import { useDataState } from '@/hooks/useDataState';
import { formatDateTime } from '@/lib/dateFormat';

import { convertEnergyFromSI } from '@/lib/unitConversion';
import { formatCurrencyValue } from '@/lib/currencyFormat';
import { fmtNumber as formatNumber } from '@/lib/numberFormat';
import { neonColorMap, typography } from '@/lib/tokens';
import type { OperationalNarrative } from '@/types/operationalNarrative';

import { WaitOraclePanel } from '../components/WaitOraclePanel';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { ChargingSummaryBrief } from '../components/operationalbrief-all/ChargingSummaryBrief';

const LazyMap = lazy(() => import('./TeslaChargingSessionsMap'));

function sourceCurrency(sessions: TeslaChargingSession[]): string | null {
  const codes = new Set(sessions.map(session => session.currency_code?.trim().toUpperCase() ?? ''));
  const code = codes.size === 1 ? [...codes][0] : '';
  const supported = (Intl as typeof Intl & {
    supportedValuesOf?: (key: 'currency') => string[];
  }).supportedValuesOf?.('currency');
  return /^[A-Z]{3}$/.test(code) && code !== 'XXX' && code !== 'XTS'
    && supported?.includes(code) ? code : null;
}

/**
 * Format an SI-seconds duration to "Xh Ym".
 * Guards null / undefined / NaN / Infinity / negative input by returning an
 * em dash so malformed telemetry can never render "NaNm" or "-2m".
 */
export function formatDurationSeconds(seconds: number | null | undefined, t?: TFunction, locale?: string): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  // Math.max folds -0 into 0 so a measured zero never renders as "-0m".
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const hours = t || locale ? formatNumber(h, 0, locale) : String(h);
  const minutes = formatNumber(Math.floor((total % 3600) / 60), 0, locale);
  if (h > 0) return t
    ? t('tesla_sessions.durationHoursMinutes', '{{hours}}h {{minutes}}m', { hours, minutes })
    : `${hours}h ${minutes}m`;
  return t
    ? t('tesla_sessions.durationMinutes', '{{minutes}}m', { minutes })
    : `${minutes}m`;
}

/**
 * Aggregate sessions by month for the cost chart. Rows whose
 * `charge_start_datetime` is missing or unparseable are skipped so a single
 * malformed timestamp can't pollute the chart with a "NaN-NaN" bucket.
 */
export function buildMonthlyCost(sessions: TeslaChargingSession[]): { month: string; total: number }[] {
  if (!sourceCurrency(sessions)) return [];
  const map = new Map<string, number>();
  for (const s of sessions) {
    if (!s.charge_start_datetime) continue;
    const d = new Date(s.charge_start_datetime);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (s.total_cost != null && !Number.isFinite(s.total_cost)) continue;
    map.set(key, (map.get(key) ?? 0) + (s.total_cost ?? 0));
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, total]) => ({ month, total }));
}

export interface GroupBucket {
  key: string;
  count: number;
  energyWh: number;
  cost: number | null;
}

/** Roll sessions up by a string key, summing count / energy / cost (all null-safe). */
export function groupSessions(
  sessions: TeslaChargingSession[],
  keyOf: (s: TeslaChargingSession) => string,
): GroupBucket[] {
  const map = new Map<string, GroupBucket>();
  const currency = sourceCurrency(sessions);
  for (const s of sessions) {
    const key = keyOf(s);
    const cur = map.get(key) ?? { key, count: 0, energyWh: 0, cost: currency ? 0 : null };
    cur.count += 1;
    cur.energyWh += s.total_energy_added_wh ?? 0;
    if (cur.cost != null && Number.isFinite(s.total_cost ?? 0)) cur.cost += s.total_cost ?? 0;
    map.set(key, cur);
  }
  return Array.from(map.values());
}

export default function TeslaChargingSessionsPage() {
  const { fmtNumber, fmtInt, precision, locale } = useNumberFormatting();
  const { t } = useTranslation();
  const formatChargingDuration = useCallback(
    (seconds: number | null | undefined) => formatDurationSeconds(seconds, t, locale),
    [t, locale],
  );
  const { formatEnergy } = useUnits();
  const currencyUnavailable = t('tesla_sessions.currencyUnavailable', 'Mixed or unknown currency; monetary totals and comparisons are unavailable. See recorded session amounts. No currency conversion is applied.');
  const unknownCurrency = t('tesla_sessions.unknownCurrency', 'Unknown currency');
  const formatSourceAmount = useCallback((amount: number, currency: string | null) =>
    currency
      ? formatCurrencyValue(amount, currency, locale, precision, { useGrouping: true })
      : `${fmtNumber(amount)} · ${unknownCurrency}`,
  [locale, precision, fmtNumber, unknownCurrency]);
  usePageTitle(t('tesla_sessions.title', 'Fleet charging sessions'));

  const {
    allVehicles,
    queryVin,
    scopeReady,
    isResolving: vehiclesLoading,
    vehiclesState,
    selectedVin,
    setSelectedVin,
    vehicles,
  } = useVehicleVinFilter();
  const sessionsQuery = useTeslaChargingSessions(scopeReady ? queryVin : null, {
    enabled: scopeReady,
  });
  const {
    data: response,
    isLoading: sessionsLoading,
  } = sessionsQuery;
  const sessionsDataState = useDataState(sessionsQuery, { provenance: 'historical' });
  const error = sessionsDataState.fatalError;
  const isLoading = ((!allVehicles && vehiclesLoading) || sessionsLoading) && !sessionsDataState.hasData;
  const sourceUnresolved = !sessionsDataState.hasData || !Array.isArray(response?.sessions);
  const importBlocked = !scopeReady || sessionsDataState.isRefreshBlocked
    || (!allVehicles && (vehiclesState.status !== 'ok'));
  const unavailableMessage = t('tesla_sessions.sourceUnavailable', 'Fleet charging sessions have not loaded. Retry this source or reconnect to continue.');
  const refreshMutation = useRefreshTeslaChargingSessions();

  const allSessions = useMemo(() => response?.sessions ?? [], [response?.sessions]);
  const { start, end, startInstant, endInstantExclusive } = useRangeState({
    persistKey: 'tesla-charging-sessions.range',
    defaultPresetId: 'all',
  });
  const sessions = useMemo(() => {
    if (!allSessions.length) return allSessions;
    const startMs = new Date(startInstant).getTime();
    const endMs = new Date(endInstantExclusive).getTime();
    return allSessions.filter((s) => {
      if (!s.charge_start_datetime) return false;
      const ts = new Date(s.charge_start_datetime).getTime();
      return ts >= startMs && ts < endMs;
    });
  }, [allSessions, startInstant, endInstantExclusive]);
  const summary = response?.summary;
  const lifetimeCurrency = useMemo(() => sourceCurrency(allSessions), [allSessions]);
  const scopedCurrency = useMemo(() => sourceCurrency(sessions), [sessions]);
  const formatCurrency = useCallback((amount: number) => formatSourceAmount(amount, scopedCurrency),
    [formatSourceAmount, scopedCurrency]);

  const vehicleOptions = useMemo(() => {
    const opts = [{
      value: ALL_VEHICLES_VIN,
      label: t('tesla_sessions.allVehicles', 'All vehicles'),
    }];
    for (const v of vehicles) {
      opts.push({ value: v.vin, label: `${v.display_name} (${v.vin.slice(-6)})` });
    }
    if (!opts.some(option => option.value === selectedVin)) {
      opts.push({ value: selectedVin, label: selectedVin || t('operations.status.unavailable', 'Data unavailable') });
    }
    return opts;
  }, [vehicles, selectedVin, t]);

  const monthlyData = useMemo(() => scopedCurrency ? buildMonthlyCost(
    sessions.filter(session => session.total_cost != null && Number.isFinite(session.total_cost)),
  ) : [], [sessions, scopedCurrency]);

  const mapPoints = useMemo(() =>
    sessions.filter((s) => s.latitude != null && s.longitude != null),
    [sessions],
  );

  // Derived breakdown: energy grouped by charger type (Supercharger / DC / etc.).
  const chargerTypeBreakdown = useMemo(() => {
    const unknown = t('tesla_sessions.unknownType', 'Unknown');
    return groupSessions(sessions, (s) => s.charger_type || unknown)
      .map(bucket => ({
        ...bucket,
        hasEnergy: sessions.some(session => (session.charger_type || unknown) === bucket.key
          && session.total_energy_added_wh != null && Number.isFinite(session.total_energy_added_wh)),
      }))
      .sort((a, b) => b.energyWh - a.energyWh);
  }, [sessions, t]);
  const maxChargerEnergy = useMemo(
    () => chargerTypeBreakdown.reduce((m, c) => Math.max(m, c.energyWh), 0),
    [chargerTypeBreakdown],
  );

  // Derived breakdown: top charging sites ranked by total spend.
  const topLocations = useMemo(() => {
    const unknown = t('tesla_sessions.unknown', 'Unknown');
    return groupSessions(sessions, (s) => s.site_location_name || unknown)
      .map(bucket => ({
        ...bucket,
        hasCost: sessions.some(session => (session.site_location_name || unknown) === bucket.key
          && session.total_cost != null && Number.isFinite(session.total_cost)),
      }))
      .sort((a, b) => scopedCurrency
        ? (b.cost ?? 0) - (a.cost ?? 0) || b.energyWh - a.energyWh
        : a.key.localeCompare(b.key))
      .slice(0, 6);
  }, [sessions, t, scopedCurrency]);
  const maxLocationCost = useMemo(
    () => topLocations.reduce((m, l) => Math.max(m, l.cost ?? 0), 0),
    [topLocations],
  );

  const lastSync = response && sessions.length > 0 ? sessions[0]?.fetched_at : null;

  const handleRefresh = () => {
    if (importBlocked) return;
    refreshMutation.mutate(queryVin ? { vin: queryVin } : undefined);
  };

  const is403 = refreshMutation.error
    && typeof refreshMutation.error === 'object'
    && 'status' in refreshMutation.error
    && refreshMutation.error.status === 403;
  const retainedUnconfirmed = sessionsDataState.hasData && (
    sessionsDataState.refreshError != null
    || sessionsDataState.isRefreshBlocked
    || sessionsDataState.status === 'stale'
    || (!allVehicles && vehiclesState.status !== 'ok')
  );

  const operationalTotals = useMemo(() => {
    let totalWh = 0;
    let totalCost = 0;
    let totalFees = 0;
    let durationSeconds = 0;
    let durationCount = 0;
    let missingCostCount = 0;
    let energyCount = 0;
    let costCount = 0;

    for (const session of sessions) {
      totalWh += session.total_energy_added_wh ?? 0;
      if (Number.isFinite(session.total_cost ?? 0)) totalCost += session.total_cost ?? 0;
      totalFees += (Number.isFinite(session.idle_fee ?? 0) ? session.idle_fee ?? 0 : 0)
        + (Number.isFinite(session.congestion_fee ?? 0) ? session.congestion_fee ?? 0 : 0);
      if (session.total_cost == null || !Number.isFinite(session.total_cost)) missingCostCount += 1;
      if (session.total_energy_added_wh != null && Number.isFinite(session.total_energy_added_wh)) energyCount += 1;
      if (session.total_cost != null && Number.isFinite(session.total_cost)) costCount += 1;
      if (session.charge_duration_s != null && Number.isFinite(session.charge_duration_s) && session.charge_duration_s >= 0) {
        durationSeconds += session.charge_duration_s;
        durationCount += 1;
      }
    }

    return {
      totalWh: energyCount > 0 ? totalWh : null,
      totalCost: costCount > 0 && scopedCurrency ? totalCost : null,
      totalFees: scopedCurrency ? totalFees : 0,
      missingCostCount,
      averageDurationSeconds: durationCount > 0 ? durationSeconds / durationCount : null,
    };
  }, [sessions, scopedCurrency]);

  const chargingAttention = useMemo<OperationalAttention[]>(() => {
    const items: OperationalAttention[] = [];
    if (sessions.length > 0 && !scopedCurrency) {
      items.push({
        key: 'currency',
        title: unknownCurrency,
        description: currencyUnavailable,
        tone: 'warning',
      });
    }

    if (is403) {
      items.push({
        key: 'business-access',
        title: t('operations.charging.businessAccessTitle', 'Tesla Fleet Charging access required'),
        description: t('operations.charging.businessAccessDescription', 'This import requires a Tesla business account with Fleet Charging access.'),
        tone: 'warning',
      });
    }
    if (!sourceUnresolved && !isLoading && !error && sessions.length === 0) {
      items.push({
        key: 'no-sessions',
        title: t('operations.charging.noSessionsTitle', 'No sessions in this analysis window'),
        description: t('operations.charging.noSessionsDescription', 'Adjust the vehicle or date scope, or refresh from Tesla to import recent history.'),
        tone: 'info',
      });
    }
    if (operationalTotals.totalFees > 0) {
      items.push({
        key: 'fees',
        title: t('operations.charging.feesTitle', 'Charging fees need review'),
        description: t(
          'operations.charging.feesDescription',
          '{{amount}} in idle or congestion fees was recorded in this window.',
          { amount: formatCurrency(operationalTotals.totalFees) },
        ),
        tone: 'warning',
      });
    }
    if (operationalTotals.missingCostCount > 0) {
      items.push({
        key: 'partial-cost',
        title: t('operations.charging.partialCostTitle', 'Cost coverage is incomplete'),
        description: t(
          'operations.charging.partialCostDescription',
          '{{count}} sessions have no reported cost, so totals are partial.',
          { count: operationalTotals.missingCostCount },
        ),
        tone: 'warning',
      });
    }

    return items;
  }, [error, formatCurrency, is403, isLoading, operationalTotals, sessions.length, sourceUnresolved, t, scopedCurrency, currencyUnavailable, unknownCurrency]);
  const narrativeEvidence: OperationalNarrative['evidence'] = sessions
    .slice(0, 5)
    .map((session) => ({
      id: `fleet-charging-session-${session.id}`,
      summary: t(
        'operations.charging.fleetNarrative.sessionSummary',
        '{{date}} at {{site}}: {{energy}} added with {{cost}} recorded cost.',
        {
          date: session.charge_start_datetime,
          site:
            session.site_location_name
            || t('operations.charging.fleetNarrative.unknownSite', 'unrecorded site'),
          energy: session.total_energy_added_wh == null ? '—' : formatEnergy(session.total_energy_added_wh),
          cost:
            session.total_cost == null
              ? t('operations.charging.fleetNarrative.costMissing', 'no')
              : formatSourceAmount(session.total_cost, sourceCurrency([session])),
        },
      ),
      observedAt: session.charge_start_datetime,
      provenance: {
        source: t(
          'operations.charging.fleetNarrative.source',
          'Tesla Fleet Charging sessions',
        ),
        recordId: String(session.session_id),
        method: t(
          'operations.charging.fleetNarrative.sessionMethod',
          'Direct business-account charging session returned by Tesla Fleet Charging.',
        ),
      },
    }));
  const narrative: OperationalNarrative = {
    whatChanged: t(
      'operations.charging.fleetNarrative.whatChanged',
      '{{sessions}} Fleet Charging sessions delivered {{energy}} with {{cost}} in recorded fees.',
      {
        sessions: sessions.length,
        energy: operationalTotals.totalWh == null ? '—' : formatEnergy(operationalTotals.totalWh),
        cost: operationalTotals.totalCost == null ? '—' : formatCurrency(operationalTotals.totalCost),
      },
    ),
    whyItMatters: t(
      'operations.charging.fleetNarrative.impact',
      'Business-account session records provide auditable site, energy, fee, and charger evidence for fleet cost review.',
    ),
    confidence: {
      label:
        sessions.length > 0 && operationalTotals.missingCostCount === 0
          ? 'high'
          : sessions.length > 0
            ? 'medium'
            : 'low',
      score: null,
      basis: [
        t(
          'operations.charging.fleetNarrative.sessionBasis',
          '{{count}} direct Fleet Charging sessions match the active filters.',
          { count: sessions.length },
        ),
        operationalTotals.missingCostCount === 0
          ? t(
              'operations.charging.fleetNarrative.costBasis',
              'Every matching session includes a recorded cost.',
            )
          : t(
              'operations.charging.fleetNarrative.costLimitedBasis',
              '{{count}} matching session lacks recorded cost.',
              { count: operationalTotals.missingCostCount },
            ),
      ],
    },
    likelyCause: null,
    recommendedResponse:
      chargingAttention[0]?.description
      ?? t(
        'operations.charging.fleetNarrative.monitorResponse',
        'No immediate response is indicated; continue reviewing site costs and newly synchronized sessions.',
      ),
    limitations: [
      ...(!scopedCurrency && sessions.length > 0 ? [currencyUnavailable] : []),
      t(
        'operations.charging.fleetNarrative.accountLimitation',
        'This source is available only to eligible Tesla business accounts.',
      ),
      ...(operationalTotals.missingCostCount > 0
        ? [
            t(
              'operations.charging.fleetNarrative.missingCostLimitation',
              'Cost totals exclude sessions without a fee supplied by Tesla.',
            ),
          ]
        : []),
      t(
        'operations.charging.fleetNarrative.causeLimitation',
        'Session records show observed energy and fees but do not diagnose the cause of charging behavior.',
      ),
      t(
        'operations.charging.fleetNarrative.evidenceLimit',
        'Supporting evidence is limited to the five most recent sessions matching the active filters.',
      ),
    ],
    evidence: narrativeEvidence,
    provenance: [
      {
        source: t(
          'operations.charging.fleetNarrative.source',
          'Tesla Fleet Charging sessions',
        ),
        method: t(
          'operations.charging.fleetNarrative.sourceMethod',
          'Aggregates energy, direct Tesla fee fields, charger type, and site from synchronized business-account sessions.',
        ),
      },
    ],
  };

  const selectedVehicleLabel = vehicleOptions.find((option) => option.value === selectedVin)?.label
    ?? (selectedVin || t('operations.status.unavailable', 'Data unavailable'));
  const filteredNoMatch = !sourceUnresolved && allSessions.length > 0 && sessions.length === 0;
  const noMatchMessage = t('tesla_sessions.noMatch', 'No fleet charging sessions match this analysis window.');
  const emptyScopeGuidance = t(
    'tesla_sessions.emptyScopeGuidance',
    'Scope: {{vehicle}}, {{start}} to {{end}}. Change the vehicle or widen or clear the date range in View settings to review another scope.',
    { vehicle: selectedVehicleLabel, start, end },
  );

  const columns: Column<TeslaChargingSession>[] = useMemo(() => [
    {
      key: 'date',
      filterValue: (row) => row.charge_start_datetime ?? null,
      filterValueLabel: (_, row) => formatDateTime(row.charge_start_datetime),
      header: t('tesla_sessions.col.date', 'Date'),
      render: (row) => (
        <Text variant="body">{formatDateTime(row.charge_start_datetime)}</Text>
      ),
      sortable: true,
      visibleOnMobile: true,
    },
    {
      key: 'location',
      filterValue: (row) => row.site_location_name || null,
      header: t('tesla_sessions.col.location', 'Location'),
      render: (row) => (
        <div className="flex items-center gap-1.5">
          <Icon icon={MapPin} size="sm" className={typography.color.muted} />
          <Text variant="body" className="min-w-0 break-words">
            {row.site_location_name || '—'}
          </Text>
        </div>
      ),
      visibleOnMobile: true,
    },
    {
      key: 'vin',
      filterValue: (row) => row.vin || null,
      filterValueLabel: (_, row) => row.vin ? `…${row.vin.slice(-6)}` : '—',
      header: t('tesla_sessions.col.vin', 'VIN'),
      render: (row) => (
        <Text size="sm" color="secondary" mono>
          {row.vin ? `…${row.vin.slice(-6)}` : '—'}
        </Text>
      ),
      defaultVisible: false,
    },
    {
      key: 'energy',
      align: 'right',
      filterValue: (row) => row.total_energy_added_wh ?? null,
      filterValueLabel: (_, row) => row.total_energy_added_wh != null ? fmtNumber(convertEnergyFromSI(row.total_energy_added_wh, 'kWh')) : '—',
      header: t('tesla_sessions.col.energy', 'Energy (kWh)'),
      render: (row) => (
        <Text size="sm" weight="medium" color="primary">
          {row.total_energy_added_wh != null ? fmtNumber(convertEnergyFromSI(row.total_energy_added_wh, 'kWh')) : '—'}
        </Text>
      ),
      sortable: true,
      visibleOnMobile: true,
    },
    {
      key: 'peakPower',
      align: 'right',
      header: t('tesla_sessions.col.peakPower', 'Peak (kW)'),
      render: (row) => (
        <Text size="sm" color="primary">
          {row.peak_power_kw != null ? fmtNumber(row.peak_power_kw) : '—'}
        </Text>
      ),
      sortable: true,
    },
    {
      key: 'duration',
      align: 'right',
      filterValue: (row) => row.charge_duration_s ?? null,
      filterValueLabel: (_, row) => formatChargingDuration(row.charge_duration_s),
      header: t('tesla_sessions.col.duration', 'Duration'),
      render: (row) => (
        <Text variant="body">
          {formatChargingDuration(row.charge_duration_s)}
        </Text>
      ),
    },
    {
      key: 'cost',
      align: 'right',
      filterValue: (row) => row.total_cost == null ? null : `${row.currency_code ?? ''}:${row.total_cost}`,
      filterValueLabel: (_, row) => row.total_cost != null ? formatSourceAmount(row.total_cost, sourceCurrency([row])) : '—',
      header: t('tesla_sessions.col.cost_decimal', 'Cost'),
      render: (row) => (
        <Text size="sm" weight="medium" color="primary">
          {row.total_cost != null
            ? formatSourceAmount(row.total_cost, sourceCurrency([row]))
            : '—'}
        </Text>
      ),
      sortable: true,
      visibleOnMobile: true,
    },
    {
      key: 'rate',
      align: 'right',
      header: t('tesla_sessions.col.rate', 'Rate/kWh'),
      render: (row) => (
        <Text size="sm" color="secondary">
          {row.per_kwh_rate != null
            ? formatSourceAmount(row.per_kwh_rate, sourceCurrency([row]))
            : '—'}
        </Text>
      ),
      defaultVisible: false,
    },
    {
      key: 'type',
      filterValue: (row) => row.charger_type ?? null,
      header: t('tesla_sessions.col.type', 'Type'),
      render: (row) => (
        <Text size="xs" color="secondary">
          {row.charger_type ?? '—'}
        </Text>
      ),
    },
  ], [t, formatSourceAmount, fmtNumber, formatChargingDuration]);

  const [sortKey, setSortKey] = useState<string>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedKeys, setSelectedKeys] = useState<(string | number)[]>([]);

  const sortedSessions = useMemo(() => {
    const sorted = [...sessions];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'date':
          cmp = a.charge_start_datetime.localeCompare(b.charge_start_datetime);
          break;
        case 'energy':
          cmp = (a.total_energy_added_wh ?? 0) - (b.total_energy_added_wh ?? 0);
          break;
        case 'peakPower':
          cmp = (a.peak_power_kw ?? 0) - (b.peak_power_kw ?? 0);
          break;
        case 'cost':
          cmp = (a.currency_code ?? '').localeCompare(b.currency_code ?? '')
            || (a.total_cost ?? 0) - (b.total_cost ?? 0);
          break;
        default:
          cmp = a.charge_start_datetime.localeCompare(b.charge_start_datetime);
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return sorted;
  }, [sessions, sortKey, sortDir]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  // CSV export of selected sessions for client-side analysis / Tesla audit.
  const exportSelectedCsv = useCallback(
    (rows: TeslaChargingSession[]) => {
      if (rows.length === 0) return;
      const header = [
        'date', 'location', 'vin', 'energy_wh', 'peak_power_kw',
        'duration_seconds', 'cost', 'currency', 'per_kwh_rate', 'charger_type',
      ];
      const lines = [header.join(',')];
      for (const r of rows) {
        const fields = [
          r.charge_start_datetime,
          (r.site_location_name ?? '').replace(/[",\n]/g, ' '),
          r.vin ?? '',
          r.total_energy_added_wh != null ? String(r.total_energy_added_wh) : '',
          r.peak_power_kw != null ? String(r.peak_power_kw) : '',
          r.charge_duration_s != null ? String(r.charge_duration_s) : '',
          r.total_cost != null ? String(r.total_cost) : '',
          r.currency_code ?? '',
          r.per_kwh_rate != null ? String(r.per_kwh_rate) : '',
          r.charger_type ?? '',
        ];
        lines.push(fields.map(f => `"${String(f).replace(/"/g, '""')}"`).join(','));
      }
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tesla-fleet-sessions-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [],
  );

  const contextActions = (
    <>
      <Select
        options={vehicleOptions}
        value={selectedVin}
        onChange={(e) => setSelectedVin(e.target.value)}
        className="w-full min-w-0 sm:w-56"
        aria-label={t('tesla_sessions.selectVehicle', 'Select vehicle')}
      />
    </>
  );

  const primaryAction = (
    <IconButton icon={<Icon icon={RefreshCw} />} label={t('tesla_sessions.refresh', 'Refresh from Tesla')} onClick={handleRefresh} busy={refreshMutation.isPending} disabled={importBlocked} />
  );
  const summaryMetrics: StatMetric[] = [
    { metricId: 'count', occurrenceId: 'sessions', label: t('tesla_sessions.stats.sessions', 'Total sessions'),
      rawValue: sessionsDataState.hasData ? summary?.total_sessions : null,
      display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) } },
    { metricId: 'energy', occurrenceId: 'energy', label: t('tesla_sessions.stats.energy', 'Total energy'),
      rawValue: summary?.total_wh,
      display: { formatter: raw => ({ value: formatEnergy(raw), unit: '' }) } },
    { metricId: 'currency', occurrenceId: 'cost', label: t('tesla_sessions.stats.cost_decimal', 'Total cost'),
      rawValue: lifetimeCurrency ? summary?.total_cost : null,
      missingReason: lifetimeCurrency ? undefined : currencyUnavailable,
      display: { formatter: raw => ({ value: formatSourceAmount(raw, lifetimeCurrency), unit: '' }) } },
    { metricId: 'currency', occurrenceId: 'average-cost', label: t('tesla_sessions.stats.avgCost', 'Avg cost/kWh'),
      rawValue: lifetimeCurrency ? summary?.avg_cost_per_kwh : null,
      missingReason: lifetimeCurrency ? undefined : currencyUnavailable,
      display: { formatter: raw => ({ value: formatSourceAmount(raw, lifetimeCurrency), unit: '' }) } },
    { metricId: 'power', occurrenceId: 'peak-power', label: t('tesla_sessions.stats.peakPower', 'Peak power'),
      rawValue: summary?.peak_power_kw != null ? summary.peak_power_kw * 1000 : null,
      display: { formatter: raw => ({ value: fmtNumber(raw / 1000), unit: 'kW' }) } },
  ];
  const scopedMetrics = useOperationalMetrics([
    { metricId: 'count', occurrenceId: 'sessions', label: t('tesla_sessions.stats.sessions', 'Total sessions'),
      rawValue: sourceUnresolved || isLoading || error ? null : sessions.length,
      description: t('operations.charging.sessionsDetail', 'Sessions matching the active vehicle and date scope.'),
      display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) } },
    { metricId: 'energy', occurrenceId: 'energy', label: t('tesla_sessions.stats.energy', 'Total energy'),
      rawValue: sourceUnresolved || isLoading || error ? null : operationalTotals.totalWh,
      description: t('operations.charging.energyDetail', 'Energy added across the matching charging sessions.'),
      display: { formatter: raw => ({ value: formatEnergy(raw), unit: '' }) } },
    { metricId: 'currency', occurrenceId: 'cost', label: t('tesla_sessions.stats.cost_decimal', 'Total cost'),
      rawValue: sourceUnresolved || isLoading || error || sessions.length === 0 ? null : operationalTotals.totalCost,
      description: scopedCurrency ? t('operations.charging.costDetail', 'Reported session cost; sessions without cost remain flagged as partial.') : currencyUnavailable,
      display: { formatter: raw => ({ value: formatCurrency(raw), unit: '' }) } },
    { metricId: 'duration', occurrenceId: 'duration', label: t('operations.charging.averageDuration', 'Average duration'),
      rawValue: sourceUnresolved || isLoading || error ? null : operationalTotals.averageDurationSeconds,
      description: t('operations.charging.durationDetail', 'Mean charging duration for sessions with valid timing data.'),
      display: { formatter: raw => ({ value: formatChargingDuration(raw), unit: '' }) } },
  ]);

  return (
    <PageLayout
      title={t('tesla_sessions.title', 'Fleet charging sessions')}
      subtitle={t('tesla_sessions.subtitle', 'Detailed charging session data from Tesla (business accounts only)')}
      query={sessionsQuery}
      contextActions={contextActions}
      primaryAction={primaryAction}
    >
      {!allVehicles && (
        <div data-testid="vehicle-source-state">
          {(vehiclesState.refreshError || vehiclesState.isRefreshBlocked || vehiclesState.status === 'stale') && (
            <StaleRefreshWarning state={vehiclesState} label={t('common.vehicles', 'Vehicles')} />
          )}
          {vehiclesState.fatalError && (
            <QueryError error={vehiclesState.fatalError} onRetry={vehiclesState.retry ?? undefined} />
          )}
          {!scopeReady && !vehiclesLoading && !vehiclesState.fatalError && (
            <DataStateNotice state="unavailable" title={t('common.vehicles', 'Vehicles')} role="status">
              {unavailableMessage}
              <Button variant="ghost" onClick={vehiclesState.retry ?? undefined}>
                {t('common.retry', 'Retry')}
              </Button>
            </DataStateNotice>
          )}
        </div>
      )}
      <StaleRefreshWarning state={sessionsDataState} label={t('tesla_sessions.title', 'Fleet charging sessions')} />
      {sourceUnresolved && sessionsDataState.isRefreshBlocked ? (
        <DataStateNotice state="unavailable" title={t('tesla_sessions.title', 'Fleet charging sessions')} role="status">
          {unavailableMessage}
        </DataStateNotice>
      ) : null}
      {error && (
        <QueryError error={error} onRetry={() => sessionsQuery.refetch()} />
      )}

      <OperationalBrief
        compact
        loading={isLoading && !sessionsDataState.hasData}
        testId="charging-operational-brief"
        eyebrow={t('operations.charging.eyebrow', 'Charging posture')}
        title={t('operations.charging.returnedSessionsTitle', 'Cost, energy, and session evidence in one operating view')}
        description={t('operations.charging.returnedSessionsDescription', 'The selected vehicle and date range drive charging totals, location analysis, and the supporting session history.')}
        statusLabel={
          error || (sourceUnresolved && (!scopeReady || sessionsDataState.isRefreshBlocked) && !isLoading)
            ? t('operations.status.unavailable', 'Data unavailable')
            : isLoading
              ? t('operations.charging.sessionsLoading', 'Updating')
              : is403
                ? t('operations.status.prerequisite', 'Prerequisite required')
                : retainedUnconfirmed
                  ? t('dataState.stale.title', 'Data may be stale')
                : sessions.length === 0
                  ? t('operations.status.awaitingData', 'Awaiting data')
                  : chargingAttention.length > 0
                    ? t('operations.status.review', 'Review recommended')
                    : t('charging.brief.available', 'Source measurements available')
        }
        statusTone={
          error
            ? 'danger'
            : sourceUnresolved || isLoading || sessions.length === 0
              ? 'neutral'
              : retainedUnconfirmed || chargingAttention.length > 0
                ? 'warning'
                : 'success'
        }
        narrative={sourceUnresolved ? undefined : narrative}
        scope={
          <>
            <Badge variant="neutral" size="sm">{selectedVehicleLabel}</Badge>
            <Badge variant="neutral" size="sm">{start} – {end}</Badge>
          </>
        }
        freshness={
          <div className="flex flex-wrap items-center gap-2">
            <DataProvenanceBadge
              provenance={sessionsDataState.provenance}
              status={sessionsDataState.status}
              updatedAt={sessionsDataState.updatedAt}
            />
          </div>
        }
        metrics={scopedMetrics.map(metric => ({ ...metric,
          tone: metric.key === 'cost' && operationalTotals.totalFees > 0 ? 'warning' : 'neutral',
        }))}
        attention={chargingAttention}
        provenance={t('operations.charging.returnedSessionsProvenance', 'Derived from Tesla Fleet Charging session history, reported costs, and SI energy values converted only for display.')}
      />

      {/* Business-account note + sync status */}
      <FadeIn>
        <section aria-label={t('tesla_sessions.infoSection', 'Fleet charging info')}>
          <GlassPanel className="p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <Icon icon={Building2} size="lg" className={`mt-0.5 ${typography.color.secondary}`} />
                <Text as="p" size="sm" color="secondary">
                  {t(
                    'tesla_sessions.businessNote',
                    'Fleet charging session data is only available for Tesla business accounts. Personal accounts will receive a 403 error when syncing.',
                  )}
                </Text>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:shrink-0 sm:justify-end">
                {is403 && (
                  <Text as="span" size="sm" className={`inline-flex items-center gap-1.5 ${neonColorMap.amber.text}`}>
                    <Icon icon={AlertCircle} />
                    {t('tesla_sessions.businessOnly', 'Business account required')}
                  </Text>
                )}
                {lastSync && (
                  <Text as="span" size="xs" color="muted">
                    {t('tesla_sessions.lastSync', 'Last synced')}: {formatDateTime(lastSync)}
                  </Text>
                )}
              </div>
            </div>
          </GlassPanel>
        </section>
      </FadeIn>

      {/* KPI band — full-width responsive metric grid */}
      <FadeIn delay={0.06}>
        <section
          aria-label={t('tesla_sessions.kpis', 'Summary metrics')}
        >
          <ChargingSummaryBrief id="tesla-fleet-charging-summary" metrics={summaryMetrics} loading={isLoading}
            retained={retainedUnconfirmed}
            period={{
              kind: 'unknown', label: t('tesla_sessions.kpis', 'Summary metrics'),
              reason: t('tesla_sessions.summaryScope', 'Tesla lifetime summary. The analysis window filters loaded sessions, charts, and operational totals separately.'),
            }}
          />
        </section>
      </FadeIn>

      {/* Wait oracle — forward-looking queue forecast per site */}
      <FadeIn delay={0.09}>
        <section aria-label={t('tesla_sessions.oracleSection', 'Wait forecast')}>
          <SectionErrorBoundary name="TeslaChargingWaitForecast">
            <WaitOraclePanel />
          </SectionErrorBoundary>
        </section>
      </FadeIn>

      {/* Cost analysis bento — monthly cost hero + charger-type breakdown */}
      <FadeIn delay={0.12}>
        <section
          aria-label={t('tesla_sessions.costSection', 'Cost analysis')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
        >
          <div className="min-w-0 xl:col-span-2">
            <ChartContainer
              title={t('tesla_sessions.monthlyCost', 'Monthly charging cost')}
              ariaLabel={t('tesla_sessions.monthlyCostAria', 'Monthly Tesla charging cost bar chart')}
              data={monthlyData.map((m) => ({ month: m.month, total: m.total, currency: scopedCurrency }))}
              dataColumns={[
                { key: 'month', label: t('tesla_sessions.col.month', 'Month') },
                { key: 'total', label: `${t('tesla_sessions.col.cost_decimal', 'Cost')} (${scopedCurrency ?? '—'})` },
                { key: 'currency', label: t('charging.currency', 'Currency') },
              ]}
              height={280}
              loading={isLoading}
              error={error}
              onRetry={() => { void sessionsQuery.refetch(); }}
              exportData={monthlyData}
              // tz-export: export filename keeps a sortable YYYY-MM-DD date
              exportFilename={`tesla-monthly-cost-${new Date().toISOString().slice(0, 10)}`}
            >
              {isLoading ? (
                <ChartSkeleton
                  className="h-[280px]"
                  label={t('tesla_sessions.monthlyCostLoading', 'Loading monthly charging costs…')}
                />
              ) : monthlyData.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={monthlyData}>
                    {chartGrid}
                    <XAxis dataKey="month" tick={axisTickSm} />
                    <YAxis tick={axisTickSm} tickFormatter={(v: number) => formatCurrency(v)} />
                    <Tooltip content={<ChartTooltip valueFormatter={value => typeof value === 'number' ? formatCurrency(value) : '—'} />} />
                    <Bar dataKey="total" name={scopedCurrency ?? '—'} fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState
                  icon={<Icon icon={DollarSign} size="xl" />}
                  message={sourceUnresolved ? unavailableMessage : filteredNoMatch ? noMatchMessage : sessions.length > 0 && !scopedCurrency ? currencyUnavailable : t('tesla_sessions.noChartData', 'No cost data yet. Click "Refresh from Tesla" to sync.')}
                />
              )}
            </ChartContainer>
          </div>

          <LayoutCard title={t('tesla_sessions.chargerType', 'Energy by charger type')}
            actions={<Icon icon={Plug} className={typography.color.secondary} />}>
            <SectionErrorBoundary name="TeslaChargingChargerTypes">
            {error ? <QueryError error={error} onRetry={() => { void sessionsQuery.refetch(); }} /> : isLoading ? (
              <ListSkeleton
                rows={3}
                label={t('tesla_sessions.chargerTypeLoading', 'Loading charger breakdown…')}
                testId="charger-type-loading"
              />
            ) : chargerTypeBreakdown.length > 0 ? (
              <div className="space-y-3">
                {chargerTypeBreakdown.map((c, i) => (
                  <MetricBar
                    key={c.key}
                    label={c.key}
                    value={c.hasEnergy ? c.energyWh : null}
                    max={maxChargerEnergy || 1}
                    color={CHART_COLORS[i % CHART_COLORS.length]}
                    fill="solid"
                    sublabel={`${c.hasEnergy ? formatEnergy(c.energyWh) : '—'} · ${fmtInt(c.count)}×`}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Icon icon={Plug} size="xl" />}
                message={sourceUnresolved ? unavailableMessage : filteredNoMatch ? noMatchMessage : t('tesla_sessions.noChargerData', 'No charger breakdown yet.')}
              />
            )}
            </SectionErrorBoundary>
          </LayoutCard>
        </section>
      </FadeIn>

      {/* Locations bento — session map hero + top locations by spend */}
      <FadeIn delay={0.16}>
        <section
          aria-label={t('tesla_sessions.locationsSection', 'Session locations')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
        >
          <div className="min-w-0 xl:col-span-2">
          <LayoutCard title={t('tesla_sessions.map', 'Session locations')}
            actions={<Icon icon={MapPin} className={typography.color.secondary} />}>
            <SectionErrorBoundary name="TeslaChargingSessionMap">
            {error ? <QueryError error={error} onRetry={() => { void sessionsQuery.refetch(); }} /> : isLoading ? (
              <ChartSkeleton
                className="h-[350px]"
                bars={10}
                label={t('tesla_sessions.mapLoading', 'Loading charging locations…')}
              />
            ) : mapPoints.length > 0 ? (
              <Suspense
                fallback={(
                  <ChartSkeleton
                    className="h-[350px]"
                    bars={10}
                    label={t('tesla_sessions.mapLoading', 'Loading charging locations…')}
                  />
                )}
              >
                <LazyMap sessions={mapPoints} />
              </Suspense>
            ) : (
              <EmptyState
                icon={<Icon icon={MapPin} size="xl" />}
                message={sourceUnresolved ? unavailableMessage : filteredNoMatch ? noMatchMessage : t('tesla_sessions.noMapData', 'No location data available yet.')}
              />
            )}
            </SectionErrorBoundary>
          </LayoutCard>
          </div>

          <LayoutCard title={t('tesla_sessions.topLocations', 'Top locations by cost')}
            actions={<Icon icon={Building2} className={typography.color.secondary} />}>
            <SectionErrorBoundary name="TeslaChargingTopLocations">
            {error ? <QueryError error={error} onRetry={() => { void sessionsQuery.refetch(); }} /> : isLoading ? (
              <ListSkeleton
                rows={3}
                label={t('tesla_sessions.topLocationsLoading', 'Loading top charging locations…')}
                testId="charging-locations-loading"
              />
            ) : topLocations.length > 0 ? (
              <div className="space-y-3">
                {!scopedCurrency && <Text color="secondary">{currencyUnavailable}</Text>}
                {topLocations.map((l, i) => (
                  <MetricBar
                    key={l.key}
                    label={l.key}
                    value={l.hasCost && scopedCurrency && l.cost != null && l.cost >= 0 ? l.cost : null}
                    max={maxLocationCost || 1}
                    color={CHART_COLORS[i % CHART_COLORS.length]}
                    fill="solid"
                    sublabel={`${l.hasCost && l.cost != null ? formatCurrency(l.cost) : '—'} · ${fmtInt(l.count)}×`}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Icon icon={MapPin} size="xl" />}
                message={sourceUnresolved ? unavailableMessage : filteredNoMatch ? noMatchMessage : t('tesla_sessions.noLocationData', 'No location breakdown yet.')}
              />
            )}
            </SectionErrorBoundary>
          </LayoutCard>
        </section>
      </FadeIn>

      {/* Full-width detail band — sessions table */}
      <FadeIn delay={0.2}>
        <section aria-label={t('tesla_sessions.tableSection', 'Charging sessions table')}>
          <LayoutCard title={t('tesla_sessions.table', 'Charging sessions')}>
            <SectionErrorBoundary name="TeslaChargingSessionsTable">
            {error ? <QueryError error={error} onRetry={() => { void sessionsQuery.refetch(); }} /> : isLoading ? (
              <TableSkeleton rows={7} cols={5} />
            ) : sessions.length > 0 ? (
              <DataTable
                mobilePresentation={{
                  variant: 'cards',
                  roles: { location: 'title', cost: 'primary', date: 'meta', energy: 'meta', duration: 'meta', type: 'badge' },
                  displayValue: (row, key) => {
                    switch (key) {
                      case 'location': return row.site_location_name || '—';
                      case 'date': return formatDateTime(row.charge_start_datetime);
                      case 'energy': return row.total_energy_added_wh == null ? null
                        : fmtNumber(convertEnergyFromSI(row.total_energy_added_wh, 'kWh'));
                      case 'duration': return formatChargingDuration(row.charge_duration_s);
                      case 'cost': return row.total_cost == null ? null
                        : formatSourceAmount(row.total_cost, sourceCurrency([row]));
                      case 'type': return row.charger_type;
                      case 'vin': return row.vin ? `…${row.vin.slice(-6)}` : null;
                      case 'peakPower': return row.peak_power_kw == null ? null : fmtNumber(row.peak_power_kw);
                      case 'rate': return row.per_kwh_rate == null ? null
                        : formatSourceAmount(row.per_kwh_rate, sourceCurrency([row]));
                      default: return null;
                    }
                  },
                  state: retainedUnconfirmed ? {
                    kind: 'error',
                    message: t('dataState.stale.title', 'Data may be stale'),
                    retained: sessions.length > 0,
                    retrying: sessionsQuery.isFetching,
                  } : { kind: 'ready' },
                  onRetry: () => { void sessionsQuery.refetch(); },
                  // Native field names are diagnostic data, not translated display headings.
                  // VIN retains the table's existing privacy mask, including in raw metadata.
                  allDetails: row => Object.entries(row).map(([key, value]) => ({
                    key,
                    label: key,
                    value: <Code className="whitespace-pre-wrap break-all">{
                      JSON.stringify(key === 'vin' && typeof value === 'string' ? `…${value.slice(-6)}` : value)
                    }</Code>,
                  })),
                }}
                enableValueFilters
                columns={columns}
                data={sortedSessions}
                keyExtractor={(row) => row.session_id}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
                pagination={{ defaultPageSize: 25, pageSizeOptions: [25, 50, 100] }}
                tableId="tesla-charging-sessions"
                columnVisibility
                columnReorder
                stickyHeader
                maxHeight={600}
                virtualized
                rowHeight={56}
                exportable
                // tz-export: export filename keeps a sortable YYYY-MM-DD date
                exportFilename={`tesla-fleet-sessions-${new Date().toISOString().slice(0, 10)}`}
                exportRow={(row) => ({
                  date: row.charge_start_datetime,
                  location: row.site_location_name ?? '',
                  vin: row.vin ?? '',
                  energy: row.total_energy_added_wh != null
                    ? convertEnergyFromSI(row.total_energy_added_wh, 'kWh') : null,
                  peakPower: row.peak_power_kw ?? null,
                  duration: formatChargingDuration(row.charge_duration_s),
                  cost: row.total_cost != null
                    ? formatSourceAmount(row.total_cost, sourceCurrency([row])) : null,
                  currency: row.currency_code ?? '',
                  rate: row.per_kwh_rate != null
                    ? formatSourceAmount(row.per_kwh_rate, sourceCurrency([row])) : null,
                  type: row.charger_type ?? '',
                })}
                selectable="multi"
                // A11Y: the first column is a bare date, which many
                // rows share. Pair it with the site so each checkbox
                // names the session it toggles.
                rowLabel={(row) =>
                  t('tesla_sessions.rowLabel', '{{site}}, {{date}}', {
                    site:
                      row.site_location_name ||
                      t('tesla_sessions.unknownSite', 'Unknown site'),
                    date: formatDateTime(row.charge_start_datetime),
                  })
                }
                selectedKeys={selectedKeys}
                onSelectionChange={setSelectedKeys}
                bulkActions={(rows) => (
                  <Button
                    size="sm"
                    variant="primary"
                    className="min-h-11 min-w-11"
                    icon={<Icon icon={Download} size="sm" />}
                    onClick={() => exportSelectedCsv(rows)}
                  >
                    {t('table.bulkActions.exportCsv', 'Export CSV')}
                  </Button>
                )}
              />
            ) : (
              <EmptyState
                icon={<Icon icon={Info} size="xl" />}
                message={sourceUnresolved ? unavailableMessage : filteredNoMatch ? noMatchMessage : t('tesla_sessions.noData', 'No fleet charging sessions yet. Click "Refresh from Tesla" to import data.')}
                description={sourceUnresolved ? undefined : emptyScopeGuidance}
              />
            )}
            </SectionErrorBoundary>
          </LayoutCard>
        </section>
      </FadeIn>
    </PageLayout>
  );
}
