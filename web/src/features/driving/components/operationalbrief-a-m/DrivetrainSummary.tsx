import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Text } from '@/components/ui';
import { CardGrid, LayoutCard } from '@/components/layout';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { KVList } from '@/components/data-display';
import { LinearGauge } from '@/components/charts';
import { AlertBanner } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { HealthSummary } from '../drivetrain-health-modernization/HealthSummary';
import { SourceBoundary } from '../drivetrain-health-modernization/SourceBoundary';
import { finite, healthScore, healthStatus, statsSI, temperatureBand } from '../drivetrain-health-modernization/model';
import { DrivingSummaryBrief } from './DrivingSummaryBrief';

type Props = ComponentProps<typeof HealthSummary>;

export function DrivetrainSummary(props: Props) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { health, stats, sensors, power, healthState, statsState, drivesState, healthLoading, statsLoading } = props;
  const score = healthScore(health);
  const status = healthStatus(health);
  const activeSensors = sensors.filter(sensor => sensor.value != null).length;
  const preferences = { units: unitPrefs, currency: { kind: 'symbol' as const, value: '$' } };
  const normalized = statsSI(stats);
  const noHealth = t('drivetrain.noHealth', 'No drivetrain health data available yet');
  const statusLabel = status ? t(`drivetrain.health.${status}`, status.charAt(0).toUpperCase() + status.slice(1)) : '—';
  const scorePolicy = t('drivetrain.modernization.scorePolicy', 'Status-to-score policy: good 95%, warning 60%, critical 25%. This is a rating, not a measured percentage.');
  const healthSource = t('drivetrain.modernization.healthMethodology', 'Health temperatures are backend battery-module proxies, not direct motor measurements.');
  const snapshotScope = healthState.updatedAt
    ? `${t('drivetrain.modernization.snapshot', 'Latest health response')} · ${t('driving.brief.responseReceivedAt', 'Response received {{timestamp}}', { timestamp: new Date(healthState.updatedAt).toISOString() })}`
    : t('drivetrain.modernization.snapshot', 'Latest health response');
  const powerSource = t('drivetrain.modernization.powerMethodology', 'Peak-labelled power uses average drive power from up to 30 returned drives. Per-drive regen power is not supplied; gaps are unknown, not zero.');
  const temperatures: readonly StatMetric[] = [
    ...sensors.map<StatMetric>(sensor => ({
      metricId: 'temperature', occurrenceId: sensor.key, label: t(sensor.labelKey, sensor.label),
      rawValue: sensor.value, description: healthSource,
      context: sensor.value != null
        ? `${fmtNumber(sensor.value / sensor.maxTemp * 100)}% ${t('drivetrain.ofMax', 'of max')} · ${t(`drivetrain.modernization.band.${temperatureBand(sensor.value, sensor.maxTemp)}`, temperatureBand(sensor.value, sensor.maxTemp))}`
        : t('drivetrain.noData', 'No data'),
    })),
    { metricId: 'percent', occurrenceId: 'health-rating', label: t('drivetrain.healthScore', 'Health Score'), rawValue: score, description: scorePolicy },
  ];
  const statistics: readonly StatMetric[] = [
    { metricId: 'count', label: t('drivetrain.totalDrives', 'Total Drives'), rawValue: finite(stats?.totalDrives) },
    { metricId: 'distance', label: t('drivetrain.totalDistance', 'Total Distance'), rawValue: normalized.distance },
    { metricId: 'speed', label: t('drivetrain.avgSpeed', 'Avg Speed'), rawValue: normalized.avgSpeed },
    { metricId: 'speed', label: t('drivetrain.topSpeed', 'Top Speed'), rawValue: normalized.topSpeed },
  ];
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
        <Text as="p" variant="bodySm">{healthSource}</Text>
      </SourceBoundary>
    </LayoutCard>
    <DrivingSummaryBrief title={t('drivetrain.temperatures', 'Temperature Details')} metrics={temperatures}
      description={healthSource} scope={snapshotScope}
      provenance={healthSource} preferences={preferences} loading={healthLoading && !healthState.hasData}
      retained={healthState.status === 'stale' || healthState.refreshError != null} error={healthState.fatalError} showError={false}
      onRetry={() => { healthState.retry?.(); }} />
    <DrivingSummaryBrief title={t('drivetrain.powerSummary', 'Power Summary')}
      metrics={[{ metricId: 'power', label: t('drivetrain.peakPower', 'Peak Power'), rawValue: power.peakPower, description: powerSource }]}
      description={powerSource} scope={t('drivetrain.modernization.driveSubset', 'Recent drives within the selected range')}
      provenance={powerSource} preferences={preferences}
      loading={drivesState.status === 'initial'} error={drivesState.fatalError ?? drivesState.refreshError}
      statusLabel={drivesState.refreshError != null ? t('driving.brief.retained', 'Retained evidence') : undefined}
      retained={drivesState.status === 'stale' || drivesState.refreshError != null}
      onRetry={() => { drivesState.retry?.(); }} />
    <CardGrid label={t('drivetrain.modernization.healthDetails', 'Health and drive details')} items={[
      { id: 'health-score', size: 'third', content: <LayoutCard title={t('drivetrain.healthScore', 'Health Score')}>
        <SourceBoundary state={healthState} label={t('drivetrain.healthScore', 'Health Score')}
          loading={healthLoading} empty={!health} emptyMessage={noHealth}>
          <LinearGauge value={score} max={100} size={140} unit="%" label={t('drivetrain.healthScore', 'Health Score')}
            tone={score == null ? 'neutral' : status === 'good' ? 'success' : status === 'warning' ? 'warning' : 'danger'} />
          <Text as="p" variant="bodySm">{t('drivetrain.healthScoreDesc', 'Overall drivetrain condition rating')}</Text>
          <Text as="p" variant="bodySm">{scorePolicy}</Text>
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
        <DrivingSummaryBrief metrics={statistics} title={t('drivetrain.modernization.allReturnedStats', 'Vehicle drive statistics')}
          description={t('drivetrain.modernization.statsScope', 'Unbounded vehicle statistics; independent of the chart date filter.')}
          scope={t('drivetrain.modernization.allReturnedStats', 'Vehicle drive statistics')}
          provenance={t('drivetrain.modernization.statsScope', 'Unbounded vehicle statistics; independent of the chart date filter.')}
          preferences={preferences} loading={statsLoading && !statsState.hasData} showError={false}
          error={statsState.fatalError} retained={statsState.status === 'stale' || statsState.refreshError != null}
          onRetry={() => { statsState.retry?.(); }} />
        <SourceBoundary state={statsState} label={t('drivetrain.driveStats', 'Drive Statistics')}
          loading={statsLoading} empty={!stats} emptyMessage={t('drivetrain.noStats', 'No drive statistics available yet')}>
          {null}
        </SourceBoundary>
      </LayoutCard> },
    ]} />
  </>;
}
