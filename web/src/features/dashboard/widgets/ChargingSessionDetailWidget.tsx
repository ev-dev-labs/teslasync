import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, chartGrid, axisTick, axisTickSm, chartAnimation, areaGradient, ChartLegend, EmbeddedChart, useMeasuredAxisWidth, measureAxisLabelWidth, type ChartDataRow } from '@/components/charts';
import { ChartTooltip } from '@/components/charts';
import { EmptyState, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { SourceContent } from '@/components/layout';
import { combineDataStates, deriveDataState, knownNumber } from '@/api/dataState';
import { useUnits } from '@/hooks/useUnits';
import { useChargingSessions, useChargingSessionDetail, useChargeTelemetry } from '@/api/hooks/useCharging';
import { useVehicles } from '@/api/hooks/useVehicles';

import { convertEnergyFromSI, convertPowerFromSI } from '@/lib/unitConversion';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetChartSummary, type ChartSummaryStat } from './shared';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { classifyChargingSource, type ChargerKind } from '@/lib/chargerKind';

interface ChartDatum extends ChartDataRow {
  time: string;
  power: number | null;
  soc: number | null;
}

interface ChargerClass {
  kind: ChargerKind;
  variant: 'warning' | 'neutral';
}

/**
 * Classify a raw charger-type string into a stable, translatable `kind` plus a
 * Badge variant. Returning a discriminator (rather than a baked-in English
 * label) keeps this pure/testable and defers the user-visible copy to the
 * render boundary via `t()`.
 */
function classifyCharger(chargerType: string | null): ChargerClass {
  const kind = classifyChargingSource(chargerType);
  return { kind, variant: kind === 'supercharger' || kind === 'dcFast' ? 'warning' : 'neutral' };
}

export function chargingAxisWidth(labels: string[], measure: (label: string) => number): number {
  return measureAxisLabelWidth(labels, measure, 36, 12);
}

export default function ChargingSessionDetailWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber: fmt } = useNumberFormatting();
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { unitPrefs } = useUnits();

  const sessionsQuery = useChargingSessions(vid > 0 ? String(vid) : undefined);
  const { data: sessions } = sessionsQuery;

  const latestSessionId = useMemo(() => {
    const list = sessions ?? [];
    if (list.length === 0) return null;
    const latest = list.reduce((a, b) =>
      new Date(a.startedAt) > new Date(b.startedAt) ? a : b,
    );
    const id = Number(latest.id);
    return Number.isFinite(id) ? id : null;
  }, [sessions]);

  const detailQuery = useChargingSessionDetail(latestSessionId);
  const {
    data: detail,
    isLoading: detailLoading,
    isFetching, isStale, isError, dataUpdatedAt,
  } = detailQuery;

  const telemetryQuery = useChargeTelemetry(latestSessionId);
  const {
    data: telemetry,
    isLoading: telemetryLoading,
  } = telemetryQuery;

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;
  const isLoading = !detail && (sessionsQuery.isLoading || detailLoading || telemetryLoading);
  const sessionsState = deriveDataState(sessionsQuery, { provenance: 'historical' });
  const detailState = deriveDataState(detailQuery, { provenance: 'historical' });
  const telemetryState = deriveDataState(telemetryQuery, { provenance: 'historical' });
  const combined = combineDataStates([
    sessionsState,
    detailState,
    telemetryState,
  ]);
  const hasPayload = detail != null || telemetry != null || sessions != null;
  const dataState = isCompact
    ? latestSessionId == null ? sessionsState : detailState
    : {
      ...detailState,
      ...combined,
      data: detail ?? telemetry ?? sessions,
      hasData: hasPayload,
      fatalError: hasPayload ? null : sessionsState.fatalError ?? detailState.fatalError ?? telemetryState.fatalError,
    };
  const refresh = () => {
    void sessionsQuery.refetch?.();
    void detailQuery.refetch();
    void telemetryQuery.refetch?.();
  };

  const chartData = useMemo((): ChartDatum[] => {
    const points = telemetry ?? [];
    return points.map((p) => {
      const ts = new Date(p.created_at);
      const power = knownNumber(p.power_w);
      return {
        time: `${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`,
        power: power != null ? convertPowerFromSI(power, unitPrefs.power) : null,
        soc: knownNumber(p.battery_level) ?? knownNumber(p.soc),
      };
    });
  }, [telemetry, unitPrefs.power]);

  const durationStr = useMemo(() => {
    if (!detail) return '—';
    const mins = knownNumber(detail.duration_min);
    if (mins == null || mins < 0) return '—';
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }, [detail]);

  const peakPower = useMemo(() => {
    const points = telemetry ?? [];
    const powers = points.map(p => knownNumber(p.power_w)).filter((value): value is number => value != null);
    return powers.length > 0 ? convertPowerFromSI(Math.max(...powers), unitPrefs.power) : null;
  }, [telemetry, unitPrefs.power]);

  const charger = useMemo(
    () => classifyCharger(detail?.charger_type ?? null),
    [detail],
  );

  const chargerLabel = useMemo(() => {
    switch (charger.kind) {
      case 'supercharger':
        return t('widget.chargingSessionDetail.chargerSupercharger', 'Supercharger');
      case 'dcFast':
        return t('widget.chargingSessionDetail.chargerDcFast', 'DC fast');
      case 'acHome':
        return t('widget.chargingSessionDetail.chargerAcHome', 'AC / home');
      default:
        return t('common.unknown', 'Unknown');
    }
  }, [charger, t]);

  const stats = useMemo((): ChartSummaryStat[] => {
    if (!detail) return [];
    return [
      {
        label: t('widget.chargingSessionDetail.energy', 'Energy added'),
        value: knownNumber(detail.total_energy_added_wh) == null ? null : fmtNumber(convertEnergyFromSI(detail.total_energy_added_wh, unitPrefs.energy)),
        unit: unitPrefs.energy,
      },
      {
        label: t('widget.chargingSessionDetail.duration', 'Duration'),
        value: durationStr,
      },
      {
        label: t('widget.chargingSessionDetail.peakPower', 'Peak power'),
        value: peakPower == null ? null : fmtNumber(peakPower),
        unit: unitPrefs.power,
      },
      {
        label: t('widget.chargingSessionDetail.charger', 'Charger'),
        value: chargerLabel,
      },
    ];
  }, [detail, durationStr, peakPower, chargerLabel, t, unitPrefs.energy, unitPrefs.power, fmtNumber]);

  const tick = isWide ? axisTick : axisTickSm;
  const axisLabels = useMemo(() => {
    const powers = chartData.flatMap(point => point.power == null ? [] : [point.power]);
    // Include the next magnitude boundary that automatic nice ticks can reach.
    const bounds = powers.map(value => {
      const magnitude = 10 ** Math.floor(Math.log10(Math.abs(value) || 1));
      return Math.sign(value) * Math.ceil(Math.abs(value) / magnitude) * magnitude;
    });
    return {
      power: [0, ...powers, ...bounds].map(value => fmt(value)),
      soc: [0, 25, 50, 75, 100].map(value => `${fmt(value)}%`),
    };
  }, [chartData, fmt]);
  const powerAxisWidth = useMeasuredAxisWidth({
    labels: axisLabels.power,
    fontSize: tick.fontSize,
    enabled: !isCompact,
    minWidth: 36,
    padding: 12,
    fallbackCharacterRatio: 0.75,
  });
  const socAxisWidth = useMeasuredAxisWidth({
    labels: axisLabels.soc,
    fontSize: tick.fontSize,
    enabled: !isCompact,
    minWidth: 36,
    padding: 12,
    fallbackCharacterRatio: 0.75,
  });

  const chart = useMemo(() => {
    return (
      <SourceContent
        state={telemetryState.fatalError ? 'error' : !telemetryState.hasData && telemetryLoading ? 'loading' : telemetryState.refreshError ? 'retained' : 'ready'}
        label={t('widget.chargingSessionDetail.telemetry', 'Charging telemetry')}
        emptyMessage={t('widget.chargingSessionDetail.noTelemetry', 'No charging telemetry is available for this session')}
        errorMessage={t('widget.chargingSessionDetail.telemetryError', 'Charging telemetry could not be loaded.')}
        error={telemetryState.fatalError}
        errorRecovery={{ onRetry: telemetryState.retry ?? undefined }}
        retainedMessage={t('widget.chargingSessionDetail.telemetryRetained', 'Previously loaded charging telemetry remains visible while it refreshes.')}
      >
      <EmbeddedChart
        title={t('widget.chargingSessionDetail.title', 'Charge session detail')}
        ariaLabel={t(
          'widget.chargingSessionDetail.chartAria',
          'Charging power and battery state of charge over the latest session',
        )}
        empty={chartData.length === 0}
        emptyMessage={t(
          'widget.chargingSessionDetail.noTelemetry',
          'No charging telemetry is available for this session',
        )}
        data={chartData}
        dataColumns={[
          { key: 'time', label: t('widget.chargingSessionDetail.time', 'Time') },
          { key: 'power', label: `${t('widget.power', 'Power')} (${unitPrefs.power})` },
          { key: 'soc', label: t('widget.chargingSessionDetail.soc', 'SOC %') },
        ]}
        chartKey="dashboard-charging-session-detail"
      >
        {({ hiddenSeries }) => (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
          data={chartData}
          margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
          {...chartAnimation}
        >
          {areaGradient('charge-power-grad', '#22c55e')}
          {chartGrid}

          <XAxis
            dataKey="time"
            tick={tick}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />

          <YAxis
            yAxisId="power"
            tick={tick}
            tickLine={false}
            axisLine={false}
            width={powerAxisWidth}
            domain={['auto', 'auto']}
            tickFormatter={(v: number) => fmt(v)}
          />

          <YAxis
            yAxisId="soc"
            orientation="right"
            tick={tick}
            tickLine={false}
            axisLine={false}
            width={socAxisWidth}
            domain={[0, 100]}
            tickFormatter={(v: number) => `${fmt(v)}%`}
          />

          <Tooltip content={<ChartTooltip />} />
          <ChartLegend />

          <Area
            yAxisId="power"
            dataKey="power"
            stroke="#22c55e"
            fill="url(#charge-power-grad)"
            fillOpacity={0.3}
            strokeWidth={1.5}
            name={`${t('widget.power', 'Power')} (${unitPrefs.power})`}
            connectNulls={false}
            hide={hiddenSeries?.isHidden('power')}
          />

          <Line
            yAxisId="soc"
            dataKey="soc"
            stroke="#22d3ee"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
            name={t('widget.chargingSessionDetail.soc', 'SOC %')}
            connectNulls={false}
            hide={hiddenSeries?.isHidden('soc')}
          />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </EmbeddedChart>
      </SourceContent>
    );
  }, [chartData, tick, t, unitPrefs.power, fmt, powerAxisWidth, socAxisWidth, telemetryState, telemetryLoading]);

  // ── Compact layout: large kWh number + charger badge ──
  if (isCompact) {
    return (
      <WidgetShell
        title={t('widget.chargingSessionDetail.title', 'Charge session detail')}
        loading={isLoading}
        dataState={dataState}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching || telemetryQuery.isFetching || sessionsQuery.isFetching}
        isStale={isStale}
        isError={isError || telemetryQuery.isError || sessionsQuery.isError}
        onRefresh={refresh}
      >
        {detail ? (
          <WidgetBigNumber
            value={knownNumber(detail.total_energy_added_wh) == null ? null : fmtNumber(convertEnergyFromSI(detail.total_energy_added_wh, unitPrefs.energy))}
            label={unitPrefs.energy === 'kWh' ? t('widget.chargingSessionDetail.unitKwh', 'kWh added') : `${unitPrefs.energy} ${t('widget.energyAdded', 'Added')}`}
            badge={{ text: chargerLabel, variant: charger.variant }}
            align="center"
            animated={false}
            valueColor="text-emerald-300"
          />
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Zap className="h-5 w-5" />}
            message={t('widget.chargingSessionDetail.empty', 'No charge sessions')}
            className="py-4"
          />
        )}
      </WidgetShell>
    );
  }

  // ── Standard / Wide layout ──
  return (
    <WidgetShell
      title={t('widget.chargingSessionDetail.title', 'Charge session detail')}
      icon={<Zap className="h-3.5 w-3.5 text-emerald-400" />}
      loading={isLoading}
      dataState={dataState}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching || telemetryQuery.isFetching || sessionsQuery.isFetching}
      isStale={isStale}
      isError={isError || telemetryQuery.isError || sessionsQuery.isError}
      onRefresh={refresh}
    >
      {sessionsState.fatalError && <QueryError error={sessionsState.fatalError} onRetry={sessionsState.retry ?? undefined} />}
      {detailState.fatalError && <QueryError error={detailState.fatalError} onRetry={detailState.retry ?? undefined} />}
      <StaleRefreshWarning state={detailState} />
      {latestSessionId != null && !detail && !detailState.fatalError && (
        <SourceContent
          state={detailState.status === 'initial' ? 'loading' : 'empty'}
          label={t('widget.chargingSessionDetail.title', 'Charge session detail')}
          emptyMessage={t('widget.chargingSessionDetail.empty', 'No charge sessions')}
          errorMessage={t('widget.chargingSessionDetail.empty', 'No charge sessions')}
        >
          {null}
        </SourceContent>
      )}
      <WidgetChartSummary
        stats={stats}
        chart={chart}
        isEmpty={!detail && latestSessionId == null && chartData.length === 0}
        emptyMessage={t('widget.chargingSessionDetail.empty', 'No charge sessions')}
        emptyIcon={<Zap className="h-5 w-5" />}
      />
    </WidgetShell>
  );
}
