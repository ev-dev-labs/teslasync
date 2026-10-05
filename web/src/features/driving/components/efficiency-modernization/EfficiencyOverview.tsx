import { useTranslation } from 'react-i18next';
import { MetricBar, MetricCard } from '@/components/data-display';
import { LinearGauge } from '@/components/charts';
import { LayoutCard } from '@/components/layout/layout-reference';
import { EmptyState } from '@/components/feedback';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { EfficiencySource } from './EfficiencySource';
import { EFFICIENCY_GAUGE_MAX_WH_PER_KM, efficiencyColor, finite } from './model';
import type { StatsPresentation } from './types';

export function EfficiencyOverview({ stats, source, units, model }: StatsPresentation) {
  const { t } = useTranslation();
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { toEfficiencyDisplay, toStatsSpeedDisplay } = model;
  const efficiencyUnit = units.unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const consumptionKnown = finite(stats?.avgEfficiencyWhKm) && finite(toEfficiencyDisplay(stats.avgEfficiencyWhKm));
  const speedKnown = finite(stats?.avgSpeedKmh) && finite(toStatsSpeedDisplay(stats.avgSpeedKmh));
  const regenKnown = finite(stats?.regenRatio) && finite(stats.regenRatio * 100);
  const title = t('efficiency.overview', 'Efficiency overview');
  return <LayoutCard title={title}>
    <EfficiencySource {...source} label={title} available={Boolean(stats)}
      emptyMessage={t('efficiency.noSummary', 'No efficiency summary available yet')}>
      <div className="space-y-5">
        <div className="flex justify-center">
          {consumptionKnown && finite(stats?.avgEfficiencyWhKm) ? <LinearGauge
            value={toEfficiencyDisplay(stats.avgEfficiencyWhKm)}
            max={Math.round(toEfficiencyDisplay(EFFICIENCY_GAUGE_MAX_WH_PER_KM))}
            size={148} label={t('efficiency.avg', 'Avg')} unit={` ${efficiencyUnit}`}
            color={efficiencyColor(stats.avgEfficiencyWhKm)} className="max-w-xs" />
            : <EmptyState message={t('efficiency.noSummary', 'No efficiency summary available yet')} />}
        </div>
        <div className="space-y-4">
          {consumptionKnown && finite(stats?.avgEfficiencyWhKm)
            ? <MetricBar label={t('efficiency.avgConsumption', 'Avg consumption')}
                value={toEfficiencyDisplay(stats.avgEfficiencyWhKm)}
                max={toEfficiencyDisplay(EFFICIENCY_GAUGE_MAX_WH_PER_KM)} color="#00f0ff"
                sublabel={`${fmtNumber(toEfficiencyDisplay(stats.avgEfficiencyWhKm))} ${efficiencyUnit}`} />
            : <MetricCard label={t('efficiency.avgConsumption', 'Avg consumption')} value="—" />}
          {speedKnown && finite(stats?.avgSpeedKmh)
            ? <MetricBar label={t('efficiency.avgSpeed', 'Avg speed')}
                value={toStatsSpeedDisplay(stats.avgSpeedKmh)} max={150} color="#10b981"
                sublabel={`${fmtInt(toStatsSpeedDisplay(stats.avgSpeedKmh))} ${units.unitPrefs.speed}`} />
            : <MetricCard label={t('efficiency.avgSpeed', 'Avg speed')} value="—" />}
          {regenKnown && finite(stats?.regenRatio)
            ? <MetricBar label={t('efficiency.regenRatio', 'Regen ratio')}
                value={stats.regenRatio * 100} max={100} color="#a855f7"
                sublabel={`${fmtNumber(stats.regenRatio * 100)}%`} />
            : <MetricCard label={t('efficiency.regenRatio', 'Regen ratio')} value="—" />}
          {finite(stats?.totalDurationS)
            ? <MetricBar label={t('efficiency.totalDriveTime', 'Total drive time')}
                value={stats.totalDurationS} max={Math.max(stats.totalDurationS, 36000)} color="#f59e0b"
                sublabel={units.formatDuration(stats.totalDurationS)} />
            : <MetricCard label={t('efficiency.totalDriveTime', 'Total drive time')} value="—" />}
        </div>
      </div>
    </EfficiencySource>
  </LayoutCard>;
}
