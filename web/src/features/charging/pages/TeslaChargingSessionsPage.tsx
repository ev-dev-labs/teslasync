import { useState, useMemo, useCallback, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Zap, DollarSign, RefreshCw, MapPin, TrendingUp, Gauge, Clock,
  Building2, Info, Download, AlertCircle, Plug,
} from 'lucide-react';
import { PageContainer } from '@/components/layout';
import {
  Badge,
  GlassPanel,
  Button,
  Select,
  DataTable,
  PanelTitle,
  Text,
  type Column,
} from '@/components/ui';
import {
  StatCard,
  MetricBar,
  DataFreshnessAuto,
  DataProvenanceBadge,
  OperationalBrief,
  type OperationalAttention,
} from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import {
  ChartContainer, ChartTooltip, ChartGradient, chartGrid, axisTickSm,
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CHART_COLORS,
} from '@/components/charts';
import {
  ChartSkeleton,
  EmptyState,
  ListSkeleton,
  QueryError,
  TableSkeleton,
} from '@/components/feedback';
import { RangePicker } from '@/components/forms';
import {
  useTeslaChargingSessions,
  useRefreshTeslaChargingSessions,
  type TeslaChargingSession,
} from '@/api/hooks/useCharging';
import { useVehicles } from '@/api/hooks/useVehicles';
import { usePageTitle } from '@/hooks/usePageTitle';
import {
  ALL_VEHICLES_VIN,
  useVehicleVinFilter,
} from '@/hooks/useVehicleVinFilter';
import { useRangeState } from '@/hooks/useRangeState';
import { useUnits } from '@/hooks/useUnits';
import { useSettings } from '@/hooks/useSettings';
import { useFormatting } from '@/hooks/useFormatting';
import { useDataState } from '@/hooks/useDataState';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { convertEnergyFromSI } from '@/lib/unitConversion';
import { formatCurrencyValue, currencyCodeFromSymbol } from '@/lib/currencyFormat';
import type { OperationalNarrative } from '@/types/operationalNarrative';

const LazyMap = lazy(() => import('./TeslaChargingSessionsMap'));

/**
 * Format an SI-seconds duration to "Xh Ym".
 * Guards null / undefined / NaN / Infinity / negative input by returning an
 * em dash so malformed telemetry can never render "NaNm" or "-2m".
 */
export function formatDurationSeconds(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Aggregate sessions by month for the cost chart. Rows whose
 * `charge_start_datetime` is missing or unparseable are skipped so a single
 * malformed timestamp can't pollute the chart with a "NaN-NaN" bucket.
 */
export function buildMonthlyCost(sessions: TeslaChargingSession[]): { month: string; total: number }[] {
  const map = new Map<string, number>();
  for (const s of sessions) {
    if (!s.charge_start_datetime) continue;
    const d = new Date(s.charge_start_datetime);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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
  cost: number;
}

/** Roll sessions up by a string key, summing count / energy / cost (all null-safe). */
export function groupSessions(
  sessions: TeslaChargingSession[],
  keyOf: (s: TeslaChargingSession) => string,
): GroupBucket[] {
  const map = new Map<string, GroupBucket>();
  for (const s of sessions) {
    const key = keyOf(s);
    const cur = map.get(key) ?? { key, count: 0, energyWh: 0, cost: 0 };
    cur.count += 1;
    cur.energyWh += s.total_energy_added_wh ?? 0;
    cur.cost += s.total_cost ?? 0;
    map.set(key, cur);
  }
  return Array.from(map.values());
}

export default function TeslaChargingSessionsPage() {
  const { t } = useTranslation();
  const { formatEnergy } = useUnits();
  const { settings, locale } = useSettings();
  const { formatCurrency } = useFormatting();
  const userCurrency = currencyCodeFromSymbol(settings.currency_symbol);
  usePageTitle(t('tesla_sessions.title', 'Fleet Charging Sessions'));

  const { isLoading: vehiclesLoading } = useVehicles();
  const {
    queryVin,
    selectedVin,
    setSelectedVin,
    vehicles,
  } = useVehicleVinFilter();
  const sessionsQuery = useTeslaChargingSessions(queryVin, {
    enabled: !vehiclesLoading,
  });
  const {
    data: response,
    isLoading: sessionsLoading,
    error,
  } = sessionsQuery;
  const sessionsDataState = useDataState(sessionsQuery, { provenance: 'historical' });
  const isLoading = vehiclesLoading || sessionsLoading;
  const refreshMutation = useRefreshTeslaChargingSessions();

  const allSessions = response?.sessions ?? [];
  // Range filter (client-side) on charge_start_datetime.
  const { start, end, setRange } = useRangeState({
    persistKey: 'tesla-charging-sessions.range',
    defaultPresetId: 'all',
  });
  const sessions = useMemo(() => {
    if (!allSessions.length) return allSessions;
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return allSessions.filter((s) => {
      if (!s.charge_start_datetime) return false;
      const ts = new Date(s.charge_start_datetime).getTime();
      return ts >= startMs && ts <= endMs;
    });
  }, [allSessions, start, end]);
  const summary = response?.summary ?? {
    total_sessions: 0, total_wh: null, total_cost: null, avg_cost_per_kwh: null, peak_power_kw: null,
  };

  const vehicleOptions = useMemo(() => {
    const opts = [{
      value: ALL_VEHICLES_VIN,
      label: t('tesla_sessions.allVehicles', 'All Vehicles'),
    }];
    for (const v of vehicles) {
      opts.push({ value: v.vin, label: `${v.display_name} (${v.vin.slice(-6)})` });
    }
    return opts;
  }, [vehicles, t]);

  const monthlyData = useMemo(() => buildMonthlyCost(sessions), [sessions]);

  const mapPoints = useMemo(() =>
    sessions.filter((s) => s.latitude != null && s.longitude != null),
    [sessions],
  );

  // Derived breakdown: energy grouped by charger type (Supercharger / DC / etc.).
  const chargerTypeBreakdown = useMemo(() => {
    const unknown = t('tesla_sessions.unknownType', 'Unknown');
    return groupSessions(sessions, (s) => s.charger_type || unknown)
      .sort((a, b) => b.energyWh - a.energyWh || b.cost - a.cost);
  }, [sessions, t]);
  const maxChargerEnergy = useMemo(
    () => chargerTypeBreakdown.reduce((m, c) => Math.max(m, c.energyWh), 0),
    [chargerTypeBreakdown],
  );

  // Derived breakdown: top charging sites ranked by total spend.
  const topLocations = useMemo(() => {
    const unknown = t('tesla_sessions.unknown', 'Unknown');
    return groupSessions(sessions, (s) => s.site_location_name || unknown)
      .sort((a, b) => b.cost - a.cost || b.energyWh - a.energyWh)
      .slice(0, 6);
  }, [sessions, t]);
  const maxLocationCost = useMemo(
    () => topLocations.reduce((m, l) => Math.max(m, l.cost), 0),
    [topLocations],
  );

  const lastSync = response && sessions.length > 0 ? sessions[0]?.fetched_at : null;

  const handleRefresh = () => {
    refreshMutation.mutate(queryVin ? { vin: queryVin } : undefined);
  };

  const is403 = refreshMutation.error
    && typeof refreshMutation.error === 'object'
    && 'status' in (refreshMutation.error as unknown as Record<string, unknown>)
    && (refreshMutation.error as unknown as Record<string, unknown>).status === 403;

  const operationalTotals = useMemo(() => {
    let totalWh = 0;
    let totalCost = 0;
    let totalFees = 0;
    let durationSeconds = 0;
    let durationCount = 0;
    let missingCostCount = 0;

    for (const session of sessions) {
      totalWh += session.total_energy_added_wh ?? 0;
      totalCost += session.total_cost ?? 0;
      totalFees += (session.idle_fee ?? 0) + (session.congestion_fee ?? 0);
      if (session.total_cost == null) missingCostCount += 1;
      if (session.charge_duration_s != null && Number.isFinite(session.charge_duration_s)) {
        durationSeconds += session.charge_duration_s;
        durationCount += 1;
      }
    }

    return {
      totalWh,
      totalCost,
      totalFees,
      missingCostCount,
      averageDurationSeconds: durationCount > 0 ? durationSeconds / durationCount : null,
    };
  }, [sessions]);

  const chargingAttention = useMemo<OperationalAttention[]>(() => {
    const items: OperationalAttention[] = [];

    if (is403) {
      items.push({
        key: 'business-access',
        title: t('operations.charging.businessAccessTitle', 'Tesla Fleet Charging access required'),
        description: t('operations.charging.businessAccessDescription', 'This import requires a Tesla business account with Fleet Charging access.'),
        tone: 'warning',
      });
    }
    if (!isLoading && !error && sessions.length === 0) {
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
          { amount: formatCurrency(operationalTotals.totalFees, 2) },
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
  }, [error, formatCurrency, is403, isLoading, operationalTotals, sessions.length, t]);
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
          energy: formatEnergy(session.total_energy_added_wh ?? 0),
          cost:
            session.total_cost == null
              ? t('operations.charging.fleetNarrative.costMissing', 'no')
              : formatCurrency(session.total_cost, 2),
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
        energy: formatEnergy(operationalTotals.totalWh),
        cost: formatCurrency(operationalTotals.totalCost, 2),
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
    ?? t('tesla_sessions.allVehicles', 'All Vehicles');

  const columns: Column<TeslaChargingSession>[] = useMemo(() => [
    {
      key: 'date',
      header: t('tesla_sessions.col.date', 'Date'),
      render: (row) => (
        <Text variant="body">{formatDateTime(row.charge_start_datetime)}</Text>
      ),
      sortable: true,
      visibleOnMobile: true,
    },
    {
      key: 'location',
      header: t('tesla_sessions.col.location', 'Location'),
      render: (row) => (
        <div className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" aria-hidden="true" />
          <Text variant="body" className="truncate max-w-[200px]">
            {row.site_location_name || '—'}
          </Text>
        </div>
      ),
      visibleOnMobile: true,
    },
    {
      key: 'vin',
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
      header: t('tesla_sessions.col.energy', 'Energy (kWh)'),
      render: (row) => (
        <Text size="sm" weight="medium" className="text-cyan-300">
          {row.total_energy_added_wh != null ? fmtNumber(convertEnergyFromSI(row.total_energy_added_wh, 'kWh'), 1) : '—'}
        </Text>
      ),
      sortable: true,
      visibleOnMobile: true,
    },
    {
      key: 'peakPower',
      header: t('tesla_sessions.col.peakPower', 'Peak (kW)'),
      render: (row) => (
        <Text size="sm" className="text-amber-300">
          {row.peak_power_kw != null ? fmtNumber(row.peak_power_kw, 0) : '—'}
        </Text>
      ),
      sortable: true,
    },
    {
      key: 'duration',
      header: t('tesla_sessions.col.duration', 'Duration'),
      render: (row) => (
        <Text variant="body">
          {formatDurationSeconds(row.charge_duration_s)}
        </Text>
      ),
    },
    {
      key: 'cost',
      header: t('tesla_sessions.col.cost_decimal', 'Cost'),
      render: (row) => (
        <Text size="sm" weight="medium" className="text-emerald-300">
          {row.total_cost != null
            ? formatCurrencyValue(row.total_cost, row.currency_code ?? userCurrency, locale, 2, { useGrouping: true })
            : '—'}
        </Text>
      ),
      sortable: true,
      visibleOnMobile: true,
    },
    {
      key: 'rate',
      header: t('tesla_sessions.col.rate', 'Rate/kWh'),
      render: (row) => (
        <Text size="sm" color="secondary">
          {row.per_kwh_rate != null
            ? formatCurrencyValue(row.per_kwh_rate, row.currency_code ?? userCurrency, locale, 3, { useGrouping: true })
            : '—'}
        </Text>
      ),
      defaultVisible: false,
    },
    {
      key: 'type',
      header: t('tesla_sessions.col.type', 'Type'),
      render: (row) => (
        <Text size="xs" color="secondary" className="uppercase tracking-wide">
          {row.charger_type ?? '—'}
        </Text>
      ),
    },
  ], [t, userCurrency, locale]);

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
          cmp = (a.total_cost ?? 0) - (b.total_cost ?? 0);
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
      <RangePicker
        value={{ start, end }}
        onChange={setRange}
        align="end"
        triggerTestId="tesla-charging-sessions-range"
      />
    </>
  );

  const primaryAction = (
    <Button
      onClick={handleRefresh}
      loading={refreshMutation.isPending}
      icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
    >
      {t('tesla_sessions.refresh', 'Refresh from Tesla')}
    </Button>
  );

  return (
    <PageContainer
      title={t('tesla_sessions.title', 'Fleet Charging Sessions')}
      subtitle={t('tesla_sessions.subtitle', 'Detailed charging session data from Tesla (business accounts only)')}
      query={sessionsQuery}
      contextActions={contextActions}
      primaryAction={primaryAction}
    >
      {error && (
        <QueryError error={error} onRetry={() => sessionsQuery.refetch()} />
      )}

      <OperationalBrief
        testId="charging-operational-brief"
        eyebrow={t('operations.charging.eyebrow', 'Charging posture')}
        title={t('operations.charging.title', 'Cost, energy, and session evidence in one operating view')}
        description={t('operations.charging.description', 'The selected vehicle and date range drive charging totals, location analysis, and the supporting session history.')}
        statusLabel={
          error
            ? t('operations.status.unavailable', 'Data unavailable')
            : isLoading
              ? t('operations.status.loading', 'Updating')
              : is403
                ? t('operations.status.prerequisite', 'Prerequisite required')
                : sessions.length === 0
                  ? t('operations.status.awaitingData', 'Awaiting data')
                  : chargingAttention.length > 0
                    ? t('operations.status.review', 'Review recommended')
                    : t('operations.status.onTrack', 'On track')
        }
        statusTone={
          error
            ? 'danger'
            : isLoading || sessions.length === 0
              ? 'neutral'
              : chargingAttention.length > 0
                ? 'warning'
                : 'success'
        }
        narrative={narrative}
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
            <DataFreshnessAuto
              query={sessionsQuery}
              source={t(
                'operations.charging.fleetNarrative.source',
                'Tesla Fleet Charging sessions',
              )}
            />
          </div>
        }
        metrics={[
          {
            key: 'sessions',
            label: t('tesla_sessions.stats.sessions', 'Total Sessions'),
            value: isLoading || error ? '—' : fmtInt(sessions.length),
            detail: t('operations.charging.sessionsDetail', 'Sessions matching the active vehicle and date scope.'),
            tone: 'info',
          },
          {
            key: 'energy',
            label: t('tesla_sessions.stats.energy', 'Total Energy'),
            value: isLoading || error
              ? '—'
              : formatEnergy(operationalTotals.totalWh, { precision: 1 }),
            detail: t('operations.charging.energyDetail', 'Energy added across the matching charging sessions.'),
            tone: 'success',
          },
          {
            key: 'cost',
            label: t('tesla_sessions.stats.cost_decimal', 'Total Cost'),
            value: isLoading || error || sessions.length === 0
              ? '—'
              : formatCurrency(operationalTotals.totalCost, 2),
            detail: t('operations.charging.costDetail', 'Reported session cost; sessions without cost remain flagged as partial.'),
            tone: operationalTotals.totalFees > 0 ? 'warning' : 'neutral',
          },
          {
            key: 'duration',
            label: t('operations.charging.averageDuration', 'Average duration'),
            value: isLoading || error
              ? '—'
              : formatDurationSeconds(operationalTotals.averageDurationSeconds),
            detail: t('operations.charging.durationDetail', 'Mean charging duration for sessions with valid timing data.'),
            tone: 'neutral',
          },
        ]}
        attention={chargingAttention}
        provenance={t('operations.charging.provenance', 'Derived from Tesla Fleet Charging session history, reported costs, and SI energy values converted only for display.')}
      />

      {/* Business-account note + sync status */}
      <FadeIn>
        <section aria-label={t('tesla_sessions.infoSection', 'Fleet charging info')}>
          <GlassPanel className="p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden="true" />
                <Text as="p" size="sm" color="secondary">
                  {t(
                    'tesla_sessions.businessNote',
                    'Fleet charging session data is only available for Tesla business accounts. Personal accounts will receive a 403 error when syncing.',
                  )}
                </Text>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:shrink-0 sm:justify-end">
                {is403 && (
                  <Text as="span" size="sm" className="inline-flex items-center gap-1.5 text-amber-300">
                    <AlertCircle className="h-4 w-4" aria-hidden="true" />
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
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5"
        >
          <StatCard
            label={t('tesla_sessions.stats.sessions', 'Total Sessions')}
            value={fmtInt(summary.total_sessions)}
            icon={<Zap className="h-5 w-5 text-cyan-300" aria-hidden="true" />}
            loading={isLoading}
          />
          <StatCard
            label={t('tesla_sessions.stats.energy', 'Total Energy')}
            value={summary.total_wh != null ? formatEnergy(summary.total_wh, { precision: 1 }) : '—'}
            icon={<Gauge className="h-5 w-5 text-amber-300" aria-hidden="true" />}
            loading={isLoading}
          />
          <StatCard
            label={t('tesla_sessions.stats.cost_decimal', 'Total Cost')}
            value={summary.total_cost != null ? formatCurrency(summary.total_cost, 2) : '—'}
            icon={<DollarSign className="h-5 w-5 text-emerald-300" aria-hidden="true" />}
            loading={isLoading}
          />
          <StatCard
            label={t('tesla_sessions.stats.avgCost', 'Avg Cost/kWh')}
            value={summary.avg_cost_per_kwh != null ? formatCurrency(summary.avg_cost_per_kwh, 3) : '—'}
            icon={<TrendingUp className="h-5 w-5 text-purple-300" aria-hidden="true" />}
            loading={isLoading}
          />
          <StatCard
            label={t('tesla_sessions.stats.peakPower', 'Peak Power')}
            value={summary.peak_power_kw != null ? fmtNumber(summary.peak_power_kw, 0) : '—'}
            unit="kW"
            icon={<Clock className="h-5 w-5 text-orange-300" aria-hidden="true" />}
            loading={isLoading}
          />
        </section>
      </FadeIn>

      {/* Cost analysis bento — monthly cost hero + charger-type breakdown */}
      <FadeIn delay={0.12}>
        <section
          aria-label={t('tesla_sessions.costSection', 'Cost analysis')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
        >
          <div className="xl:col-span-2">
            <ChartContainer
              title={t('tesla_sessions.monthlyCost', 'Monthly Charging Cost')}
              ariaLabel={t('tesla_sessions.monthlyCost.aria', 'Monthly Tesla charging cost bar chart')}
              data={monthlyData.map((m) => ({ month: m.month, total: m.total }))}
              dataColumns={[
                { key: 'month', label: t('tesla_sessions.col.month', 'Month') },
                { key: 'total', label: t('tesla_sessions.col.total', 'Total ($)') },
              ]}
              height={280}
              exportFilename={`tesla-monthly-cost-${new Date().toISOString().slice(0, 10)}`}
            >
              {isLoading ? (
                <ChartSkeleton
                  className="h-[280px]"
                  label={t('tesla_sessions.monthlyCost.loading', 'Loading monthly charging costs…')}
                />
              ) : monthlyData.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={monthlyData}>
                    <defs>
                      <ChartGradient id="sessionCostGrad" color="#22d3ee" opacity={0.6} />
                    </defs>
                    {chartGrid}
                    <XAxis dataKey="month" tick={axisTickSm} />
                    <YAxis tick={axisTickSm} tickFormatter={(v: number) => formatCurrency(v, 0)} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="total" fill="url(#sessionCostGrad)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState
                  icon={<DollarSign className="h-10 w-10" />}
                  message={t('tesla_sessions.noChartData', 'No cost data yet. Click "Refresh from Tesla" to sync.')}
                />
              )}
            </ChartContainer>
          </div>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Plug className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('tesla_sessions.chargerType', 'Energy by Charger Type')}
            </PanelTitle>
            {isLoading ? (
              <ListSkeleton
                rows={3}
                label={t('tesla_sessions.chargerType.loading', 'Loading charger breakdown…')}
                testId="charger-type-loading"
              />
            ) : chargerTypeBreakdown.length > 0 ? (
              <div className="space-y-3">
                {chargerTypeBreakdown.map((c, i) => (
                  <MetricBar
                    key={c.key}
                    label={c.key.toUpperCase()}
                    value={c.energyWh}
                    max={maxChargerEnergy || 1}
                    color={CHART_COLORS[i % CHART_COLORS.length]}
                    sublabel={`${formatEnergy(c.energyWh, { precision: 1 })} · ${fmtInt(c.count)}×`}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Plug className="h-8 w-8" />}
                message={t('tesla_sessions.noChargerData', 'No charger breakdown yet.')}
              />
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* Locations bento — session map hero + top locations by spend */}
      <FadeIn delay={0.16}>
        <section
          aria-label={t('tesla_sessions.locationsSection', 'Session locations')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
        >
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('tesla_sessions.map', 'Session Locations')}
            </PanelTitle>
            {isLoading ? (
              <ChartSkeleton
                className="h-[350px]"
                bars={10}
                label={t('tesla_sessions.map.loading', 'Loading charging locations…')}
              />
            ) : mapPoints.length > 0 ? (
              <Suspense
                fallback={(
                  <ChartSkeleton
                    className="h-[350px]"
                    bars={10}
                    label={t('tesla_sessions.map.loading', 'Loading charging locations…')}
                  />
                )}
              >
                <LazyMap sessions={mapPoints} />
              </Suspense>
            ) : (
              <EmptyState
                icon={<MapPin className="h-10 w-10" />}
                message={t('tesla_sessions.noMapData', 'No location data available yet.')}
              />
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('tesla_sessions.topLocations', 'Top Locations by Cost')}
            </PanelTitle>
            {isLoading ? (
              <ListSkeleton
                rows={3}
                label={t('tesla_sessions.topLocations.loading', 'Loading top charging locations…')}
                testId="charging-locations-loading"
              />
            ) : topLocations.length > 0 ? (
              <div className="space-y-3">
                {topLocations.map((l, i) => (
                  <MetricBar
                    key={l.key}
                    label={l.key}
                    value={l.cost}
                    max={maxLocationCost || 1}
                    color={CHART_COLORS[i % CHART_COLORS.length]}
                    sublabel={`${formatCurrency(l.cost, 0)} · ${fmtInt(l.count)}×`}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<MapPin className="h-8 w-8" />}
                message={t('tesla_sessions.noLocationData', 'No location breakdown yet.')}
              />
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* Full-width detail band — sessions table */}
      <FadeIn delay={0.2}>
        <section aria-label={t('tesla_sessions.tableSection', 'Charging sessions table')}>
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3">
              {t('tesla_sessions.table', 'Charging Sessions')}
            </PanelTitle>
            {isLoading ? (
              <TableSkeleton rows={7} cols={5} />
            ) : sessions.length > 0 ? (
              <DataTable
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
                exportFilename={`tesla-fleet-sessions-${new Date().toISOString().slice(0, 10)}`}
                exportRow={(row) => ({
                  date: row.charge_start_datetime,
                  location: row.site_location_name ?? '',
                  vin: row.vin ?? '',
                  energy: row.total_energy_added_wh ?? null,
                  peakPower: row.peak_power_kw ?? null,
                  duration: row.charge_duration_s ?? null,
                  cost: row.total_cost ?? null,
                  rate: row.per_kwh_rate ?? null,
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
                    icon={<Download className="h-3.5 w-3.5" aria-hidden="true" />}
                    onClick={() => exportSelectedCsv(rows)}
                  >
                    {t('table.bulkActions.exportCsv', 'Export CSV')}
                  </Button>
                )}
              />
            ) : (
              <EmptyState
                icon={<Info className="h-10 w-10" />}
                message={t('tesla_sessions.noData', 'No fleet charging sessions yet. Click "Refresh from Tesla" to import data.')}
              />
            )}
          </GlassPanel>
        </section>
      </FadeIn>
    </PageContainer>
  );
}
