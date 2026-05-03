import { useTranslation } from 'react-i18next';
import { Zap, Gauge, Thermometer, Activity } from 'lucide-react';

import { Grid } from '@/components/layout';
import { GlassPanel, Badge } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { fmtNumber } from '@/lib/numberFormat';
import type { MotorStats, ThrottleStyle } from './helpers';

interface MotorEfficiencyInsightsProps {
  motorStats: MotorStats | null;
  throttleStyle: ThrottleStyle | null;
  convertTemp: (v: number) => number;
  tempUnit: string;
}

export default function MotorEfficiencyInsights({
  motorStats,
  throttleStyle,
  convertTemp,
  tempUnit,
}: MotorEfficiencyInsightsProps) {
  const { t } = useTranslation();

  const noData = (
    <EmptyState icon={<Activity className="h-5 w-5" />} message={t('dynamics.noMotorData', 'No motor data recorded yet')} />
  );

  return (
    <FadeIn delay={0.35}>
      <Grid cols={{ default: 1, md: 3 }} gap={4}>
        {/* Torque Distribution */}
        <GlassPanel className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Zap className="h-4 w-4 text-blue-400" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              {t('dynamics.torqueDistribution', 'Torque Distribution')}
            </h3>
          </div>
          {motorStats ? (
            <div className="space-y-2 text-sm text-[var(--text-secondary)]">
              <div className="flex justify-between"><span>{t('dynamics.avgTorque', 'Avg Torque')}</span><span className="font-mono">{fmtNumber(motorStats.avgTorque, 1)} Nm</span></div>
              <div className="flex justify-between"><span>{t('dynamics.maxTorque', 'Max Torque')}</span><span className="font-mono">{fmtNumber(motorStats.maxTorque, 1)} Nm</span></div>
              <div className="flex justify-between"><span>{t('dynamics.highTorqueTime', 'High Torque Time')}</span><span className="font-mono">{fmtNumber(motorStats.highTorquePct, 1)}%</span></div>
            </div>
          ) : noData}
        </GlassPanel>

        {/* Throttle Behavior */}
        <GlassPanel className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Gauge className="h-4 w-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              {t('dynamics.throttleBehavior', 'Throttle Behavior')}
            </h3>
          </div>
          {motorStats ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm text-[var(--text-secondary)]">
                <span>{t('dynamics.avgPower', 'Avg Power')}</span>
                <span className="font-mono">{fmtNumber(motorStats.avgPower, 1)} kW</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--text-secondary)]">{t('dynamics.drivingStyle', 'Style')}</span>
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
                sublabel=""
              />
            </div>
          ) : noData}
        </GlassPanel>

        {/* Motor Thermal */}
        <GlassPanel className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Thermometer className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              {t('dynamics.motorThermal', 'Motor Thermal')}
            </h3>
          </div>
          {motorStats ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm text-[var(--text-secondary)]">
                <span>{t('dynamics.avgMotorTemp', 'Avg Motor Temp')}</span>
                <span className="font-mono">{fmtNumber(convertTemp(motorStats.avgMotorTemp), 1)}°{tempUnit}</span>
              </div>
              <div className="flex items-center justify-between text-sm text-[var(--text-secondary)]">
                <span>{t('dynamics.maxMotorTemp', 'Max Motor Temp')}</span>
                <span className="font-mono">{fmtNumber(convertTemp(motorStats.maxMotorTemp), 1)}°{tempUnit}</span>
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
