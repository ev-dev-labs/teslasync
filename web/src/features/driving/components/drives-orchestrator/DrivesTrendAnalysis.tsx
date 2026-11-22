import { AlertTriangle } from 'lucide-react';
import { InlineCallout } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { DrivesAnalysisSection } from '../layout-modernization';
import { DrivesAnalysisFailure } from '../continuation-driving-primary/DrivesAnalysisFailure';
import { TREND_METRICS } from './drivesListConstants';
import type { DrivesListPageController } from '../../hooks/useDrivesListPage';

type Props = Pick<DrivesListPageController,
  't' | 'anomalyCount' | 'collection' | 'setUrlBatch' | 'drivesState'
  | 'refetchDrives' | 'isDrivesLoading' | 'currentStats' | 'trendSeries'
  | 'trendMetricsConfig' | 'trendMetric' | 'setTrendMetric' | 'formatChartXTick'
  | 'highlightRows'>;

export function DrivesTrendAnalysis({
  t, anomalyCount, collection, setUrlBatch, drivesState, refetchDrives,
  isDrivesLoading, currentStats, trendSeries, trendMetricsConfig,
  trendMetric, setTrendMetric, formatChartXTick, highlightRows,
}: Props) {
  /* ---- Anomaly callout ---- */
  const anomalyFooter = anomalyCount > 0 && collection !== 'anomalies' ? (
    <InlineCallout
      variant="warning"
      icon={<AlertTriangle className="h-3.5 w-3.5" />}
      action={{
        label: t('drives.viewAnomalies', 'View anomalies'),
        onClick: () => setUrlBatch({ coll: 'anomalies', page: null }),
      }}
    >
      {t('drives.anomalyCount', '{{count}} {{noun}} in this range', {
        count: anomalyCount,
        noun: anomalyCount === 1
          ? t('drives.anomaly_one', 'anomaly')
          : t('drives.anomaly_other', 'anomalies'),
      })}
    </InlineCallout>
  ) : null;

  return (
    <FadeIn delay={0.1}>
      {drivesState.fatalError ? (
        <DrivesAnalysisFailure error={drivesState.fatalError} onRetry={() => { void refetchDrives(); }} />
      ) : <DrivesAnalysisSection
        isLoading={isDrivesLoading}
        count={currentStats.count}
        series={trendSeries}
        metrics={trendMetricsConfig}
        activeMetric={trendMetric}
        onMetricChange={(key) => {
          const metric = TREND_METRICS.find(candidate => candidate === key);
          if (metric) setTrendMetric(metric);
        }}
        formatXTick={formatChartXTick}
        highlightRows={highlightRows}
        anomalyFooter={anomalyFooter}
      />}
    </FadeIn>
  );
}
