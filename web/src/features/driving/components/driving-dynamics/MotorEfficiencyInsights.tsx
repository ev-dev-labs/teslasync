import { useTranslation } from 'react-i18next';
import { Zap, Gauge, Thermometer, Activity } from 'lucide-react';

import { Grid } from '@/components/layout';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { KVList } from '@/components/data-display';

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
            <Zap className="h-4 w-4 text-theme-accent" aria-hidden="true" />
            {t('dynamics.torqueDistribution', 'Torque Distribution')}
          </PanelTitle>
          {motorStats?.avgTorque != null ? (
            <div className="space-y-2 text-sm text-[var(--text-secondary)]">
              <KVList wrap items={[
                { label: t('dynamics.avgTorque', 'Avg Torque'), value: <Text as="span" mono>{fmtNumber(motorStats.avgTorque)} Nm</Text> },
                { label: t('dynamics.maxTorque', 'Max Torque'), value: <Text as="span" mono>{fmtNumber(motorStats.maxTorque)} Nm</Text> },
                { label: t('dynamics.evidence.torqueSamples', 'Torque samples above 200 Nm'), value: <Text as="span" mono>{motorStats.highTorquePct != null ? `${fmtNumber(motorStats.highTorquePct)}%` : '—'}</Text> },
              ]} />
              <Text as="p" variant="caption">{t('dynamics.evidence.torqueMeaning', 'Sum of reported axle torque. Sample share is not time spent under load or a driver rating.')}</Text>
            </div>
          ) : noData}
        </GlassPanel>

        {/* Throttle Behavior */}
        <GlassPanel className="h-full p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Gauge className="h-4 w-4 text-theme-accent" aria-hidden="true" />
            {t('dynamics.evidence.powerDemand', 'Power demand')}
          </PanelTitle>
          {motorStats?.avgPower != null ? (
            <div className="space-y-3">
              <KVList wrap items={[
                { label: t('dynamics.avgPower', 'Avg Power'), value: <Text as="span" mono>{power(motorStats.avgPower)}</Text> },
                { label: t('dynamics.peakPower', 'Peak Power'), value: <Text as="span" mono>{power(motorStats.peakPower)}</Text> },
                { label: t('dynamics.peakRegen', 'Peak Regen'), value: <Text as="span" mono>{power(motorStats.peakRegen)}</Text> },
              ]} />
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
              <KVList wrap items={[
                { label: t('dynamics.avgMotorTemp', 'Avg Motor Temp'), value: <Text as="span" mono>{fmtNumber(toTemperatureDisplay(motorStats.avgMotorTemp))}{tempUnit}</Text> },
                { label: t('dynamics.maxMotorTemp', 'Max Motor Temp'), value: <Text as="span" mono>{motorStats.maxMotorTemp != null ? `${fmtNumber(toTemperatureDisplay(motorStats.maxMotorTemp))}${tempUnit}` : '—'}</Text> },
              ]} />
              <Text as="p" variant="caption">{t('dynamics.evidence.thermalMeaning', 'Average of the hotter reported motor in each sample. Temperature alone does not establish thermal limiting or powertrain health.')}</Text>
            </div>
          ) : noData}
        </GlassPanel>
      </Grid>
    </FadeIn>
  );
}
