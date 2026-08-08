import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flame, Gauge, Timer, Zap } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Badge, HelpTooltip, Select } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ChartContainer, ChartTooltip, ChartLegend,
  ComposedChart, Area, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';

import { useChargingHistory, useChargeTelemetry } from '@/api/hooks/useCharging';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { chartTokens } from '@/lib/tokens';
import { fmtPercent } from '@/lib/numberFormat';
import { formatDateShort, formatDurationSecondsAsMinutes } from '@/lib/dateFormat';

import { analyzeChargingThermalTax, type ThermalEnergySource } from '../lib/chargingThermalTax';

const SOURCE_DEFAULTS: Record<ThermalEnergySource, string> = {
  cumulative: 'Metered running total',
  power_integral: 'Estimated from instantaneous power',
  none: 'Unavailable',
};

const CHART_KEY = 'charging-thermal-tax-power';

export default function ChargingThermalTaxPage() {
  const { t, i18n } = useTranslation();
  usePageTitle(t('chargingThermalTax.title', 'Charging Thermal Tax'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { formatEnergy, formatPower } = useUnits();
  const hiddenSeries = useHiddenSeries(CHART_KEY);
  const [selectedSessionId, setSelectedSessionId] = useState('');

  const sessionsQuery = useChargingHistory(vehicleIdStr);
  const sessions = sessionsQuery.data ?? [];
  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? null;
  const rawNumericId = selectedSession != null ? Number(selectedSession.id) : NaN;
  const numericSessionId = Number.isFinite(rawNumericId) ? rawNumericId : null;

  const telemetryQuery = useChargeTelemetry(numericSessionId);
  const summary = useMemo(() => analyzeChargingThermalTax(telemetryQuery.data ?? []), [telemetryQuery.data]);

  const sessionOptions = useMemo(
    () =>
      sessions.map((s) => ({
        value: s.id,
        label: `${formatDateShort(s.started_at)} \u00b7 ${s.charger_type ?? t('chargingThermalTax.unknownCharger', 'Unknown charger')}`,
      })),
    [sessions, t],
  );
  const chartData = useMemo(() => {
    const points = (telemetryQuery.data ?? [])
      .map((r) => ({
        tMs: new Date(r.ts).getTime(),
        heaterW: Math.max(0, r.battery_heater_power_w ?? 0),
        chargeW: Math.max(0, (r.ac_charging_power_w ?? 0) + (r.dc_charging_power_w ?? 0)),
      }))
      .filter((r) => Number.isFinite(r.tMs))
      .sort((a, b) => a.tMs - b.tMs);
    return points.map((r) => ({
      time: new Date(r.tMs).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }),
      heaterW: r.heaterW,
      chargeW: r.chargeW,
    }));
  }, [telemetryQuery.data, i18n.language]);

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('chargingThermalTax.title', 'Charging Thermal Tax')} />;
  }

  const isLoading = sessionsQuery.isLoading;
  const isError = sessionsQuery.isError;
  const isTelemetryLoading = numericSessionId != null && telemetryQuery.isLoading;
  const isTelemetryError = numericSessionId != null && telemetryQuery.isError;

  return (
    <PageContainer
      title={t('chargingThermalTax.title', 'Charging Thermal Tax')}
      subtitle={t(
        'chargingThermalTax.subtitle',
        'How much of a charge went into warming the battery instead of into range',
      )}
      query={numericSessionId != null ? [sessionsQuery, telemetryQuery] : sessionsQuery}
      actions={<VehicleSelect />}
    >
      {/* 0 — Session picker */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-5">
          {isError ? (
            <QueryError error={sessionsQuery.error} onRetry={() => sessionsQuery.refetch()} />
          ) : (
            <div className="w-full sm:max-w-sm">
              <Select
                label={t('chargingThermalTax.selectSession', 'Inspect session')}
                value={selectedSessionId}
                onChange={(e) => setSelectedSessionId(e.target.value)}
                options={sessionOptions}
                placeholder={t('chargingThermalTax.selectPlaceholder', 'Select a session to analyze')}
                disabled={isLoading || sessions.length === 0}
              />
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      {/* 1 — KPI band */}
      <FadeIn delay={0.05}>
        <section
          aria-label={t('chargingThermalTax.kpis', 'Charging thermal tax metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isTelemetryError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={telemetryQuery.error} onRetry={() => telemetryQuery.refetch()} />
            </GlassPanel>
          ) : isTelemetryLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={96} className="rounded-xl" />)
          ) : (
            <>
              <MetricCard
                label={t('chargingThermalTax.heaterEnergy', 'Heater Energy')}
                value={numericSessionId != null ? formatEnergy(summary.heaterWh, { precision: 0 }) : '\u2014'}
                subtitle={t('chargingThermalTax.heaterEnergyHint', 'trapezoidal integral over the session')}
                icon={<Flame className="h-4 w-4" />}
                color="amber"
              />
              <MetricCard
                label={t('chargingThermalTax.heaterShare', 'Heater Share')}
                value={summary.heaterSharePct != null ? fmtPercent(summary.heaterSharePct, 1) : '\u2014'}
                subtitle={t('chargingThermalTax.heaterShareHint', 'of energy the charger delivered')}
                icon={<Gauge className="h-4 w-4" />}
                color={summary.heaterSharePct != null && summary.heaterSharePct >= 15 ? 'amber' : 'cyan'}
                help={{
                  i18nKey: 'help.chargingThermalTax.heaterShare',
                  defaultValue:
                    'Heater energy divided by delivered input energy. Not the charging-curve power-vs-SoC view \u2014 this only measures heater overhead, independent of how fast the pack itself charged.',
                }}
              />
              <MetricCard
                label={t('chargingThermalTax.heaterOnTime', 'Heater On Time')}
                value={numericSessionId != null ? formatDurationSecondsAsMinutes(summary.heaterOnS) : '\u2014'}
                subtitle={
                  numericSessionId != null
                    ? t('chargingThermalTax.heaterOnPct', '{{pct}}% of the session', { pct: summary.heaterOnPct })
                    : t('chargingThermalTax.noSession', 'no session selected')
                }
                icon={<Timer className="h-4 w-4" />}
                color="purple"
              />
              <MetricCard
                label={t('chargingThermalTax.peakHeater', 'Peak Heater Power')}
                value={numericSessionId != null ? formatPower(summary.peakHeaterW, { precision: 0 }) : '\u2014'}
                subtitle={t('chargingThermalTax.peakHeaterHint', 'highest single reading')}
                icon={<Zap className="h-4 w-4" />}
                color="blue"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Heater vs. charge power over the session */}
      <FadeIn delay={0.1}>
        {numericSessionId == null ? (
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState /* no-action: pick a session above once one exists. */
              icon={<Flame className="h-8 w-8" />}
              message={t('chargingThermalTax.noSelection', 'Select a charging session above to see its thermal breakdown.')}
            />
          </GlassPanel>
        ) : !isTelemetryLoading && !isTelemetryError && chartData.length === 0 ? (
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState /* no-action: appears once telemetry samples exist for this session. */
              icon={<Flame className="h-8 w-8" />}
              message={t('chargingThermalTax.noTelemetry', 'No telemetry samples were recorded for this session.')}
            />
          </GlassPanel>
        ) : (
          <ChartContainer
            title={t('chargingThermalTax.chart', 'Heater vs. Charge Power')}
            subtitle={t('chargingThermalTax.chartHint', 'The shaded area is heater draw; the line is total charger power')}
            ariaLabel={t(
              'chargingThermalTax.chartAria',
              'Chart of battery heater power and total charging power over the session timeline',
            )}
            chartKey={CHART_KEY}
            loading={isTelemetryLoading}
            empty={chartData.length === 0}
            height={320}
            data={chartData}
            dataColumns={[
              { key: 'time', label: t('chargingThermalTax.col.time', 'Time') },
              { key: 'heaterW', label: t('chargingThermalTax.col.heater', 'Heater (W)') },
              { key: 'chargeW', label: t('chargingThermalTax.col.charge', 'Charge power (W)') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 16, right: 16, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend state={hiddenSeries} />
                <Area
                  type="monotone"
                  dataKey="heaterW"
                  name={t('chargingThermalTax.col.heater', 'Heater (W)')}
                  fill={chartTokens.series[3]}
                  stroke={chartTokens.series[3]}
                  fillOpacity={0.35}
                  hide={hiddenSeries.isHidden('heaterW')}
                />
                <Line
                  type="monotone"
                  dataKey="chargeW"
                  name={t('chargingThermalTax.col.charge', 'Charge power (W)')}
                  stroke={chartTokens.series[0]}
                  strokeWidth={2}
                  dot={false}
                  hide={hiddenSeries.isHidden('chargeW')}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </FadeIn>

      {/* 3 — Data quality and thermal phases */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Flame className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('chargingThermalTax.detail', 'Thermal Phases')}
            <HelpTooltip
              size="sm"
              i18nKey="help.chargingThermalTax.detail"
              defaultValue="Delivered energy is preferably read from the charger's own cumulative counters; if those are missing or reset mid-session, it falls back to integrating instantaneous power instead \u2014 the source used is always disclosed below."
              ariaLabel={t('help.chargingThermalTax.iconLabel', 'More info about data sources')}
            />
          </PanelTitle>
          {numericSessionId == null ? (
            <EmptyState /* no-action: pick a session above once one exists. */
              icon={<Flame className="h-8 w-8" />}
              message={t('chargingThermalTax.noSelectionShort', 'No session selected.')}
            />
          ) : isTelemetryLoading ? (
            <Skeleton height={160} />
          ) : summary.phases.length === 0 ? (
            <EmptyState /* no-action: appears once telemetry samples exist for this session. */
              icon={<Flame className="h-8 w-8" />}
              message={t('chargingThermalTax.noPhases', 'No usable telemetry to segment into phases.')}
            />
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge variant="neutral" size="sm">
                  {t('chargingThermalTax.coverage', 'Coverage {{pct}}%', { pct: summary.dataCoveragePct })}
                </Badge>
                <Badge variant={summary.energySource === 'none' ? 'warning' : 'info'} size="sm">
                  {t(`chargingThermalTax.source.${summary.energySource}`, SOURCE_DEFAULTS[summary.energySource])}
                </Badge>
              </div>
              <ul className="grid max-h-64 gap-1.5 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
                {summary.phases.map((p, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-2"
                  >
                    <Badge variant={p.state === 'heater_on' ? 'warning' : 'neutral'} size="sm">
                      {p.state === 'heater_on'
                        ? t('chargingThermalTax.phaseOn', 'Heater on')
                        : t('chargingThermalTax.phaseOff', 'Heater off')}
                    </Badge>
                    <Text variant="caption">
                      {formatDurationSecondsAsMinutes(p.durationS)}
                      {p.state === 'heater_on' ? ` \u00b7 ${formatPower(p.avgHeaterW, { precision: 0 })}` : ''}
                    </Text>
                  </li>
                ))}
              </ul>
            </>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
