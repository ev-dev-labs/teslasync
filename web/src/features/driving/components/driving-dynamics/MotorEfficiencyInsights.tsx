import { useTranslation } from 'react-i18next';
import { Zap, Gauge, Thermometer, Activity } from 'lucide-react';

import { Grid } from '@/components/layout';
import { GlassPanel, Badge, PanelTitle, Text } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { fmtNumber } from '@/lib/numberFormat';
import { getThrottleStyle } from './helpers';
import { useMotorStats } from './useMotorStats';
import type { TemperatureUnitPref } from '@/lib/unitConversion';

interface MotorEfficiencyInsightsProps {
  vehicleId: number | null | undefined;
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
  toTemperatureDisplay,
  tempUnit,
}: MotorEfficiencyInsightsProps) {
  const { t } = useTranslation();
  const { motorStats } = useMotorStats(vehicleId);
  const throttleStyle = motorStats ? getThrottleStyle(motorStats.avgPower) : null;

  const noData = (
    <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ icon={<Activity className="h-5 w-5" />} message={t('dynamics.noMotorData', 'No motor data recorded yet')} />
  );

  return (
    <FadeIn delay={0.35}>
      <Grid cols={{ default: 1, md: 3 }} gap={4}>
        {/* Torque Distribution */}
        <GlassPanel className="h-full p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Zap className="h-4 w-4 text-indigo-300" aria-hidden="true" />
            {t('dynamics.torqueDistribution', 'Torque Distribution')}
          </PanelTitle>
          {motorStats ? (
            <div className="space-y-2 text-sm text-[var(--text-secondary)]">
              <div className="flex justify-between"><span>{t('dynamics.avgTorque', 'Avg Torque')}</span><Text as="span" mono>{fmtNumber(motorStats.avgTorque, 1)} Nm</Text></div>
              <div className="flex justify-between"><span>{t('dynamics.maxTorque', 'Max Torque')}</span><Text as="span" mono>{fmtNumber(motorStats.maxTorque, 1)} Nm</Text></div>
              <div className="flex justify-between"><span>{t('dynamics.highTorqueTime', 'High Torque Time')}</span><Text as="span" mono>{fmtNumber(motorStats.highTorquePct, 1)}%</Text></div>
            </div>
          ) : noData}
        </GlassPanel>

        {/* Throttle Behavior */}
        <GlassPanel className="h-full p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('dynamics.throttleBehavior', 'Throttle Behavior')}
          </PanelTitle>
          {motorStats ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm text-[var(--text-secondary)]">
                <span>{t('dynamics.avgPower', 'Avg Power')}</span>
                <Text as="span" mono>{fmtNumber(motorStats.avgPower, 1)} kW</Text>
              </div>
              <div className="flex items-center justify-between">
                <Text as="span" size="sm" color="secondary">{t('dynamics.drivingStyle', 'Style')}</Text>
                <Badge
                  variant={throttleStyle === 'conservative' ? 'success' : throttleStyle === 'moderate' ? 'warning' : 'danger'}
                  size="sm"
                >
                  {throttleStyle === 'conservative'
                    ? t('dynamics.conservative', 'Conservative')
                    : throttleStyle === 'moderate'
                      ? t('dynamics.moderate', 'Moderate')
                      : t('dynamics.aggressive', 'Aggressive')}
                </Badge>
              </div>
              <MetricBar
                value={motorStats.avgPower}
                max={200}
                color={throttleStyle === 'conservative' ? '#22c55e' : throttleStyle === 'moderate' ? '#eab308' : '#ef4444'}
                label=""
                // Empty string explicitly suppresses the textual readout
                // beside the bar (the same number is already rendered as
                // "Avg Power" above). MetricBar uses `??` so this is
                // honoured — passing `||` previously fell through to
                // `fmtNumber(value)` and rendered a stray "0.00".
                sublabel=""
              />
            </div>
          ) : noData}
        </GlassPanel>

        {/* Motor Thermal */}
        <GlassPanel className="h-full p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Thermometer className="h-4 w-4 text-amber-300" aria-hidden="true" />
            {t('dynamics.motorThermal', 'Motor Thermal')}
          </PanelTitle>
          {motorStats ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm text-[var(--text-secondary)]">
                <span>{t('dynamics.avgMotorTemp', 'Avg Motor Temp')}</span>
                <Text as="span" mono>{fmtNumber(toTemperatureDisplay(motorStats.avgMotorTemp), 1)}{tempUnit}</Text>
              </div>
              <div className="flex items-center justify-between text-sm text-[var(--text-secondary)]">
                <span>{t('dynamics.maxMotorTemp', 'Max Motor Temp')}</span>
                <Text as="span" mono>{fmtNumber(toTemperatureDisplay(motorStats.maxMotorTemp), 1)}{tempUnit}</Text>
              </div>
              <Badge
                variant={motorStats.maxMotorTemp < 100 ? 'success' : motorStats.maxMotorTemp < 140 ? 'warning' : 'danger'}
                size="sm"
              >
                {motorStats.maxMotorTemp < 100
                  ? t('dynamics.thermalGood', 'Thermal: Good')
                  : motorStats.maxMotorTemp < 140
                    ? t('dynamics.thermalWarm', 'Thermal: Warm')
                    : t('dynamics.thermalHot', 'Thermal: Hot')}
              </Badge>
            </div>
          ) : noData}
        </GlassPanel>
      </Grid>
    </FadeIn>
  );
}
