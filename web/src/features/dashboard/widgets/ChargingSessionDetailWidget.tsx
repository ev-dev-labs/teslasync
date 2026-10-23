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
import { useDateFormat } from '@/hooks/useDateFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid, type ChartSummaryStat } from './shared';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { classifyChargingSource, type ChargerKind } from '@/lib/chargerKind';
import { dashboardTokens } from '../lib/dashboardTokens';

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
  const { fmtNumber: fmt, fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { formatDateShort, formatTime } = useDateFormat();
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { unitPrefs } = useUnits();

  const sessionsQuery = useChargingSessions(vid > 0 ? String(vid) : undefined);
  const { data: sessions } = sessionsQuery;

  const latestSessionId = useMemo(() => {
    const list = sessions ?? [];
    if (list.length === 0) return null;
    const latest = list.reduce((a, b) =>
      new Date(a.startedAt ?? a.started_at) > new Date(b.startedAt ?? b.started_at) ? a : b,
    );
    const id = Number(latest.id);
    return Number.isFinite(id) ? id : null;
  }, [sessions]);

  const latestSession = useMemo(() => {
    const list = sessions ?? [];
    if (list.length === 0) return null;
    return list.reduce((a, b) =>
      new Date(a.startedAt ?? a.started_at) > new Date(b.startedAt ?? b.started_at) ? a : b,
    );
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
        time: Number.isNaN(ts.getTime()) ? '—' : formatTime(ts),
        power: power != null ? convertPowerFromSI(power, unitPrefs.power) : null,
        soc: knownNumber(p.battery_level) ?? knownNumber(p.soc),
      };
    });
  }, [telemetry, unitPrefs.power, formatTime]);

  const durationStr = useMemo(() => {
    const startedAt = detail?.started_at ?? latestSession?.startedAt ?? latestSession?.started_at;
    const endedAt = detail?.ended_at;
    if (startedAt && endedAt) {
      const seconds = (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000;
      if (Number.isFinite(seconds) && seconds >= 0) {
        const mins = seconds / 60;
        if (mins < 60) return t('widget.chargingSessionDetail.durationMinutes', '{{minutes}}m', { minutes: fmtNumber(mins, 0) });
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return m > 0
          ? t('widget.chargingSessionDetail.durationHoursMinutes', '{{hours}}h {{minutes}}m', { hours: fmtNumber(h, 0), minutes: fmtNumber(m, 0) })
          : t('widget.chargingSessionDetail.durationHours', '{{hours}}h', { hours: fmtNumber(h, 0) });
      }
    }
    if (!detail) return '—';
    const mins = knownNumber(detail.duration_min);
    if (mins == null || mins < 0) return '—';
    if (mins < 60) return t('widget.chargingSessionDetail.durationMinutes', '{{minutes}}m', { minutes: fmtNumber(mins) });
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0
      ? t('widget.chargingSessionDetail.durationHoursMinutes', '{{hours}}h {{minutes}}m', { hours: fmtNumber(h), minutes: fmtNumber(m) })
      : t('widget.chargingSessionDetail.durationHours', '{{hours}}h', { hours: fmtNumber(h) });
  }, [detail, t, fmtNumber]);

  const peakPower = useMemo(() => {
    const points = telemetry ?? [];
    const powers = points.map(p => knownNumber(p.power_w)).filter((value): value is number => value != null);
    if (powers.length > 0) {
      return convertPowerFromSI(Math.max(...powers), unitPrefs.power);
    }
    const detailPeakW = knownNumber(detail?.peak_power_w);
    return detailPeakW == null ? null : convertPowerFromSI(detailPeakW, unitPrefs.power);
  }, [telemetry, detail?.peak_power_w, unitPrefs.power]);

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

  const sessionContext = useMemo(() => {
    const start = latestSession?.startedAt ?? latestSession?.started_at;
    const dateLabel = start ? formatDateShort(start) : null;
    const location = latestSession?.start_place?.trim() || null;
    const locationWithCharger =
      location && charger.kind === 'supercharger'
        ? `${location} Supercharger`
        : location;
    const parts = [locationWithCharger, dateLabel].filter((part): part is string => Boolean(part));
    return parts.join(' · ');
  }, [latestSession, formatDateShort, charger.kind]);

  const stats = useMemo((): ChartSummaryStat[] => {
    if (!detail) return [];
    const startSoc = knownNumber(detail.start_soc_pct);
    const endSoc = knownNumber(detail.end_soc_pct);
    const socValue = startSoc != null && endSoc != null
      ? `${fmtNumber(startSoc)} → ${fmtNumber(endSoc)}`
      : null;
    return [
      {
        label: t('widget.chargingSessionDetail.energy', 'Energy added'),
        value: knownNumber(detail.total_energy_added_wh) == null ? null : fmtNumber(convertEnergyFromSI(detail.total_energy_added_wh, unitPrefs.energy), 1),
        unit: unitPrefs.energy,
      },
      {
        label: t('widget.chargingSessionDetail.peakPower', 'Peak power'),
        value: peakPower == null ? null : fmtNumber(peakPower, 1),
        unit: unitPrefs.power,
      },
      {
        label: t('widget.chargingSessionDetail.socRange', 'SoC'),
        value: socValue == null ? null : socValue.replace(/\b\d+(?:\.\d+)?\b/g, (value) => fmtNumber(Number(value), 0)),
        unit: socValue == null ? undefined : '%',
      },
    ];
  }, [detail, peakPower, t, unitPrefs.energy, unitPrefs.power, fmtNumber]);

  const tick = isWide ? axisTick : axisTickSm;
  const axisLabels = useMemo(() => {
    const powers = chartData.flatMap(point => point.power == null ? [] : [point.power]);
    // Include the next magnitude boundary that automatic nice ticks can reach.
    const bounds = powers.map(value => {
      const magnitude = 10 ** Math.floor(Math.log10(Math.abs(value) || 1));
      return Math.sign(value) * Math.ceil(Math.abs(value) / magnitude) * magnitude;
    });
    return {
      power: [0, ...powers, ...bounds].map(value => fmt(value, 1)),
      soc: [0, 25, 50, 75, 100].map(value => `${fmt(value, 0)}%`),
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
      {!detail && latestSessionId == null && chartData.length === 0 ? (
        <EmptyState
          icon={<Zap className="h-5 w-5" />}
          message={t('widget.chargingSessionDetail.empty', 'No charge sessions')}
          className="py-4"
        />
      ) : (
        <div className="flex h-full min-w-0 flex-col">
          {(sessionContext || durationStr !== '—') && (
            <div className="flex items-start justify-between gap-3">
              <span className={dashboardTokens.metricLabel}>
                {sessionContext || t('widget.chargingSessionDetail.session', 'Charging session')}
              </span>
              {durationStr !== '—' && (
                <span className={dashboardTokens.metricLabel}>{durationStr}</span>
              )}
            </div>
          )}
          <div className="mt-2 min-h-0 flex-1">{chart}</div>
          <div className="mt-2">
            <WidgetStatGrid
              stats={stats.map((stat) => ({
                label: stat.label,
                value: stat.value,
                unit: stat.unit,
              }))}
              cols={3}
              maxPerRow={3}
            />
          </div>
        </div>
      )}
    </WidgetShell>
  );
}
