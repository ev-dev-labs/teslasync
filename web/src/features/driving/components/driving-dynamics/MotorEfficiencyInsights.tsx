import { useTranslation } from 'react-i18next';
import { Zap, Gauge, Thermometer, Activity } from 'lucide-react';

import { Grid } from '@/components/layout';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { useMotorStats } from './useMotorStats';
import type { MotorHistoryQuery } from '@/api/hooks/useVehicles';
import type { TemperatureUnitPref } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useUnits } from '@/hooks/useUnits';

interface MotorEfficiencyInsightsProps {
  vehicleId: number | null | undefined;
  historyQuery?: MotorHistoryQuery;
  toTemperatureDisplay: (v: number) => number;
  // tempUnit is the user's display preference (e.g. '°C' or '°F'). The
  // value already INCLUDES the degree symbol — never prefix another '°'
  // (that produces "49.0°°C", which was a real bug). Type is narrowed
  // from `string` to TemperatureUnitPref so callers can't pass a bare
  // "C"/"F" and reintroduce the bug.
  tempUnit: TemperatureUnitPref;
}

export default function MotorEfficiencyInsights({
  vehicleId,
  historyQuery,
  toTemperatureDisplay,
  tempUnit,
}: MotorEfficiencyInsightsProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const query = useMotorStats(vehicleId, historyQuery);
  const { motorStats } = query;
  const { formatPower } = useUnits();
  const power = (value: number | null | undefined) => formatPower(value != null ? value * 1000 : null);

  const noData = query.isLoading ? <Skeleton className="h-20" /> : query.isError ? (
    <QueryError error={query.error} onRetry={query.refetch} />
  ) : (
    <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ icon={<Activity className="h-5 w-5" />} message={t('dynamics.noMotorData', 'No motor data recorded yet')} />
  );

  return (
    <FadeIn delay={0.1}>
      <Grid cols={{ default: 1, xl: 3 }} gap={4}>
        {/* Torque Distribution */}
        <GlassPanel className="h-full p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Zap className="h-4 w-4 text-indigo-300" aria-hidden="true" />
            {t('dynamics.torqueDistribution', 'Torque Distribution')}
          </PanelTitle>
          {motorStats?.avgTorque != null ? (
            <div className="space-y-2 text-sm text-[var(--text-secondary)]">
              <div className="flex justify-between"><span>{t('dynamics.avgTorque', 'Avg Torque')}</span><Text as="span" mono>{fmtNumber(motorStats.avgTorque)} Nm</Text></div>
              <div className="flex justify-between"><span>{t('dynamics.maxTorque', 'Max Torque')}</span><Text as="span" mono>{fmtNumber(motorStats.maxTorque)} Nm</Text></div>
              <div className="flex justify-between gap-3"><span>{t('dynamics.evidence.torqueSamples', 'Torque samples above 200 Nm')}</span><Text as="span" mono>{motorStats.highTorquePct != null ? `${fmtNumber(motorStats.highTorquePct)}%` : '—'}</Text></div>
              <Text as="p" variant="caption">{t('dynamics.evidence.torqueMeaning', 'Sum of reported axle torque. Sample share is not time spent under load or a driver rating.')}</Text>
            </div>
          ) : noData}
        </GlassPanel>

        {/* Throttle Behavior */}
        <GlassPanel className="h-full p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('dynamics.evidence.powerDemand', 'Power demand')}
          </PanelTitle>
          {motorStats?.avgPower != null ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm text-[var(--text-secondary)]">
                <span>{t('dynamics.avgPower', 'Avg Power')}</span>
                <Text as="span" mono>{power(motorStats.avgPower)}</Text>
              </div>
              <div className="flex items-center justify-between">
                <Text as="span" size="sm" color="secondary">{t('dynamics.peakPower', 'Peak Power')}</Text>
                <Text as="span" mono>{power(motorStats.peakPower)}</Text>
              </div>
              <div className="flex items-center justify-between gap-3">
                <Text as="span" size="sm" color="secondary">{t('dynamics.peakRegen', 'Peak Regen')}</Text>
                <Text as="span" mono>{power(motorStats.peakRegen)}</Text>
              </div>
              <Text as="p" variant="caption">{t('dynamics.evidence.powerMeaning', 'Measured motor output, not pedal position. Power alone cannot classify driving style.')}</Text>
            </div>
          ) : noData}
        </GlassPanel>

        {/* Motor Thermal */}
        <GlassPanel className="h-full p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Thermometer className="h-4 w-4 text-amber-300" aria-hidden="true" />
            {t('dynamics.motorThermal', 'Motor Thermal')}
          </PanelTitle>
          {motorStats?.avgMotorTemp != null ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm text-[var(--text-secondary)]">
                <span>{t('dynamics.avgMotorTemp', 'Avg Motor Temp')}</span>
                <Text as="span" mono>{fmtNumber(toTemperatureDisplay(motorStats.avgMotorTemp))}{tempUnit}</Text>
              </div>
              <div className="flex items-center justify-between text-sm text-[var(--text-secondary)]">
                <span>{t('dynamics.maxMotorTemp', 'Max Motor Temp')}</span>
                <Text as="span" mono>{motorStats.maxMotorTemp != null ? `${fmtNumber(toTemperatureDisplay(motorStats.maxMotorTemp))}${tempUnit}` : '—'}</Text>
              </div>
              <Text as="p" variant="caption">{t('dynamics.evidence.thermalMeaning', 'Average of the hotter reported motor in each sample. Temperature alone does not establish thermal limiting or powertrain health.')}</Text>
            </div>
          ) : noData}
        </GlassPanel>
      </Grid>
    </FadeIn>
  );
}
