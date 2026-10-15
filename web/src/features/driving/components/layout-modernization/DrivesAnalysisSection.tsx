import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icons } from '@/lib/icons';
import { Section } from '@/components/layout/layout-reference';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { EmptyState, Skeleton } from '@/components/feedback';
import { MetricSwitcherChart, type MetricSwitcherMetric } from '@/components/charts';
import type { TrendMetric } from '@/lib/drivesAggregation';
import { PreservedPanelGrid } from './PreservedPanelGrid';

interface TrendPoint {
  date: string;
  value: number;
}

export interface DrivesAnalysisSectionProps {
  isLoading: boolean;
  count: number;
  series: Record<TrendMetric, TrendPoint[]>;
  metrics: readonly MetricSwitcherMetric<TrendPoint>[];
  activeMetric: TrendMetric;
  onMetricChange: (key: string) => void;
  formatXTick: (date: string) => string;
  highlightRows: readonly { key: string; icon: ReactNode; label: string; value: string }[];
  anomalyFooter: ReactNode;
}

/** All calculations, SI conversion and URL state remain in the routed page. */
export function DrivesAnalysisSection({
  isLoading, count, series, metrics, activeMetric, onMetricChange,
  formatXTick, highlightRows, anomalyFooter,
}: DrivesAnalysisSectionProps) {
  const { t } = useTranslation();
  const rows = highlightRows ?? [];
  return (
    <Section id="drives-analysis" title={t('drives.analysis', 'Trends and highlights')}>
      <PreservedPanelGrid label={t('drives.analysis', 'Trends and highlights')} items={[
        {
          id: 'drives-trend',
          size: 'half',
          content: isLoading ? (
            <GlassPanel className="p-4 sm:p-5">
              <PanelTitle className="mb-3 flex items-center gap-2">
                <Icons.activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('drives.overTime.title', 'Drives over time')}
              </PanelTitle>
              <Skeleton className="h-56 sm:h-64" />
            </GlassPanel>
          ) : (
            <MetricSwitcherChart
              title={t('drives.overTime.title', 'Drives over time')}
              ariaLabel={t('drives.overTime.aria', 'Drives over time chart with metric switcher')}
              series={series}
              metrics={metrics}
              activeMetric={activeMetric}
              onMetricChange={onMetricChange}
              formatXTick={formatXTick}
              emptyMessage={t('drives.overTime.empty', 'No data for this metric in the selected range')}
              testId="drives-trend-chart"
            />
          ),
        },
        {
          id: 'drives-highlights',
          size: 'quarter',
          content: (
            <GlassPanel className="space-y-4 p-4 sm:p-5">
              <PanelTitle className="flex items-center gap-2">
                <Icons.sparkles className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('drives.highlights', 'Highlights')}
              </PanelTitle>
              {isLoading ? (
                <Skeleton className="h-40" />
              ) : count === 0 ? (
                <EmptyState
                  /* no-action: transient empty state — no drives in the selected range to summarise */
                  message={t('drives.noHighlights', 'No highlights in this range')}
                />
              ) : (
                <div className="space-y-4">
                  <dl className="space-y-3">
                    {rows.map(row => (
                      <div key={row.key} className="flex flex-wrap items-center justify-between gap-3">
                        <Text as="dt" size="sm" color="secondary" className="flex min-w-0 items-center gap-2">
                          {row.icon}
                          <span className="break-words">{row.label}</span>
                        </Text>
                        <Text as="dd" size="sm" weight="semibold" color="primary" className="break-words tabular-nums">
                          {row.value}
                        </Text>
                      </div>
                    ))}
                  </dl>
                  {anomalyFooter}
                </div>
              )}
            </GlassPanel>
          ),
        },
      ]} />
    </Section>
  );
}
