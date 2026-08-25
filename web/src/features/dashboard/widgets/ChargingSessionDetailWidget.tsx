import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  chartGrid, axisTick, axisTickSm, chartAnimation, fmt, areaGradient,
  ChartLegend, EmbeddedChart,
  type ChartDataRow,
} from '@/components/charts';
import { ChartTooltip } from '@/components/charts';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useChargingSessions, useChargingSessionDetail, useChargeTelemetry } from '@/api/hooks/useCharging';
import { useVehicles } from '@/api/hooks/useVehicles';
import { fmtNumber } from '@/lib/numberFormat';
import { convertEnergyFromSI } from '@/lib/unitConversion';
import { WidgetShell } from './WidgetShell';
import { WidgetChartSummary, type ChartSummaryStat } from './shared';
import type { WidgetProps } from './types';

interface ChartDatum extends ChartDataRow {
  time: string;
  power: number | null;
  soc: number | null;
}

type ChargerKind = 'supercharger' | 'dcFast' | 'acHome';

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
  if (!chargerType) return { kind: 'acHome', variant: 'neutral' };
  const ct = chargerType.toLowerCase();
  if (ct.includes('supercharger') || ct.includes('tesla')) return { kind: 'supercharger', variant: 'warning' };
  if (ct !== '<invalid>' && ct !== '') return { kind: 'dcFast', variant: 'warning' };
  return { kind: 'acHome', variant: 'neutral' };
}

export default function ChargingSessionDetailWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const { data: sessions } = useChargingSessions(vid > 0 ? String(vid) : undefined);

  const latestSessionId = useMemo(() => {
    const list = sessions ?? [];
    if (list.length === 0) return null;
    const latest = list.reduce((a, b) =>
      new Date(a.startedAt) > new Date(b.startedAt) ? a : b,
    );
    const id = Number(latest.id);
    return Number.isFinite(id) ? id : null;
  }, [sessions]);

  const {
    data: detail,
    isLoading: detailLoading,
    error: detailError,
    isFetching, isStale, isError, dataUpdatedAt, refetch,
  } = useChargingSessionDetail(latestSessionId);

  const {
    data: telemetry,
    isLoading: telemetryLoading,
  } = useChargeTelemetry(latestSessionId);

  const isLoading = detailLoading || telemetryLoading;
  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  // Only replace the whole widget with a full-panel error on the INITIAL load
  // failure, when there is no cached detail to fall back on. The session detail
  // query polls while a charge is live, so a transient background-refetch
  // failure must not blank out otherwise-valid numbers — it is surfaced through
  // the freshness indicator's error state instead (WidgetShell forwards
  // `isError` to <DataFreshness>).
  const blockingError = !detail && detailError ? String(detailError) : null;

  const chartData = useMemo((): ChartDatum[] => {
    const points = telemetry ?? [];
    return points.map((p) => {
      const ts = new Date(p.created_at);
      return {
        time: `${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`,
        power: p.power_kw ?? null,
        soc: p.battery_level ?? p.soc ?? null,
      };
    });
  }, [telemetry]);

  const durationStr = useMemo(() => {
    if (!detail) return '—';
    const mins = detail.duration_min ?? 0;
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }, [detail]);

  const peakPower = useMemo(() => {
    const points = telemetry ?? [];
    return points.reduce((max, p) => Math.max(max, p.power_kw ?? 0), 0);
  }, [telemetry]);

  const charger = useMemo(
    () => classifyCharger(detail?.charger_type ?? null),
    [detail],
  );

  const chargerLabel = useMemo(() => {
    switch (charger.kind) {
      case 'supercharger':
        return t('widget.chargingSessionDetail.chargerSupercharger', 'Supercharger');
      case 'dcFast':
        return t('widget.chargingSessionDetail.chargerDcFast', 'DC Fast');
      default:
        return t('widget.chargingSessionDetail.chargerAcHome', 'AC / Home');
    }
  }, [charger, t]);

  const stats = useMemo((): ChartSummaryStat[] => {
    if (!detail) return [];
    return [
      {
        label: t('widget.chargingSessionDetail.energy', 'Energy Added'),
        value: fmtNumber(convertEnergyFromSI(detail.total_energy_added_wh ?? 0, 'kWh'), 1),
        unit: 'kWh',
      },
      {
        label: t('widget.chargingSessionDetail.duration', 'Duration'),
        value: durationStr,
      },
      {
        label: t('widget.chargingSessionDetail.peakPower', 'Peak Power'),
        value: fmtNumber(peakPower, 1),
        unit: 'kW',
      },
      {
        label: t('widget.chargingSessionDetail.charger', 'Charger'),
        value: chargerLabel,
      },
    ];
  }, [detail, durationStr, peakPower, chargerLabel, t]);

  const tick = isWide ? axisTick : axisTickSm;

  const chart = useMemo(() => {
    return (
      <EmbeddedChart
        title={t('widget.chargingSessionDetail.title', 'Charge Session Detail')}
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
          { key: 'power', label: t('widget.chargingSessionDetail.powerKw', 'Power (kW)') },
          { key: 'soc', label: t('widget.chargingSessionDetail.soc', 'SoC %') },
        ]}
        chartKey="dashboard-charging-session-detail"
      >
        {({ hiddenSeries }) => (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
          data={chartData}
          margin={{ top: 4, right: 4, bottom: 0, left: -10 }}
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
            width={36}
            domain={[0, 'dataMax + 5']}
            tickFormatter={(v: number) => fmt(v, 0)}
          />

          <YAxis
            yAxisId="soc"
            orientation="right"
            tick={tick}
            tickLine={false}
            axisLine={false}
            width={36}
            domain={[0, 100]}
            tickFormatter={(v: number) => `${fmt(v, 0)}%`}
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
            name={t('widget.chargingSessionDetail.powerKw', 'Power (kW)')}
            connectNulls
            hide={hiddenSeries?.isHidden('power')}
          />

          <Line
            yAxisId="soc"
            dataKey="soc"
            stroke="#22d3ee"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
            name={t('widget.chargingSessionDetail.soc', 'SoC %')}
            connectNulls
            hide={hiddenSeries?.isHidden('soc')}
          />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </EmbeddedChart>
    );
  }, [chartData, tick, t]);

  // ── Compact layout: large kWh number + charger badge ──
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        error={blockingError}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}
      >
        {detail ? (
          <div className="h-full flex flex-col items-center justify-center gap-1 min-h-[44px]">
            <span className="text-2xl font-bold text-emerald-300">
              {fmtNumber(convertEnergyFromSI(detail.total_energy_added_wh ?? 0, 'kWh'), 1)}
            </span>
            <span className="text-2xs text-[var(--text-muted)] uppercase tracking-wider">
              {t('widget.chargingSessionDetail.unitKwh', 'kWh added')}
            </span>
            <Badge variant={charger.variant} size="sm">
              {chargerLabel}
            </Badge>
          </div>
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
      title={t('widget.chargingSessionDetail.title', 'Charge Session Detail')}
      icon={<Zap className="h-3.5 w-3.5 text-emerald-400" />}
      loading={isLoading}
      error={blockingError}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      <WidgetChartSummary
        stats={stats}
        chart={chart}
        isEmpty={!detail}
        emptyMessage={t('widget.chargingSessionDetail.empty', 'No charge sessions')}
        emptyIcon={<Zap className="h-5 w-5" />}
      />
    </WidgetShell>
  );
}
