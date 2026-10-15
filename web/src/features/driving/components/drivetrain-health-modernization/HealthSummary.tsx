import { useTranslation } from 'react-i18next';
import { Badge, Text } from '@/components/ui';
import { CardGrid, LayoutCard } from '@/components/layout/layout-reference';
import { StatGroup, StatStrip, type StatMetric } from '@/components/data-display/stat-reference';
import { KVList } from '@/components/data-display';
import { LinearGauge } from '@/components/charts';
import { AlertBanner } from '@/components/feedback';
import type { DataState } from '@/api/dataState';
import type { DrivetrainHealthData, DrivingStats } from '@/types/driving';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { SourceBoundary } from './SourceBoundary';
import { finite, healthScore, healthStatus, statsSI, temperatureBand, type Sensor, type PowerSummary } from './model';

interface Props {
  health?: DrivetrainHealthData;
  stats?: DrivingStats;
  sensors: readonly Sensor[];
  power: PowerSummary;
  healthState: DataState<unknown>;
  statsState: DataState<unknown>;
  drivesState: DataState<unknown>;
  healthLoading: boolean;
  statsLoading: boolean;
}

export function HealthSummary(props: Props) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { health, stats, sensors, power, healthState, statsState, drivesState, healthLoading, statsLoading } = props;
  const score = healthScore(health);
  const status = healthStatus(health);
  const activeSensors = sensors.filter(sensor => sensor.value != null).length;
  const preferences = { units: unitPrefs, currency: { kind: 'symbol' as const, value: '$' } };
  const snapshot = {
    kind: 'snapshot' as const,
    label: t('drivetrain.modernization.snapshot', 'Latest health response'),
    observedAt: healthState.updatedAt ? new Date(healthState.updatedAt).toISOString() : null,
    provenance: t('drivetrain.modernization.healthMethodology', 'Health temperatures are backend battery-module proxies, not direct motor measurements.'),
  };
  const period = {
    kind: 'unknown' as const,
    label: t('drivetrain.modernization.driveSubset', 'Recent drives within the selected range'),
    reason: t('drivetrain.modernization.powerMethodology', 'Peak-labelled power uses average drive power from up to 30 returned drives. Per-drive regen power is not supplied; gaps are unknown, not zero.'),
  };
  const metrics: StatMetric[] = sensors.map(sensor => ({
    metricId: 'temperature', occurrenceId: sensor.key, label: t(sensor.labelKey, sensor.label),
    rawValue: sensor.value,
    context: sensor.value != null
      ? `${fmtNumber(sensor.value / sensor.maxTemp * 100)}% ${t('drivetrain.ofMax', 'of max')} · ${t(`drivetrain.modernization.band.${temperatureBand(sensor.value, sensor.maxTemp)}`, temperatureBand(sensor.value, sensor.maxTemp))}`
      : t('drivetrain.noData', 'No data'),
  }));
  const normalized = statsSI(stats);
  const noHealth = t('drivetrain.noHealth', 'No drivetrain health data available yet');
  const statusLabel = status ? t(`drivetrain.health.${status}`, status.charAt(0).toUpperCase() + status.slice(1)) : '—';
  return <>
    <LayoutCard title={t('drivetrain.title', 'Drivetrain Health')}>
      <SourceBoundary state={healthState} label={t('drivetrain.title', 'Drivetrain Health')}
        loading={healthLoading} empty={!health} emptyMessage={noHealth}>
        {score != null && status && status !== 'good' && <AlertBanner
          variant={status === 'critical' ? 'danger' : 'warning'}
          title={status === 'critical'
            ? t('drivetrain.alert.criticalTitle', 'Critical temperature warning')
            : t('drivetrain.alert.warningTitle', 'Elevated temperatures detected')}>
          {status === 'critical'
            ? t('drivetrain.alert.criticalMsg', 'One or more drivetrain components are operating at critically high temperatures. Immediate attention is recommended.')
            : t('drivetrain.alert.warningMsg', 'Drivetrain temperatures are above normal operating range. Monitor closely and consider reducing load.')}
        </AlertBanner>}
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <Text as="p" variant="bodySm">
            {score == null ? t('drivetrain.modernization.noAssessment', 'No temperature evidence for an active health assessment')
              : status === 'good' ? t('drivetrain.healthGood', 'Drivetrain healthy')
                : status === 'warning' ? t('drivetrain.healthWarn', 'Drivetrain running warm')
                  : t('drivetrain.healthCrit', 'Drivetrain overheating')}
          </Text>
          <Badge variant={score == null ? 'neutral' : status === 'good' ? 'success' : status === 'warning' ? 'warning' : 'danger'}>
            {score == null ? t('drivetrain.modernization.unknown', 'Unknown') : statusLabel}
          </Badge>
        </div>
        <KVList items={[
          { label: t('drivetrain.motorState', 'Motor state'), value: health?.motorStatus?.trim() || '—' },
          { label: t('drivetrain.overallHealth', 'Overall Health'), value: statusLabel },
          { label: t('drivetrain.healthScore', 'Health Score'), value: score != null ? `${fmtNumber(score)}%` : '—' },
        ]} />
        <Text as="p" variant="bodySm">{snapshot.provenance}</Text>
      </SourceBoundary>
    </LayoutCard>

    <StatStrip id="drivetrain-health:temperatures" title={t('drivetrain.temperatures', 'Temperature Details')}
      metrics={[...metrics, { metricId: 'percent', label: t('drivetrain.healthScore', 'Health Score'), rawValue: score }]}
      period={snapshot} preferences={preferences} loading={healthLoading} retained={healthState.hasData}
      error={healthState.fatalError?.message ?? healthState.refreshError?.message} />
    <StatStrip id="drivetrain-health:power" title={t('drivetrain.powerSummary', 'Power Summary')}
      metrics={[{ metricId: 'power', label: t('drivetrain.peakPower', 'Peak Power'), rawValue: power.peakPower }]}
      period={period} preferences={preferences} retained={drivesState.hasData}
      error={drivesState.fatalError?.message ?? drivesState.refreshError?.message} />

    <CardGrid label={t('drivetrain.modernization.healthDetails', 'Health and drive details')} items={[
      { id: 'health-score', size: 'third', content: <LayoutCard title={t('drivetrain.healthScore', 'Health Score')}>
        <SourceBoundary state={healthState} label={t('drivetrain.healthScore', 'Health Score')}
          loading={healthLoading} empty={!health} emptyMessage={noHealth}>
          <LinearGauge value={score} max={100} size={140} unit="%" label={t('drivetrain.healthScore', 'Health Score')}
            tone={score == null ? 'neutral' : status === 'good' ? 'success' : status === 'warning' ? 'warning' : 'danger'} />
          <Text as="p" variant="bodySm">{t('drivetrain.healthScoreDesc', 'Overall drivetrain condition rating')}</Text>
          <Text as="p" variant="bodySm">{t('drivetrain.modernization.scorePolicy', 'Status-to-score policy: good 95%, warning 60%, critical 25%. This is a rating, not a measured percentage.')}</Text>
        </SourceBoundary>
      </LayoutCard> },
      { id: 'motor-details', size: 'third', content: <LayoutCard title={t('drivetrain.motorDetails', 'Motor Details')}>
        <SourceBoundary state={healthState} label={t('drivetrain.motorDetails', 'Motor Details')}
          loading={healthLoading} empty={!health} emptyMessage={noHealth}>
          <KVList items={[
            { label: t('drivetrain.motorStatus', 'Motor Status'), value: health?.motorStatus?.trim() || '—' },
            { label: t('drivetrain.overallHealth', 'Overall Health'), value: statusLabel },
            { label: t('drivetrain.healthScoreLabel', 'Health Score'), value: score != null ? `${fmtNumber(score)}%` : '—' },
            { label: t('drivetrain.sensorCount', 'Active Sensors'), value: fmtInt(activeSensors) },
          ]} />
          <Text as="p" variant="bodySm">{t('drivetrain.modernization.snapshotNotLive', 'A health response is a snapshot; it does not establish an active telemetry connection.')}</Text>
        </SourceBoundary>
      </LayoutCard> },
      { id: 'drive-statistics', size: 'third', content: <LayoutCard title={t('drivetrain.driveStats', 'Drive Statistics')}>
        <SourceBoundary state={statsState} label={t('drivetrain.driveStats', 'Drive Statistics')}
          loading={statsLoading} empty={!stats} emptyMessage={t('drivetrain.noStats', 'No drive statistics available yet')}>
          <StatGroup preferences={preferences} period={{ kind: 'alltime', label: t('drivetrain.modernization.allReturnedStats', 'Vehicle drive statistics'), provenance: t('drivetrain.modernization.statsScope', 'Unbounded vehicle statistics; independent of the chart date filter.') }}
            metrics={[
              { metricId: 'count', label: t('drivetrain.totalDrives', 'Total Drives'), rawValue: finite(stats?.totalDrives) },
              { metricId: 'distance', label: t('drivetrain.totalDistance', 'Total Distance'), rawValue: normalized.distance },
              { metricId: 'speed', label: t('drivetrain.avgSpeed', 'Avg Speed'), rawValue: normalized.avgSpeed },
              { metricId: 'speed', label: t('drivetrain.topSpeed', 'Top Speed'), rawValue: normalized.topSpeed },
            ]} />
        </SourceBoundary>
      </LayoutCard> },
    ]} />
  </>;
}
